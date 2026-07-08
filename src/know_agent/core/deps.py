"""FastAPI 依赖注入."""

from collections.abc import Iterator

from sqlalchemy.orm import Session

from know_agent.configuration import Settings, get_settings
from know_agent.db.postgres import SessionLocal


def get_settings_dep() -> Settings:
    return get_settings()


def get_db() -> Iterator[Session]:
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL 未配置，无法连接 PostgreSQL")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
