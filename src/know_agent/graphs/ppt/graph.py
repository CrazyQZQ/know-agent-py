"""PPT 生成 graph - StateGraph 组装 + 自登记到 registry.

工作流：
  START -> requirement -> (search | clarification)
          clarification -> requirement（interrupt_before，人在回路）
          search -> template_select -> template_info -> outline -> schema -> render -> END
"""

from langgraph.graph import END, START, StateGraph

from know_agent.agents.checkpoint import get_checkpointer
from know_agent.graphs.ppt.agent_nodes import (
    outline_node,
    schema_node,
    search_node,
    template_select_node,
)
from know_agent.graphs.ppt.nodes import (
    clarification_node,
    render_node,
    requirement_node,
    template_info_node,
)
from know_agent.graphs.ppt.state import PptState
from know_agent.graphs.registry import GraphRegistration, register_graph
from know_agent.schemas.graph import GraphResumeRequest, ResumeAnswer

GRAPH_NAME = "ppt_build"


def build_ppt_graph():
    workflow = StateGraph(PptState)
    workflow.add_node("requirement", requirement_node)
    workflow.add_node("clarification", clarification_node)
    workflow.add_node("search", search_node)
    workflow.add_node("template_select", template_select_node)
    workflow.add_node("template_info", template_info_node)
    workflow.add_node("outline", outline_node)
    workflow.add_node("schema", schema_node)
    workflow.add_node("render", render_node)

    workflow.add_edge(START, "requirement")
    workflow.add_conditional_edges(
        "requirement",
        lambda s: s.get("next_node", "search"),
        {"search": "search", "clarification": "clarification"},
    )
    workflow.add_edge("search", "template_select")
    workflow.add_edge("template_select", "template_info")
    workflow.add_edge("template_info", "outline")
    workflow.add_edge("outline", "schema")
    workflow.add_edge("schema", "render")
    workflow.add_edge("render", END)
    workflow.add_edge("clarification", "requirement")

    return workflow.compile(
        checkpointer=get_checkpointer(),
        interrupt_before=["clarification"],
    )


def _compose_answers(answers: list[ResumeAnswer]) -> str:
    """把结构化回答组装成自然语言文本，供 clarification_node 拼回 input."""
    parts = []
    for a in answers:
        text = (a.label or a.value).strip()
        if text:
            parts.append(f"{a.id}：{text}")
    return "\n".join(parts)


def _compose_resume_response(req: GraphResumeRequest) -> str:
    """resume 请求 -> 要写入 state 的文本：优先 answers，回退纯文本，都空抛错."""
    if req.answers:
        return _compose_answers(req.answers)
    resp = req.clarificationResponse or ""
    if not resp:
        raise ValueError("answers 或 clarificationResponse 至少需提供一个非空值")
    return resp


register_graph(GraphRegistration(
    name=GRAPH_NAME,
    title="PPT 生成",
    description="根据需求生成 PPT",
    factory=build_ppt_graph,
    state_keys=[
        "requirement", "info_complete", "next_node", "clarification",
        "clarification_options",
        "search_info", "template_code", "template_info",
        "ppt_outline", "ppt_schema", "ppt_result",
    ],
    interrupt_payload=lambda v: {
        "clarification": v.get("clarification", ""),
        "clarification_options": v.get("clarification_options", []),
    },
    compose_resume_response=_compose_resume_response,
    resume_state_key="clarification_response",
    messages_state_key="messages",
    result_key="ppt_result",
))
