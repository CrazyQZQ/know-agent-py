"""多查询混合检索 + 跨查询 RRF 融合.

对每个查询分别调用 SearchService.hybrid_search（内部已做 keyword+vector RRF），
再跨查询做一次 RRF 融合 + 去重，形成候选池交给重排序器。
"""

from loguru import logger

from know_agent.services.document.search import RRF_K, SearchResult, SearchService


class MultiQueryRetriever:
    """多查询检索器：跨查询 RRF 融合."""

    def __init__(self, search_service: SearchService):
        self.search = search_service

    def retrieve(
        self, queries: list[str], top_n: int = 20, roles: list[str] | None = None,
        knowledge_base_type: str | None = None, filter: dict | None = None,
    ) -> list[SearchResult]:
        """对多个查询分别检索，跨查询 RRF 融合 + 去重，返回 top_n 候选."""
        scores: dict[str, float] = {}
        results: dict[str, SearchResult] = {}

        for q in queries:
            try:
                hits = self.search.hybrid_search(
                    q, top_k=top_n, roles=roles,
                    knowledge_base_type=knowledge_base_type, filter=filter,
                )
            except Exception as e:
                logger.warning("[rag] 查询检索失败 (query={!r}): {}", q[:50], e)
                continue
            for rank, r in enumerate(hits):
                key = self._dedup_key(r)
                scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
                # 首次出现时记录；跨查询命中同一片段时保留首次（rank 最优）
                results.setdefault(key, r)

        ranked = sorted(scores.items(), key=lambda x: -x[1])[:top_n]
        out: list[SearchResult] = []
        for key, score in ranked:
            r = results[key]
            r.score = score
            out.append(r)
        logger.info("[rag] 跨查询 RRF 融合: {} 条候选", len(out))
        return out

    @staticmethod
    def _dedup_key(r: SearchResult) -> str:
        """去重键：优先 segment_id，其次 chunk_id，最后文本 hash."""
        if r.segment_id is not None:
            return f"seg-{r.segment_id}"
        meta = r.metadata or {}
        if meta.get("chunk_id"):
            return f"chunk-{meta['chunk_id']}"
        return f"text-{hash(r.text)}"
