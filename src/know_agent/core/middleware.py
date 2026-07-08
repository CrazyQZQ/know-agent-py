"""HTTP 中间件 — request_id 注入.

纯 ASGI 中间件（非 BaseHTTPMiddleware），避免 contextvar 跨 task 不传播的坑。
每请求从 `x-request-id` 头读取或生成 UUID，写入 contextvar 并回写响应头。
"""

import uuid

from starlette.types import ASGIApp, Receive, Scope, Send

from know_agent.core.request_context import (
    reset_current_user,
    reset_request_id,
    set_current_user,
    set_request_id,
)

_REQUEST_ID_HEADER = b"x-request-id"
_USER_HEADER = b"x-user"


class RequestIdMiddleware:
    """纯 ASGI 中间件：注入 request_id 到请求上下文 + 响应头."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 从请求头读 request_id，缺失则生成
        rid: str | None = None
        user: str | None = None
        for k, v in scope.get("headers", []):
            if k == _REQUEST_ID_HEADER:
                rid = v.decode("utf-8", errors="ignore")
            elif k == _USER_HEADER:
                user = v.decode("utf-8", errors="ignore")
        if not rid:
            rid = str(uuid.uuid4())

        token_rid = set_request_id(rid)
        token_user = set_current_user(user)

        async def send_wrapper(message: dict) -> None:
            if message["type"] == "http.response.start":
                # 回写响应头，便于客户端/前端关联
                message.setdefault("headers", []).append(
                    (_REQUEST_ID_HEADER, rid.encode("utf-8"))
                )
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            reset_request_id(token_rid)
            reset_current_user(token_user)
