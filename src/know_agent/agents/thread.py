"""thread 管理 — 基于 langgraph checkpoint（PostgresSaver）.

对应源项目 ThreadService。thread 由 checkpoint 的 thread_id 标识，
对话历史与状态都存在 checkpoints/checkpoint_writes/checkpoint_blobs 表（PostgresSaver 建）。
"""

import uuid

from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger
from sqlalchemy import text

from know_agent.db.postgres import SessionLocal
from know_agent.llm.chat import get_thread_title_model


def _fallback_title(message: str, limit: int = 30) -> str:
    title = " ".join((message or "").split())
    return title[:limit] or "新会话"


def _checkpoints_table_exists(db) -> bool:
    try:
        db.execute(text("SELECT 1 FROM checkpoints LIMIT 1"))
        return True
    except Exception:
        db.rollback()
        return False


def list_threads(app_name: str | None = None, user_id: str | None = None) -> list[dict]:
    db = SessionLocal()
    try:
        where_parts: list[str] = []
        params: dict[str, str] = {}
        if app_name is not None:
            where_parts.append("app_name = :app_name")
            params["app_name"] = app_name
        if user_id is not None:
            where_parts.append("user_id = :user_id")
            params["user_id"] = user_id
        where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        rows = db.execute(
            text(f"""
                SELECT thread_id, app_name, user_id, name, created_at, updated_at
                FROM agent_threads
                {where_sql}
                ORDER BY updated_at DESC
            """),
            params,
        ).mappings().all()
        return [dict(r) for r in rows]
    except Exception as exc:
        db.rollback()
        logger.warning("list agent_threads failed, fallback to checkpoints: {}", exc)
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
    checkpoint_tuple = cp.get_tuple({"configurable": {"thread_id": thread_id}})
    if not checkpoint_tuple:
        return []
    messages = checkpoint_tuple.checkpoint.get("channel_values", {}).get("messages", [])
    return [m for m in (_format_message(msg) for msg in messages) if m]


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


def ensure_thread_meta(
    thread_id: str,
    app_name: str,
    user_id: str | None,
    first_message: str,
) -> bool:
    """确保 thread 元数据存在；返回 True 表示本次首次创建。"""
    db = SessionLocal()
    try:
        exists = db.execute(
            text("SELECT EXISTS (SELECT 1 FROM agent_threads WHERE thread_id = :thread_id)"),
            {"thread_id": thread_id},
        ).scalar()
        if exists:
            db.execute(
                text("UPDATE agent_threads SET updated_at = now() WHERE thread_id = :thread_id"),
                {"thread_id": thread_id},
            )
            db.commit()
            return False
        db.execute(
            text("""
                INSERT INTO agent_threads (thread_id, app_name, user_id, name)
                VALUES (:thread_id, :app_name, :user_id, :name)
            """),
            {
                "thread_id": thread_id,
                "app_name": app_name,
                "user_id": user_id,
                "name": _fallback_title(first_message),
            },
        )
        db.commit()
        return True
    finally:
        db.close()


def _clean_generated_title(raw: str, first_message: str) -> str:
    title = (raw or "").strip().strip("\"'“”‘’`")
    title = title.replace("\n", " ").strip()
    if not title:
        return _fallback_title(first_message)
    return title[:30]


def generate_and_update_thread_title(thread_id: str, first_message: str) -> str:
    """调用标题模型生成 thread 名称并写回，失败时使用用户首句兜底。"""
    try:
        model = get_thread_title_model()
        result = model.invoke([
            SystemMessage(content="请根据用户首条消息生成一个简短中文会话标题。只输出标题，不要解释，不超过15个字。"),
            HumanMessage(content=first_message),
        ])
        title = _clean_generated_title(getattr(result, "content", ""), first_message)
    except Exception as exc:
        logger.warning("generate thread title failed: {}", exc)
        title = _fallback_title(first_message)

    db = SessionLocal()
    try:
        db.execute(
            text("UPDATE agent_threads SET name = :name, updated_at = now() WHERE thread_id = :thread_id"),
            {"thread_id": thread_id, "name": title},
        )
        db.commit()
    finally:
        db.close()
    return title


def delete_thread(thread_id: str, app_name: str | None = None, user_id: str | None = None) -> bool:
    db = SessionLocal()
    try:
        scope_parts = ["thread_id = :tid"]
        params = {"tid": thread_id}
        if app_name is not None:
            scope_parts.append("app_name = :app_name")
            params["app_name"] = app_name
        if user_id is not None:
            scope_parts.append("user_id = :user_id")
            params["user_id"] = user_id
        scope_sql = " AND ".join(scope_parts)
        if app_name is not None or user_id is not None:
            exists = db.execute(
                text(f"""
                    SELECT EXISTS (
                        SELECT 1 FROM agent_threads
                        WHERE {scope_sql}
                    )
                """),
                params,
            ).scalar()
            if not exists:
                db.rollback()
                return False
        from know_agent.agents.checkpoint import get_checkpointer

        checkpointer = get_checkpointer()
        if checkpointer is not None:
            checkpointer.delete_thread(thread_id)
        db.execute(
            text(f"""
                DELETE FROM agent_threads
                WHERE {scope_sql}
            """),
            params,
        )
        db.commit()
        return True
    except Exception as exc:
        db.rollback()
        logger.warning("delete thread failed: thread_id={}, app_name={}, user_id={}, error={}", thread_id, app_name, user_id, exc)
        return False
    finally:
        db.close()
