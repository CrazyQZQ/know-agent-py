"""PPT graph agent 节点 — search / template_select / outline / schema.

对应源项目 PptBuildGraph 中的 4 个 ReactAgent 节点。
- search / template_select：create_agent + 工具
- outline / schema：直接 chat_model.invoke（无工具，纯生成）
每个节点把 agent 输出写到 state 的对应 key（对应源项目 outputKey）。
"""

from functools import lru_cache

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage

from know_agent.graphs.ppt.prompts import (
    OUTLINE_PROMPT,
    SCHEMA_CONTENT_INSTRUCTION,
    SEARCH_INFO_PROMPT,
    TEMPLATE_SELECTION_PROMPT,
)
from know_agent.llm.chat import get_chat_model
from know_agent.tools.knowledge_base_search import knowledge_base_search
from know_agent.tools.ppt_template import list_ppt_templates


@lru_cache
def _search_agent():
    return create_agent(
        model=get_chat_model(),
        tools=[knowledge_base_search],
        system_prompt="你是专业的信息收集助手，擅长根据需求搜集相关信息。",
    )


def search_node(state: dict) -> dict:
    """信息收集节点 → search_info."""
    prompt = SEARCH_INFO_PROMPT.replace("{requirement}", state.get("requirement", ""))
    result = _search_agent().invoke({"messages": [HumanMessage(content=prompt)]})
    return {"search_info": result["messages"][-1].content}


@lru_cache
def _template_select_agent():
    return create_agent(
        model=get_chat_model(),
        tools=[list_ppt_templates],
        system_prompt="你是PPT模板选择专家，擅长根据需求选择合适的PPT模板。",
    )


def template_select_node(state: dict) -> dict:
    """模板选择节点 → template_code."""
    prompt = (
        TEMPLATE_SELECTION_PROMPT
        .replace("{requirement}", state.get("requirement", ""))
        .replace("{search_info}", state.get("search_info", ""))
    )
    result = _template_select_agent().invoke({"messages": [HumanMessage(content=prompt)]})
    return {"template_code": result["messages"][-1].content}


def outline_node(state: dict) -> dict:
    """大纲生成节点 → ppt_outline（无工具，纯 LLM 生成）."""
    prompt = (
        OUTLINE_PROMPT
        .replace("{requirement}", state.get("requirement", ""))
        .replace("{search_info}", state.get("search_info", ""))
        .replace("{template_info}", state.get("template_info", ""))
    )
    response = get_chat_model().invoke([HumanMessage(content=prompt)])
    return {"ppt_outline": response.content}


def schema_node(state: dict) -> dict:
    """Schema 生成节点 → ppt_schema（无工具，template_info 含 schema 定义）."""
    instruction = (
        SCHEMA_CONTENT_INSTRUCTION
        .replace("<template_info>", state.get("template_info", ""))
        .replace("<ppt_outline>", state.get("ppt_outline", ""))
    )
    response = get_chat_model().invoke(
        [HumanMessage(content=instruction + "\n\n请根据以上信息生成 PPT Schema JSON。")]
    )
    return {"ppt_schema": response.content}
