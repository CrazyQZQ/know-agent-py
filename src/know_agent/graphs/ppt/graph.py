"""PPT 生成 graph - StateGraph 组装 + 自登记到 registry.

工作流：
  START -> requirement -> (search | clarification)
          clarification -> requirement（原生 interrupt，人在回路）
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
from know_agent.graphs.ppt.presentation import (
    build_interrupt_form,
    present_done,
    present_update,
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

    return workflow.compile(checkpointer=get_checkpointer())


def _compose_answers(answers: list[ResumeAnswer]) -> str:
    """把结构化回答组装成自然语言文本，供 clarification_node 拼回 input。"""
    parts = []
    for answer in answers:
        if answer.label:
            text = answer.label.strip()
        elif isinstance(answer.value, list):
            text = "、".join(item.strip() for item in answer.value if item.strip())
        else:
            text = answer.value.strip()
        if text:
            parts.append(f"{answer.id}：{text}")
    return "\n".join(parts)


def _compose_resume_value(req: GraphResumeRequest) -> str:
    """把公开 resume 请求转换为原生 Command.resume 值。"""
    if req.answers:
        response = _compose_answers(req.answers)
    else:
        response = (req.clarificationResponse or "").strip()
    if not response:
        raise ValueError("answers 或 clarificationResponse 至少需提供一个非空值")
    return response


# 兼容已有测试和内部调用名称，实际表单协议只有一个实现。
_interrupt_payload = build_interrupt_form


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
    present_update=present_update,
    present_done=present_done,
    compose_resume_value=_compose_resume_value,
    messages_state_key="messages",
    result_key="ppt_result",
))
