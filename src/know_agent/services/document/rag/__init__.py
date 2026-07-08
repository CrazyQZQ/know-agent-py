"""生产级 RAG pipeline — 多查询改写 + HyDE + 混合检索 + Jina 重排序 + 引用注入.

流程：
  QueryTransformer  → MultiQueryRetriever → Reranker → ContentInjector
  (多查询+HyDE 改写)  (keyword+vector+RRF)  (cross-encoder) (引用标注)

QueryRouter 由 agentic RAG 承担（create_agent 自主决定是否调用检索工具），不单独实现。
"""

from know_agent.services.document.rag.pipeline import RagPipeline

__all__ = ["RagPipeline"]
