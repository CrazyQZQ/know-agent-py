"""agent 路由 — 对应源项目 AgentController / ExecutionController / ThreadController / ChatController."""

import json
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.types import Command
from sse_starlette.sse import EventSourceResponse

from know_agent.agents import thread as thread_service
from know_agent.agents.memory import extract_memories, search_memories
from know_agent.agents.react_agent import AGENT_NAME, TOOL_CALL_LIMIT, get_react_agent
from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.core.request_context import get_rag_sources, set_rag_sources
from know_agent.core.sse_store import parse_last_event_id, sse_store
from know_agent.schemas.agent import AgentRunRequest, AgentResumeRequest

router = APIRouter()


# ===== agent =====


def _to_lc_message(message):
    """将前端消息转为 LangChain 对话消息，仅保留 user/assistant。"""
    if message.role == "assistant":
        return AIMessage(content=message.content)
    return HumanMessage(content=message.content)


def _build_run_messages(req: AgentRunRequest):
    messages = [_to_lc_message(m) for m in (req.messages or [])]
    messages.append(_to_lc_message(req.newMessage))
    return messages

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


def _stream_agent(agent, inputs, config, last_event_id: int | None = None):
    """通用 agent 流式：yield message/tool(带 id)，结束后推送 interrupt/done.

    last_event_id 非 None 时为断线重连：只重放缓存中该 id 之后的事件，不重新执行 agent
    （原流已随客户端断开停止；如需继续，前端重新 run_sse/resume_sse）。
    """
    thread_id = config["configurable"]["thread_id"]
    # 断线重连：重放缓存事件
    if last_event_id is not None:
        for eid, ev in sse_store.get_since(thread_id, last_event_id):
            yield {**ev, "id": str(eid)}
        return
    # 新流：产生事件存缓存 + yield（带 id）
    for msg, _meta in agent.stream(inputs, config, stream_mode="messages"):
        content = getattr(msg, "content", None)
        msg_type = getattr(msg, "type", "")
        # 工具调用 -> thinking 事件（供前端 ThoughtChain 展示思考步骤）
        tool_calls = getattr(msg, "tool_calls", None) or []
        if tool_calls and msg_type in ("AIMessageChunk", "AIMessage"):
            for tc in tool_calls:
                tc_name = tc.get("name", "") if isinstance(tc, dict) else getattr(tc, "name", "")
                if not tc_name:
                    continue
                event = {"event": "thinking", "data": json.dumps({"name": str(tc_name)}, ensure_ascii=False)}
                eid = sse_store.append(thread_id, event)
                yield {**event, "id": str(eid)}
        if not content:
            continue
        if msg_type in ("AIMessageChunk", "AIMessage"):
            event = {"event": "message", "data": content}
        elif msg_type == "ToolMessage":
            event = {"event": "tool", "data": content}
            # 旁路发送 RAG 检索来源（工具内写入 contextvar）
            sources = get_rag_sources()
            if sources:
                sources_event = {"event": "sources", "data": json.dumps(sources, ensure_ascii=False)}
                eid_s = sse_store.append(thread_id, sources_event)
                yield {**sources_event, "id": str(eid_s)}
                set_rag_sources([])
        else:
            continue
        eid = sse_store.append(thread_id, event)
        yield {**event, "id": str(eid)}
    state = agent.get_state(config)
    hitl = _extract_hitl_request(state)
    if hitl:
        event = {"event": "interrupt", "data": json.dumps(hitl, ensure_ascii=False)}
    else:
        event = {"event": "done", "data": "[DONE]"}
    eid = sse_store.append(thread_id, event)
    yield {**event, "id": str(eid)}
    sse_store.mark_done(thread_id)


