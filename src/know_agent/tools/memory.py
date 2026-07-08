"""长期记忆工具 - 用户显式"记住XXX"时 agent 主动调用 save_memory.

与 mem0 自动提取（run_sse 的 BackgroundTasks）互补：
- 自动提取：每轮对话后台兜底，提取所有事实
- save_memory：用户显式"记住"指令时 agent 即时调用，确保记住
mem0 add 幂等（相似记忆合并），两路径不冲突。
"""

from langchain_core.tools import tool

from know_agent.core.resilient import resilient


@tool
@resilient(fallback="记忆保存失败，请告知用户稍后重试。")
def save_memory(content: str) -> str:
    """保存长期记忆。当用户明确要求记住某事（如"记住我喜欢咖啡"）时调用。

    Args:
        content: 要记住的内容（用户希望长期记住的信息）
    """
    from langgraph.config import get_config

    from know_agent.agents.memory import get_memory

    config = get_config()
    user_id = (config.get("metadata") or {}).get("user_id") or ""
    m = get_memory()
    if m is None:
        return "记忆系统未配置（未配 MEM0_API_KEY）"
    if not user_id:
        return "无法识别用户，记忆未保存"
    m.add(content, user_id=user_id)
    return f"已记住: {content}"
