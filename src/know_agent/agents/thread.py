"""thread 管理 — 基于 langgraph checkpoint（PostgresSaver）.

对应源项目 ThreadService。thread 由 checkpoint 的 thread_id 标识，
对话历史与状态都存在 checkpoints/checkpoint_writes/checkpoint_blobs 表（PostgresSaver 建）。
"""

import uuid

from sqlalchemy import text

from know_agent.db.postgres import SessionLocal


def _checkpoints_table_exists(db) -> bool:
    try:
        db.execute(text("SELECT 1 FROM checkpoints LIMIT 1"))
        return True
    except Exception:
        return False


def list_threads() -> list[dict]:
    db = SessionLocal()
    try:
        if not _checkpoints_table_exists(db):
            return []
        rows = db.execute(
            text("SELECT DISTINCT thread_id FROM checkpoints ORDER BY thread_id")
        ).mappings().all()
        return [{"thread_id": r["thread_id"]} for r in rows]
    finally:
        db.close()


def _format_message(msg) -> dict | None:
    """格式化 langgraph Message 为 {role, content}，仅保留 user/assistant 对话."""
    role = {"human": "user", "ai": "assistant"}.get(getattr(msg, "type", ""))
    if role is None:
        return None  # 跳过 tool/system 等非对话消息
    content = getattr(msg, "content", "")
    if not content:
        return None
    return {"role": role, "content": content}


def _thread_messages(thread_id: str) -> list[dict]:
    """从 checkpoint 取 thread 历史消息，格式化为 [{role, content}]."""
    from know_agent.agents.checkpoint import get_checkpointer

    cp = get_checkpointer()
    if cp is None:
        return []
    state = cp.get_state({"configurable": {"thread_id": thread_id}})
    if not state or not state.values:
        return []
    return [m for m in (_format_message(msg) for msg in state.values.get("messages", [])) if m]


def get_thread(thread_id: str) -> dict | None:
    """获取 thread（含历史消息）。无 state 返回 None."""
    messages = _thread_messages(thread_id)
    if not messages:
        return None
    return {"thread_id": thread_id, "messages": messages}


def get_thread_history(thread_id: str) -> list[dict]:
    """获取 thread 历史消息列表（进入旧会话时拉取展示）."""
    t = get_thread(thread_id)
    return t["messages"] if t else []


def create_thread(thread_id: str | None = None) -> str:
    return thread_id or str(uuid.uuid4())


def delete_thread(thread_id: str) -> bool:
    db = SessionLocal()
    try:
        if not _checkpoints_table_exists(db):
            return False
        db.execute(text("DELETE FROM checkpoints WHERE thread_id = :tid"), {"tid": thread_id})
        db.execute(text("DELETE FROM checkpoint_writes WHERE thread_id = :tid"), {"tid": thread_id})
        db.execute(text("DELETE FROM checkpoint_blobs WHERE thread_id = :tid"), {"tid": thread_id})
        db.commit()
        return True
    except Exception:
        return False
    finally:
        db.close()
