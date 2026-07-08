"""日期时间工具 — 对应源项目 DateTimeTool."""

from datetime import datetime

from langchain_core.tools import tool

from know_agent.core.resilient import resilient


@tool
@resilient(fallback="当前时间获取失败，请告知用户无法获取时间。")
def get_current_time(format: str = "yyyy-MM-dd HH:mm:ss") -> str:
    """获取当前系统时间。format 仅支持: 'yyyy-MM-dd','yyyy-MM-dd HH:mm:ss','yyyy-MM-dd HH:mm'."""
    fmt = (
        format.replace("yyyy", "%Y")
        .replace("MM", "%m")
        .replace("dd", "%d")
        .replace("HH", "%H")
        .replace("mm", "%M")
        .replace("ss", "%S")
    )
    return datetime.now().strftime(fmt)
