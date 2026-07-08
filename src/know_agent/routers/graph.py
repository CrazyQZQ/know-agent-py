"""graph 路由 — 对应源项目 GraphExecutionController.

POST /graph_run_sse   首次运行（输入需求），检测 interrupt_before clarification
POST /graph_resume_sse 用户补充信息后恢复
GET  /list-graphs     列出可用 graph
"""

import json

from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

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


async def _stream(graph, inputs, config):
    """通用流式：yield 每个节点更新 + interrupt/done 终止事件."""
    if inputs is not None:
        async for output in graph.astream(inputs, config, stream_mode="updates"):
            for node, update in output.items():
                yield {
                    "event": "update",
                    "data": json.dumps({"node": node, "values": _extract_state(update)}, ensure_ascii=False),
                }
    else:
        # resume：从 interrupt 处继续
        async for output in graph.astream(None, config, stream_mode="updates"):
            for node, update in output.items():
                yield {
                    "event": "update",
                    "data": json.dumps({"node": node, "values": _extract_state(update)}, ensure_ascii=False),
                }
    state = graph.get_state(config)
    if state.next:
        yield {
            "event": "interrupt",
            "data": json.dumps(
                {"next": state.next, "clarification": state.values.get("clarification", "")},
                ensure_ascii=False,
            ),
        }
    else:
        yield {
            "event": "done",
            "data": json.dumps({"ppt_result": state.values.get("ppt_result", "")}, ensure_ascii=False),
        }


@router.get("/list-graphs", tags=["graph"])
def list_graphs() -> list[str]:
    return [GRAPH_NAME]


@router.post("/graph_run_sse", tags=["graph"])
async def graph_run_sse(req: GraphRunRequest):
    graph = get_ppt_graph()
    config = _config(req.threadId)
    if req.inputs:
        inputs = req.inputs
    else:
        content = req.newMessage.content if req.newMessage else ""
        inputs = {"input": content}
    return EventSourceResponse(_stream(graph, inputs, config))


@router.post("/graph_resume_sse", tags=["graph"])
async def graph_resume_sse(req: GraphResumeRequest):
    """用户补充澄清信息后恢复 graph（对应源项目 updateState + 继续）."""
    graph = get_ppt_graph()
    config = _config(req.threadId)
    graph.update_state(config, {"clarification_response": req.clarificationResponse})
    return EventSourceResponse(_stream(graph, None, config))
