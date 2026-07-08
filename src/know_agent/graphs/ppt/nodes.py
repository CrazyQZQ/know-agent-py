"""PPT graph 普通节点 — requirement / clarification / template_info / render.

对应源项目 RequirementNode / ClarificationNode / RenderNode + template_info 内联节点。
"""

import json
import re

from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from know_agent.graphs.ppt.prompts import REQUIREMENT_GRAPH_PROMPT
from know_agent.graphs.ppt.render import render_ppt
from know_agent.llm.chat import get_chat_model

# 模板信息（对应源项目 PptBuildGraph 中硬编码的 ai 模板）
# file_path 是 OSS 上的模板路径，需预先上传 ai.pptx 到 RustFS
_TEMPLATE_SCHEMA = {
    "slides": [
        {"pageType": "COVER", "pageDesc": "封面页", "pageIndex": 1, "data": {
            "title": {"type": "text", "fontLimit": 7},
            "description": {"type": "text", "fontLimit": 30},
            "author": {"type": "text", "fontLimit": 10}}},
        {"pageType": "CATALOG", "pageDesc": "目录页", "pageIndex": 2, "data": {
            "catalog1": {"type": "text", "fontLimit": 9},
            "catalog2": {"type": "text", "fontLimit": 9},
            "catalog3": {"type": "text", "fontLimit": 9}}},
        {"pageType": "COMPARE", "pageDesc": "对比页", "pageIndex": 3, "data": {
            "title": {"type": "text", "fontLimit": 9},
            "content1": {"type": "text", "fontLimit": 60},
            "content2": {"type": "text", "fontLimit": 60}}},
        {"pageType": "CONTENT", "pageDesc": "内容页", "pageIndex": 4, "data": {
            "title": {"type": "text", "fontLimit": 9},
            "subTitle": {"type": "text", "fontLimit": 4},
            "content": {"type": "text", "fontLimit": 55},
            "image": {"type": "image"}}},
        {"pageType": "END", "pageDesc": "结束页", "pageIndex": 5, "data": {
            "title": {"type": "text", "fontLimit": 5}}},
    ]
}

TEMPLATE_INFO = {
    "file_path": "ppt-templates/ai.pptx",
    "template_code": "ai",
    "template_name": "AI科技风PPT",
    "slide_count": 5,
    "style_tags": "科技、AI、人工智能",
    "template_desc": "适用于AI、人工智能、科技风等场景的PPT",
    "template_schema": json.dumps(_TEMPLATE_SCHEMA, ensure_ascii=False),
}


def requirement_node(state: dict) -> dict:
    """需求澄清节点：判断信息是否完整，决定下一步 search 或 clarification."""
    chat = get_chat_model()
    input_text = state.get("input", "")
    response = chat.invoke([SystemMessage(REQUIREMENT_GRAPH_PROMPT), HumanMessage(input_text)])
    output = response.content or ""
    info_complete = output.strip().startswith("[COMPLETE]")
    content = re.sub(r"^\[(COMPLETE|INCOMPLETE)\]\s*", "", output.strip())
    next_node = "search" if info_complete else "clarification"
    logger.info("requirement_node: info_complete={}, next={}", info_complete, next_node)
    return {
        "requirement": content,
        "info_complete": info_complete,
        "next_node": next_node,
        "clarification": "" if info_complete else content,
    }


def clarification_node(state: dict) -> dict:
    """澄清节点：用户回复后合并到 input（interrupt_before 在执行此节点前暂停等回复）."""
    resp = state.get("clarification_response", "")
    if resp:
        original = state.get("input", "")
        return {"input": original + "\n\n【用户补充信息】" + resp}
    return {}


def template_info_node(state: dict) -> dict:
    """模板信息节点：根据 template_code 提供模板信息（简化：固定 ai 模板）."""
    return {"template_info": json.dumps(TEMPLATE_INFO, ensure_ascii=False)}


def render_node(state: dict) -> dict:
    """渲染节点：调 render_ppt.py 生成 PPT 并上传 OSS."""
    template_info = state.get("template_info", "")
    ppt_schema = state.get("ppt_schema", "")
    if not ppt_schema:
        logger.warning("render_node: ppt_schema 为空")
        return {"ppt_result": ""}

    # 解析模板 URL
    try:
        info = json.loads(template_info)
        template_url = info.get("file_path", "")
    except Exception:
        template_url = template_info

    # 去除可能的 markdown 代码块包裹
    schema = ppt_schema.strip()
    if schema.startswith("```"):
        schema = re.sub(r"^```(?:json)?\s*", "", schema)
        schema = re.sub(r"\s*```$", "", schema)

    file_url = render_ppt("ppt-graph", template_url, schema)
    logger.info("render_node: ppt_result={}", file_url)
    return {"ppt_result": file_url}
