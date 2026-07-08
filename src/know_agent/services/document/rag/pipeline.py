"""生产级 RAG pipeline 编排.

流程：QueryTransformer → MultiQueryRetriever → Reranker → ContentInjector
  ① 查询改写：multi-query + HyDE，扩大召回
  ② 多查询混合检索：keyword(pg_trgm) + vector(pgvector) + 跨查询 RRF 融合
  ③ 重排序：Jina cross-encoder 精排（无 key 自动降级为 RRF 排序）
  ④ 内容注入：带来源标注的结构化上下文

QueryRouter 由 agentic RAG 承担（create_agent 自主决定是否调用检索工具），不单独实现。
"""

from loguru import logger

from know_agent.configuration import get_settings
from know_agent.llm.chat import get_chat_model
from know_agent.services.document.rag.injector import inject
from know_agent.services.document.rag.query_transformer import QueryTransformer
from know_agent.services.document.rag.reranker import Reranker
from know_agent.services.document.rag.retriever import MultiQueryRetriever
from know_agent.services.document.search import SearchService


class RagPipeline:
    """生产级 RAG 检索管线."""

    def __init__(self, search_service: SearchService):
        self.search = search_service
        s = get_settings()
        self.transformer = QueryTransformer(
            llm=get_chat_model(),
            enable_multi_query=s.rag_multi_query,
            enable_hyde=s.rag_hyde,
        )
        self.retriever = MultiQueryRetriever(search_service)
        self.reranker = Reranker(
            api_key=s.jina_api_key,
            model=s.rag_rerank_model,
            enabled=s.rag_rerank,
        )
        self.top_k = s.rag_top_k
        self.candidate_pool = s.rag_candidate_pool

    def run(self, query: str, top_k: int | None = None, roles: list[str] | None = None) -> str:
        """执行完整 RAG 流程，返回带引用标注的上下文文本."""
        top_k = top_k or self.top_k
        logger.info("[rag] 开始检索: query={!r} top_k={} roles={}", query[:80], top_k, roles)

        # ① 查询改写（multi-query + HyDE）
        queries = self.transformer.transform(query)

        # ② 多查询混合检索 + 跨查询 RRF 融合
        candidates = self.retriever.retrieve(queries, top_n=self.candidate_pool, roles=roles)
        if not candidates:
            return "未检索到相关信息。"

        # ③ 重排序（cross-encoder，可降级）
        ranked = self.reranker.rerank(query, candidates, top_k=top_k)

        # ④ 内容注入
        return inject(ranked)
