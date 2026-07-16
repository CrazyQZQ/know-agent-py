"""知识库检索工具 — 生产级 RAG pipeline.

流程：QueryTransformer(多查询+HyDE) → MultiQueryRetriever(混合检索+跨查询RRF)
    → Reranker(Jina cross-encoder, 可降级) → ContentInjector(引用标注)
QueryRouter 由 agentic RAG 承担（create_agent 自主决定是否调用本工具）。
"""

from langchain_core.tools import tool

from know_agent.core.resilient import resilient


@tool
@resilient(
    fallback="知识库检索暂时不可用，请基于自身已有信息回答用户。",
    circuit=True,
    failure_threshold=5,
    recovery_timeout=60,
)
def knowledge_base_search(query: str, top_k: int = 5, knowledge_base_type: str | None = None) -> str:
    """根据用户问题查询知识库，返回带来源标注的相关文档片段。用于回答知识库相关问题.

    Args:
        query: 用户问题或检索意图（自然语言）
        top_k: 返回的文档片段数量，默认 5
        knowledge_base_type: 知识库类型（如 DOCUMENT_SEARCH），按类型隔离向量检索；None 用默认 collection
    """
    from know_agent.core.request_context import get_current_roles, get_current_user, set_rag_sources
    from know_agent.db.postgres import SessionLocal
    from know_agent.services.document.rag.pipeline import RagPipeline
    from know_agent.services.document.search import SearchService

    db = SessionLocal()
    try:
        text, sources = RagPipeline(SearchService(db)).run_with_sources(
            query, top_k=top_k, roles=get_current_roles(), knowledge_base_type=knowledge_base_type,
            current_user=get_current_user(),
        )
        # 旁路存来源，供 agent SSE 发给前端 Sources 组件
        set_rag_sources(sources)
        return text
    finally:
        db.close()
