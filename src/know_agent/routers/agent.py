"""agent 路由 — 对应源项目 AgentController / ExecutionController / ThreadController / ChatController."""

import uuid

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage
from sse_starlette.sse import EventSourceResponse

from know_agent.agents import thread as thread_service
from know_agent.agents.react_agent import AGENT_NAME, TOOL_CALL_LIMIT, get_react_agent
from know_agent.schemas.agent import AgentRunRequest, AgentResumeRequest

router = APIRouter()


# ===== agent =====

@router.get("/list-apps", tags=["agent"])
def list_apps() -> list[str]:
    """列出可用 agent."""
    return [AGENT_NAME]


@router.post("/run_sse", tags=["agent"])
async def run_sse(req: AgentRunRequest):
    """流式运行 agent（SSE）."""
    agent = get_react_agent()
    config = {
        "configurable": {"thread_id": req.threadId},
        "recursion_limit": TOOL_CALL_LIMIT,
        "metadata": {"user_id": req.userId, "app_name": req.appName},
    }
    inputs = {"messages": [HumanMessage(content=req.newMessage.content)]}

    async def event_gen():
        async for msg, _meta in agent.astream(inputs, config, stream_mode="messages"):
            content = getattr(msg, "content", None)
            msg_type = getattr(msg, "type", "")
            if not content:
                continue
            if msg_type == "AIMessageChunk" or msg_type == "AIMessage":
                yield {"event": "message", "data": content}
            elif msg_type == "ToolMessage":
                yield {"event": "tool", "data": content}
        yield {"event": "done", "data": "[DONE]"}

    return EventSourceResponse(event_gen())


@router.post("/resume_sse", tags=["agent"])
async def resume_sse(req: AgentResumeRequest):
    """恢复 agent（HITL 工具审批）— 阶段 3 留接口."""
    raise HTTPException(501, "resume_sse 暂未实现（HumanInTheLoop 待完善）")


@router.get("/chat/ask", tags=["agent"])
def chat_ask(question: str) -> str:
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
