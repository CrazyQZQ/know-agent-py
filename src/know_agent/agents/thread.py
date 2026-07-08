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


def get_thread(thread_id: str) -> dict | None:
    from know_agent.agents.checkpoint import get_checkpointer

    cp = get_checkpointer()
    if cp is None:
        return None
    state = cp.get_state({"configurable": {"thread_id": thread_id}})
    if not state or not state.values:
        return None
    return {"thread_id": thread_id, "values": state.values}


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
