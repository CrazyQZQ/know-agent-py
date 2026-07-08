"""PostgreSQL 引擎与会话工厂.

统一承载：
  - 业务数据（文档/分块，SQLAlchemy ORM）
  - pgvector 向量（langchain-postgres PGVector）
  - langgraph checkpoint（PostgresSaver）

无 DATABASE_URL 时不初始化 engine，避免无配置时启动失败。
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from know_agent.configuration import get_settings

_settings = get_settings()


def _build_engine():
    url = _settings.database_url_safe
    if not url:
        return None
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=3600,
        pool_size=5,
        max_overflow=10,
        future=True,
    )


engine = _build_engine()
SessionLocal = (
    sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    if engine
    else None
)
