"""SQLAlchemy 声明式基类与通用混入."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """所有 ORM 模型的基类."""


class TimestampMixin:
    """created_at / updated_at — 对应源项目 BaseEntity."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.current_timestamp(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        nullable=False,
    )


class SoftDeleteMixin:
    """deleted (软删) / lock_version (乐观锁) — 对应源项目 BaseEntity."""

    deleted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lock_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
