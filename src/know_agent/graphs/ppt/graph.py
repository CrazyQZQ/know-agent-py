"""PPT 生成 graph — StateGraph 组装.

对应源项目 PptBuildGraph.build()。工作流：
  START → requirement → (search | clarification)
          clarification → requirement（interrupt_before，人在回路）
          search → template_select → template_info → outline → schema → render → END
"""

from functools import lru_cache

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


@lru_cache
def get_ppt_graph():
    return build_ppt_graph()
