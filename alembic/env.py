"""Alembic 运行环境 — 接入项目配置与 ORM 元数据."""

from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

from know_agent.configuration import get_settings
from know_agent.db.base import Base
import know_agent.models.document  # noqa: F401  确保模型注册到 Base.metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 直接用项目配置的连接串（密码已 percent-encode），不走 alembic.ini 的 configparser，
# 避免 %40 等编码字符被 configparser 当作插值语法。
_settings = get_settings()
_url = _settings.database_url_safe

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    if not _url:
        raise RuntimeError("DATABASE_URL 未配置，无法运行迁移")
    connectable = create_engine(_url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
