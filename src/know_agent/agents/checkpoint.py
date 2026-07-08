"""langgraph checkpoint — PostgresSaver（复用业务库 PG 实例）.

对应源项目 NamedMysqlSaver。Spring AI 原本 ChatMemory + MysqlSaver 两套持久化，
Python 合一：PostgresSaver 同时承担对话历史与 agent 状态恢复。
"""

import psycopg
from functools import lru_cache

from langgraph.checkpoint.postgres import PostgresSaver

from know_agent.configuration import get_settings


@lru_cache
def get_checkpointer() -> PostgresSaver | None:
    s = get_settings()
    if not s.database_url_safe:
        return None
    # psycopg 不认 SQLAlchemy 的 +psycopg driver 标记，去掉
    pg_url = s.database_url_safe.replace("postgresql+psycopg://", "postgresql://")
    # autocommit=True：setup 的 CREATE INDEX CONCURRENTLY 不能在事务里；
    # langgraph PostgresSaver 写入后不显式 commit，依赖 autocommit 自动提交
    conn = psycopg.connect(pg_url, autocommit=True)
    saver = PostgresSaver(conn)
    saver.setup()  # 建 checkpoints / checkpoint_writes / checkpoint_blobs 表
    return saver
