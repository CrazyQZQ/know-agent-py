"""FastAPI 应用入口."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.core.logging import setup_logging
from know_agent.core.middleware import RequestIdMiddleware
from know_agent.core.observability import setup_tracing
from know_agent.core.security import verify_auth
from know_agent.routers import agent as agent_router
from know_agent.routers import auth as auth_router
from know_agent.routers import document as document_router
from know_agent.routers import graph as graph_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    settings = get_settings()
    # 可观测性：LangSmith tracing（必须在 agent 首次创建前注入环境变量）
    setup_tracing(settings)
    # 阶段1: 初始化 PostgreSQL engine、OSS client、MCP client
    # 阶段3: PostgresSaver (langgraph checkpoint) 在 get_checkpointer() 首次调用时初始化
    yield
    # 资源清理


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="LangChain/LangGraph + FastAPI 智能体应用",
        lifespan=lifespan,
    )
    # CORS 允许源（配置化，默认 * 开发友好，生产应配白名单）
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # request_id 注入（纯 ASGI，包住所有业务路由）
    app.add_middleware(RequestIdMiddleware)
    # API 限流（slowapi）：保护高成本端点，超频返回 429
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "app": settings.app_name}

    # 业务路由（受认证保护，/health 放行）- 统一 /v1 前缀，为破坏性变更留退路
    _auth = [Depends(verify_auth)]
    # 认证路由（login/logout 公开，me 在端点级受保护）
    app.include_router(auth_router.router, prefix="/v1/api/auth", tags=["auth"])
    app.include_router(document_router.router, prefix="/v1/api/document", tags=["document"], dependencies=_auth)
    app.include_router(document_router.segment_router, prefix="/v1/api/segment", tags=["segment"], dependencies=_auth)
    app.include_router(agent_router.router, prefix="/v1", tags=["agent"], dependencies=_auth)
    app.include_router(graph_router.router, prefix="/v1", tags=["graph"], dependencies=_auth)
    return app


app = create_app()
