"""pgvector 向量库 — langchain-postgres PGVector.

支持多知识库隔离：按 knowledge_base_type 分 collection（collection_for），
get_vectorstore 按 collection_name 缓存单例，不同知识库向量互不干扰。
HNSW 索引由 alembic 0004 建于 langchain_pg_embedding.embedding；
ef_search 通过 engine connect 事件在每个连接 SET（hnsw_ef_search 配置）。
"""

from functools import lru_cache

from langchain_postgres import PGVector
from loguru import logger
from sqlalchemy import event
from sqlalchemy.engine import Engine

from know_agent.configuration import get_settings
from know_agent.llm.embedding import get_embeddings

DEFAULT_COLLECTION = "know_agent"


def collection_for(knowledge_base_type: str | None) -> str:
    """按知识库类型解析 collection 名；None/空 用默认 collection（向后兼容）."""
    if not knowledge_base_type:
        return DEFAULT_COLLECTION
    return f"{DEFAULT_COLLECTION}_{knowledge_base_type}"


@lru_cache
def get_vectorstore(collection_name: str = DEFAULT_COLLECTION) -> PGVector | None:
    """获取指定 collection 的向量库单例；无 DATABASE_URL 或初始化失败时返回 None.

    HNSW ef_search 通过 engine connect 事件在每个连接 SET（pgvector 会话参数，
    影响 HNSW 检索候选池大小，越大召回越高、越慢）。

    向量库初始化失败（DB 不可用/API 不兼容/embedding 服务异常等）时返回 None，
    向量检索自动降级（hybrid 退化为纯关键词）。lru_cache 缓存 None，进程内不重试
    （简单熔断，避免每次请求都连失败的 DB；重启服务才会重新尝试）。
    """
    s = get_settings()
    if not s.database_url_safe:
        return None
    try:
        vs = PGVector(
            connection=s.database_url_safe,
            embeddings=get_embeddings(),
            collection_name=collection_name,
            use_jsonb=True,
            # 固定维度 vector(N)：HNSW 索引要求列有维度，无维度无法建索引
            # langchain-postgres 0.0.17 起 dimensions 改名 embedding_length
            embedding_length=s.embedding_dimensions,
        )
    except Exception as e:
        logger.warning("向量库初始化失败，向量检索降级（collection={}）: {}", collection_name, e)
        return None
    # 仅对真实 Engine 注册（测试中 MagicMock 跳过）
    engine = getattr(vs, "_engine", None)
    if isinstance(engine, Engine) and s.hnsw_ef_search:
        ef = int(s.hnsw_ef_search)

        @event.listens_for(engine, "connect")
        def _set_hnsw_ef_search(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute(f"SET hnsw.ef_search = {ef}")
            cur.close()
    return vs
