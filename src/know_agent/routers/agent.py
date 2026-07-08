"""agent 路由 — 对应源项目 AgentController / ExecutionController / ThreadController / ChatController."""

import json
import uuid

from fastapi import APIRouter, HTTPException, Request
from langchain_core.messages import HumanMessage
from langgraph.types import Command
from sse_starlette.sse import EventSourceResponse

from know_agent.agents import thread as thread_service
from know_agent.agents.react_agent import AGENT_NAME, TOOL_CALL_LIMIT, get_react_agent
from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.schemas.agent import AgentRunRequest, AgentResumeRequest

router = APIRouter()


# ===== agent =====

@router.get("/list-apps", tags=["agent"])
def list_apps() -> list[str]:
    """列出可用 agent."""
    return [AGENT_NAME]


def _extract_hitl_request(state) -> dict | None:
    """从 state 提取 HITLRequest（待审批工具调用信息），无则 None."""
    for task in getattr(state, "tasks", ()) or ():
        for intr in getattr(task, "interrupts", ()) or ():
            return intr.value
    return None


def _stream_agent(agent, inputs, config):
    """通用 agent 流式：yield message/tool，结束后按 state 推送 interrupt/done."""
    for msg, _meta in agent.stream(inputs, config, stream_mode="messages"):
        content = getattr(msg, "content", None)
        msg_type = getattr(msg, "type", "")
        if not content:
            continue
        if msg_type in ("AIMessageChunk", "AIMessage"):
            yield {"event": "message", "data": content}
        elif msg_type == "ToolMessage":
            yield {"event": "tool", "data": content}
    state = agent.get_state(config)
    hitl = _extract_hitl_request(state)
    if hitl:
        yield {"event": "interrupt", "data": json.dumps(hitl, ensure_ascii=False)}
    else:
        yield {"event": "done", "data": "[DONE]"}


@router.post("/run_sse", tags=["agent"])
@limiter.limit(lambda: get_settings().rate_limit)
async def run_sse(request: Request, req: AgentRunRequest):
    """流式运行 agent（SSE）。工具需审批时以 interrupt 事件推送 HITLRequest."""
    agent = get_react_agent()
    config = {
        "configurable": {"thread_id": req.threadId},
        "recursion_limit": TOOL_CALL_LIMIT,
        "metadata": {"user_id": req.userId, "app_name": req.appName},
    }
    inputs = {"messages": [HumanMessage(content=req.newMessage.content)]}
    return EventSourceResponse(_stream_agent(agent, inputs, config))


@router.post("/resume_sse", tags=["agent"])
@limiter.limit(lambda: get_settings().rate_limit)
async def resume_sse(request: Request, req: AgentResumeRequest):
    """恢复 agent（HITL 工具审批）：toolFeedbacks 转 decisions，Command(resume=...) 继续."""
    agent = get_react_agent()
    config = {
        "configurable": {"thread_id": req.threadId},
        "recursion_limit": TOOL_CALL_LIMIT,
        "metadata": {"user_id": req.userId, "app_name": req.appName},
    }
    decisions: list[dict] = []
    for fb in req.toolFeedbacks:
        if fb.result == "REJECTED":
            decisions.append({"type": "reject", "message": fb.description or ""})
        else:
            decisions.append({"type": "approve"})
    return EventSourceResponse(_stream_agent(agent, Command(resume={"decisions": decisions}), config))


@router.get("/chat/ask", tags=["agent"])
@limiter.limit(lambda: get_settings().rate_limit)
def chat_ask(request: Request, question: str) -> str:
    """简单单轮对话（独立 thread）."""
    agent = get_react_agent()
    config = {
        "configurable": {"thread_id": f"chat-{uuid.uuid4()}"},
        "recursion_limit": TOOL_CALL_LIMIT,
    }
    result = agent.invoke({"messages": [HumanMessage(content=question)]}, config)
    return result["messages"][-1].content


# ===== thread =====

@router.get("/apps/{appName}/users/{userId}/threads", tags=["agent"])
def list_threads(appName: str, userId: str) -> list[dict]:
    return thread_service.list_threads()


@router.get("/apps/{appName}/users/{userId}/threads/{threadId}", tags=["agent"])
def get_thread(appName: str, userId: str, threadId: str) -> dict:
    t = thread_service.get_thread(threadId)
    if t is None:
        raise HTTPException(404, "thread not found")
    return t


@router.post("/apps/{appName}/users/{userId}/threads", tags=["agent"])
def create_thread(appName: str, userId: str) -> dict:
    tid = thread_service.create_thread()
    return {"thread_id": tid}


@router.post("/apps/{appName}/users/{userId}/threads/{threadId}", tags=["agent"])
def create_thread_with_id(appName: str, userId: str, threadId: str) -> dict:
    return {"thread_id": thread_service.create_thread(threadId)}


@router.delete("/apps/{appName}/users/{userId}/threads/{threadId}", tags=["agent"])
def delete_thread(appName: str, userId: str, threadId: str) -> dict:
    deleted = thread_service.delete_thread(threadId)
    return {"deleted": threadId if deleted else None}
