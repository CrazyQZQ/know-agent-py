"""pgvector 向量库 — langchain-postgres PGVector.

支持多知识库隔离：按 knowledge_base_type 分 collection（collection_for），
get_vectorstore 按 collection_name 缓存单例，不同知识库向量互不干扰。
"""

from functools import lru_cache

from langchain_postgres import PGVector

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
    """获取指定 collection 的向量库单例；无 DATABASE_URL 时返回 None."""
    s = get_settings()
    if not s.database_url_safe:
        return None
    return PGVector(
        connection=s.database_url_safe,
        embeddings=get_embeddings(),
        collection_name=collection_name,
        use_jsonb=True,
    )
