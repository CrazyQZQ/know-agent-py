"""请求级上下文 — 基于 contextvar 传递 request_id，供日志关联.

contextvar 在 asyncio task 间正确传播（子 task 继承父 task context），
因此纯 ASGI 中间件设置的 request_id，在请求处理链路（含 agent.invoke 同步调用）内的
所有 loguru 日志都能读到。
"""

import contextvars

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
# 当前用户标识（从 x-user 头或 Casdoor JWT 提取），用于日志/权限
user_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "user", default=None
)
# 当前用户角色列表（从 Casdoor JWT 提取），用于 accessible_by 权限过滤
roles_var: contextvars.ContextVar[list[str] | None] = contextvars.ContextVar(
    "roles", default=None
)
# RAG 检索来源（工具内写入，agent SSE 旁路读取发给前端 Sources 组件）
rag_sources_var: contextvars.ContextVar[list[dict] | None] = contextvars.ContextVar(
    "rag_sources", default=None
)


def get_request_id() -> str | None:
    return request_id_var.get()


def set_request_id(rid: str | None) -> contextvars.Token[str | None]:
    return request_id_var.set(rid)


def reset_request_id(token: contextvars.Token[str | None]) -> None:
    request_id_var.reset(token)


def get_current_user() -> str | None:
    return user_var.get()


def set_current_user(user: str | None) -> contextvars.Token[str | None]:
    return user_var.set(user)


def reset_current_user(token: contextvars.Token[str | None]) -> None:
    user_var.reset(token)


def get_current_roles() -> list[str]:
    """当前用户角色列表（无上下文时返回空列表）."""
    return roles_var.get() or []


def set_current_roles(roles: list[str] | None) -> contextvars.Token[list[str] | None]:
    return roles_var.set(roles or [])


def reset_current_roles(token: contextvars.Token[list[str] | None]) -> None:
    roles_var.reset(token)


def get_rag_sources() -> list[dict]:
    return rag_sources_var.get() or []


def set_rag_sources(sources: list[dict] | None) -> contextvars.Token[list[dict] | None]:
    return rag_sources_var.set(sources or [])


def reset_rag_sources(token: contextvars.Token[list[dict] | None]) -> None:
    rag_sources_var.reset(token)