@router.post("/run_sse", tags=["agent"])
@limiter.limit(lambda: get_settings().rate_limit)
async def run_sse(request: Request, req: AgentRunRequest, background_tasks: BackgroundTasks):
    """流式运行 agent（SSE）。支持 Last-Event-ID 断线重连 + mem0 长期记忆（检索注入/自动提取）."""
    agent = get_react_agent()
    config = {
        "configurable": {"thread_id": req.threadId},
        "recursion_limit": TOOL_CALL_LIMIT,
        "metadata": {"user_id": req.userId, "app_name": req.appName},
    }
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        # 断线重连：只重放缓存事件，不重新执行 agent
        return EventSourceResponse(_stream_agent(agent, None, config, last_event_id=last_id))
    # mem0 检索注入：从长期记忆找相关，由 middleware 临时拼入 system prompt
    memories = search_memories(req.newMessage.content, req.userId or "")
    if memories:
        config["metadata"]["user_memories"] = memories
    inputs = {"messages": _build_run_messages(req)}
    created = thread_service.ensure_thread_meta(
        req.threadId,
        req.appName,
        req.userId,
        req.newMessage.content,
    )
    # mem0 自动提取：对话结束后后台提交（不阻塞 SSE 流）
    if req.userId:
        background_tasks.add_task(extract_memories, req.threadId, req.userId)
    if created:
        background_tasks.add_task(
            thread_service.generate_and_update_thread_title,
            req.threadId,
            req.newMessage.content,
        )
    return EventSourceResponse(_stream_agent(agent, inputs, config))


@router.post("/resume_sse", tags=["agent"])
@limiter.limit(lambda: get_settings().rate_limit)
async def resume_sse(request: Request, req: AgentResumeRequest):
    """恢复 agent（HITL 工具审批）：toolFeedbacks 转 decisions，Command(resume=...) 继续.
    支持 Last-Event-ID 断线重连。
    """
    agent = get_react_agent()
    config = {
        "configurable": {"thread_id": req.threadId},
        "recursion_limit": TOOL_CALL_LIMIT,
        "metadata": {"user_id": req.userId, "app_name": req.appName},
    }
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream_agent(agent, None, config, last_event_id=last_id))
    decisions: list[dict] = []
    for fb in req.toolFeedbacks:
        if fb.result == "REJECTED":
            decisions.append({"type": "reject", "message": fb.description or ""})
        elif fb.result == "EDITED":
            # 用户编辑工具参数：name + arguments 作为 edited_action，按新参数执行
            decisions.append({
                "type": "edit",
                "edited_action": {"name": fb.name or "", "args": fb.arguments or {}},
            })
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
    return thread_service.list_threads(appName, userId)


@router.get("/apps/{appName}/users/{userId}/threads/{threadId}", tags=["agent"])
def get_thread(appName: str, userId: str, threadId: str) -> dict:
    t = thread_service.get_thread(threadId)
    if t is None:
        raise HTTPException(404, "thread not found")
    return t


@router.get("/apps/{appName}/users/{userId}/threads/{threadId}/history", tags=["agent"])
def thread_history(appName: str, userId: str, threadId: str) -> list[dict]:
    """获取 thread 历史消息（进入旧会话时拉取展示）."""
    return thread_service.get_thread_history(threadId)


@router.post("/apps/{appName}/users/{userId}/threads", tags=["agent"])
def create_thread(appName: str, userId: str) -> dict:
    tid = thread_service.create_thread()
    thread_service.ensure_thread_meta(tid, appName, userId, first_message="")
    return {"thread_id": tid}


@router.post("/apps/{appName}/users/{userId}/threads/{threadId}", tags=["agent"])
def create_thread_with_id(appName: str, userId: str, threadId: str) -> dict:
    tid = thread_service.create_thread(threadId)
    thread_service.ensure_thread_meta(tid, appName, userId, first_message="")
    return {"thread_id": tid}


@router.delete("/apps/{appName}/users/{userId}/threads/{threadId}", tags=["agent"])
def delete_thread(appName: str, userId: str, threadId: str) -> dict:
    deleted = thread_service.delete_thread(threadId, appName, userId)
    return {"deleted": threadId if deleted else None}
