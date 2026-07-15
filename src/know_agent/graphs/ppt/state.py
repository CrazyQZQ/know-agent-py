"""PPT graph 状态定义 — 对应源项目 PptBuildGraph.createKeyStrategyFactory.

messages 用 add_messages（Append），其余 key 默认 replace。
"""

from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class PptState(TypedDict, total=False):
    input: str
    requirement: str
    info_complete: bool
    next_node: str
    clarification: str
    clarification_options: list[dict]
    clarification_response: str
    search_info: str
    template_code: str
    template_info: str
    ppt_outline: str
    ppt_schema: str
    ppt_result: str
    messages: Annotated[list, add_messages]
