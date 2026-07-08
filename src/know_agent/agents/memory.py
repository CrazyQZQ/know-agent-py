"""长期记忆 - mem0 云端（OpenMemory）.

与 checkpoint（短期会话历史）互补：
- checkpoint: 单 thread 内的消息/状态恢复（thread.py 暴露历史接口）
- mem0: 跨 thread/会话的长期记忆（用户偏好、事实、重要信息），云端托管

c 方案：自动提取（每轮对话后 mem0.add）+ 检索注入（agent 调用前 mem0.search
注入 system prompt）。无 MEM0_API_KEY 时旁路，不影响主流程。
"""

from functools import lru_cache

from loguru import logger

from know_agent.configuration import get_settings


@lru_cache
def get_memory():
    """mem0 云端单例；无 MEM0_API_KEY 返回 None（旁路）."""
    s = get_settings()
    if not s.mem0_api_key:
        return None
    try:
        from mem0 import Memory

        return Memory(api_key=s.mem0_api_key)
    except Exception as e:
        logger.warning("mem0 初始化失败，记忆系统旁路: {}", e)
        return None


def search_memories(query: str, user_id: str, limit: int = 5) -> list[str]:
    """检索用户长期记忆，返回记忆文本列表（用于注入 system prompt）."""
    m = get_memory()
    if m is None or not user_id:
        return []
    try:
        results = m.search(query, user_id=user_id, limit=limit)
        return [r["memory"] for r in results if r.get("memory")]
    except Exception as e:
        logger.warning("mem0 检索失败: {}", e)
        return []


def extract_memories(thread_id: str, user_id: str) -> None:
    """从 checkpoint 取 thread 完整消息，提交 mem0 自动提取记忆（后台任务）."""
    m = get_memory()
    if m is None or not user_id:
        return
    try:
        from know_agent.agents.checkpoint import get_checkpointer

        cp = get_checkpointer()
        if cp is None:
            return
        state = cp.get_state({"configurable": {"thread_id": thread_id}})
        if not state or not state.values:
            return
        messages = state.values.get("messages", [])
        # 转 mem0 格式 [{role, content}]，仅 human/ai
        msgs = []
        for msg in messages:
            role = {"human": "user", "ai": "assistant"}.get(getattr(msg, "type", ""))
            content = getattr(msg, "content", "")
            if role and content:
                msgs.append({"role": role, "content": content})
        if not msgs:
            return
        m.add(msgs, user_id=user_id)
        logger.info("mem0 提取记忆: thread={} user={} msgs={}", thread_id, user_id, len(msgs))
    except Exception as e:
        logger.warning("mem0 提取失败: {}", e)
