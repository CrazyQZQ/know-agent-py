"""graph 路由 - 对应源项目 GraphExecutionController.

POST /graph_run_sse      首次运行（按 graphName 分发），检测 interrupt_before clarification
POST /graph_resume_sse   用户补充信息后恢复（支持结构化 answers 或纯文本）
GET  /list-graphs        列出已注册 graph（name/title/description）
GET  /graph_topology/{name}  返回 graph 流程节点 + mermaid 图
"""

import json

from langchain_core.messages import AIMessage, HumanMessage
from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.core.sse_store import parse_last_event_id, sse_store
from know_agent.graphs import registry
from know_agent.graphs.registry import GraphNotFoundError
from know_agent.schemas.graph import GraphResumeRequest, GraphRunRequest

router = APIRouter()


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}


def _stream(reg, inputs, config, last_event_id: int | None = None):
    """通用流式：yield 节点更新 + interrupt/done，带 id + 缓存支持断线重连.

    读 reg 的声明式 metadata（state_keys / interrupt_payload / result_key），
    不认识任何具体 graph 字段。用同步 graph.stream（PostgresSaver 是同步 checkpointer）。
    """
    graph = registry.get_compiled_graph(reg.name)
    thread_id = config["configurable"]["thread_id"]
    # 断线重连：重放缓存事件
    if last_event_id is not None:
        for eid, ev in sse_store.get_since(thread_id, last_event_id):
            yield {**ev, "id": str(eid)}
        return
    # 新流：stream(inputs) 首次运行，stream(None) 从 interrupt 处继续
    for output in graph.stream(inputs, config, stream_mode="updates"):
        for node, update in output.items():
            values = {k: update[k] for k in reg.state_keys if k in update}
            event = {
                "event": "update",
                "data": json.dumps({"node": node, "values": values}, ensure_ascii=False),
            }
            eid = sse_store.append(thread_id, event)
            yield {**event, "id": str(eid)}
    state = graph.get_state(config)
    if state.next:
        payload = {"next": state.next, **reg.interrupt_payload(state.values)}
        event = {
            "event": "interrupt",
            "data": json.dumps(payload, ensure_ascii=False),
        }
    else:
        result = state.values.get(reg.result_key, "")
        # 记录 assistant 回复到 messages，供会话历史拉取
        graph.update_state(config, {"messages": [AIMessage(content=result or "工作流已完成")]})
        event = {
            "event": "done",
            "data": json.dumps({"result": result}, ensure_ascii=False),
        }
    eid = sse_store.append(thread_id, event)
    yield {**event, "id": str(eid)}
    sse_store.mark_done(thread_id)


@router.get("/list-graphs", tags=["graph"])
def list_graphs() -> list[dict]:
    return [
        {"name": r.name, "title": r.title, "description": r.description}
        for r in registry.list_graphs()
    ]


@router.get("/graph_topology/{name}", tags=["graph"])
def graph_topology(name: str) -> dict:
    """返回指定 graph 的流程节点列表与 mermaid 流程图，供前端渲染流程可视化."""
    try:
        return registry.get_graph_topology(name)
    except GraphNotFoundError:
        raise HTTPException(status_code=404, detail=f"graph '{name}' not found")


@router.post("/graph_run_sse", tags=["graph"])
@limiter.limit(lambda: get_settings().rate_limit)
async def graph_run_sse(request: Request, req: GraphRunRequest):
    try:
        reg = registry.get_graph(req.graphName)
    except GraphNotFoundError:
        raise HTTPException(status_code=404, detail=f"graph '{req.graphName}' not found")
    config = _config(req.threadId)
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream(reg, None, config, last_event_id=last_id))
    if req.inputs:
        inputs = req.inputs
    else:
        content = req.newMessage.content if req.newMessage else ""
        inputs = {"input": content, "messages": [HumanMessage(content=content)]}
    return EventSourceResponse(_stream(reg, inputs, config))


@router.post("/graph_resume_sse", tags=["graph"])
@limiter.limit(lambda: get_settings().rate_limit)
async def graph_resume_sse(request: Request, req: GraphResumeRequest):
    """用户补充澄清信息后恢复 graph。支持结构化 answers 或纯文本 clarificationResponse."""
    try:
        reg = registry.get_graph(req.graphName)
    except GraphNotFoundError:
        raise HTTPException(status_code=404, detail=f"graph '{req.graphName}' not found")
    config = _config(req.threadId)
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream(reg, None, config, last_event_id=last_id))
    try:
        resp = reg.compose_resume_response(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    graph = registry.get_compiled_graph(reg.name)
    update = {"messages": [HumanMessage(content=resp)]}
    if reg.resume_state_key:
        update[reg.resume_state_key] = resp
    graph.update_state(config, update)
    return EventSourceResponse(_stream(reg, None, config))
