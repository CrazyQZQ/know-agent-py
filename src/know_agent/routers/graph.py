"""graph 路由 — 对应源项目 GraphExecutionController.

POST /graph_run_sse   首次运行（输入需求），检测 interrupt_before clarification
POST /graph_resume_sse 用户补充信息后恢复
GET  /list-graphs     列出可用 graph
"""

import json

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.core.sse_store import parse_last_event_id, sse_store
from know_agent.graphs.ppt.graph import GRAPH_NAME, get_ppt_graph
from know_agent.schemas.graph import GraphResumeRequest, GraphRunRequest

router = APIRouter()

# SSE 输出中提取的 state key
_STATE_KEYS = [
    "requirement", "info_complete", "next_node", "clarification",
    "search_info", "template_code", "template_info",
    "ppt_outline", "ppt_schema", "ppt_result",
]


def _extract_state(values: dict) -> dict:
    return {k: values[k] for k in _STATE_KEYS if k in values}


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}


async def _stream(graph, inputs, config, last_event_id: int | None = None):
    """通用流式：yield 节点更新 + interrupt/done，带 id + 缓存支持断线重连.

    last_event_id 非 None 时为断线重连：只重放缓存事件，不重新执行 graph。
    """
    thread_id = config["configurable"]["thread_id"]
    # 断线重连：重放缓存事件
    if last_event_id is not None:
        for eid, ev in sse_store.get_since(thread_id, last_event_id):
            yield {**ev, "id": str(eid)}
        return
    # 新流：astream(inputs) 首次运行，astream(None) 从 interrupt 处继续
    async for output in graph.astream(inputs, config, stream_mode="updates"):
        for node, update in output.items():
            event = {
                "event": "update",
                "data": json.dumps({"node": node, "values": _extract_state(update)}, ensure_ascii=False),
            }
            eid = sse_store.append(thread_id, event)
            yield {**event, "id": str(eid)}
    state = graph.get_state(config)
    if state.next:
        event = {
            "event": "interrupt",
            "data": json.dumps(
                {"next": state.next, "clarification": state.values.get("clarification", "")},
                ensure_ascii=False,
            ),
        }
    else:
        event = {
            "event": "done",
            "data": json.dumps({"ppt_result": state.values.get("ppt_result", "")}, ensure_ascii=False),
        }
    eid = sse_store.append(thread_id, event)
    yield {**event, "id": str(eid)}
    sse_store.mark_done(thread_id)


@router.get("/list-graphs", tags=["graph"])
def list_graphs() -> list[str]:
    return [GRAPH_NAME]


@router.post("/graph_run_sse", tags=["graph"])
@limiter.limit(lambda: get_settings().rate_limit)
async def graph_run_sse(request: Request, req: GraphRunRequest):
    graph = get_ppt_graph()
    config = _config(req.threadId)
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream(graph, None, config, last_event_id=last_id))
    if req.inputs:
        inputs = req.inputs
    else:
        content = req.newMessage.content if req.newMessage else ""
        inputs = {"input": content}
    return EventSourceResponse(_stream(graph, inputs, config))


@router.post("/graph_resume_sse", tags=["graph"])
@limiter.limit(lambda: get_settings().rate_limit)
async def graph_resume_sse(request: Request, req: GraphResumeRequest):
    """用户补充澄清信息后恢复 graph（对应源项目 updateState + 继续）.支持 Last-Event-ID 重连."""
    graph = get_ppt_graph()
    config = _config(req.threadId)
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream(graph, None, config, last_event_id=last_id))
    graph.update_state(config, {"clarification_response": req.clarificationResponse})
    return EventSourceResponse(_stream(graph, None, config))
