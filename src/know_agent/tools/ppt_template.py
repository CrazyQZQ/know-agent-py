"""PPT 模板工具 — 对应源项目 PptTemplateTool.

阶段 4（PPT graph）完整实现模板查询/Schema 生成，此处先提供占位。
"""

from langchain_core.tools import tool

from know_agent.core.resilient import resilient


@tool
@resilient(fallback="PPT 模板列表获取失败，请告知用户暂时无法获取模板列表。")
def list_ppt_templates() -> str:
    """列出可用的 PPT 模板."""
    return "可用模板: ai（AI科技风PPT，5页，适用于AI/科技场景）"
