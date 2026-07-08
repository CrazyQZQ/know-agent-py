"""pgvector 向量库 — langchain-postgres PGVector."""

from functools import lru_cache

from langchain_postgres import PGVector

from know_agent.configuration import get_settings
from know_agent.llm.embedding import get_embeddings


@lru_cache
def get_vectorstore() -> PGVector | None:
    """获取向量库单例；无 DATABASE_URL 时返回 None."""
    s = get_settings()
    if not s.database_url_safe:
        return None
    return PGVector(
        connection=s.database_url_safe,
        embeddings=get_embeddings(),
        collection_name="know_agent",
        use_jsonb=True,
    )
