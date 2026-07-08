"""知识库检索工具 — 生产级 RAG pipeline.

流程：QueryTransformer(多查询+HyDE) → MultiQueryRetriever(混合检索+跨查询RRF)
    → Reranker(Jina cross-encoder, 可降级) → ContentInjector(引用标注)
QueryRouter 由 agentic RAG 承担（create_agent 自主决定是否调用本工具）。
"""

from langchain_core.tools import tool


@tool
def knowledge_base_search(query: str, top_k: int = 5) -> str:
    """根据用户问题查询知识库，返回带来源标注的相关文档片段。用于回答知识库相关问题.

    Args:
        query: 用户问题或检索意图（自然语言）
        top_k: 返回的文档片段数量，默认 5
    """
    from know_agent.core.request_context import get_current_roles
    from know_agent.db.postgres import SessionLocal
    from know_agent.services.document.rag.pipeline import RagPipeline
    from know_agent.services.document.search import SearchService

    db = SessionLocal()
    try:
        return RagPipeline(SearchService(db)).run(query, top_k=top_k, roles=get_current_roles())
    finally:
        db.close()
