"""重排序 — Jina Rerank API（cross-encoder），无 key 或调用失败时降级为 RRF 排序.

Jina Rerank 复用 JINA_API_KEY（与 MCP 共用），无需额外引入重排序模型/依赖。
cross-encoder 比 bi-encoder 向量检索更精准，适合对候选池精排。
"""

import requests
from loguru import logger
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from know_agent.configuration import get_settings
from know_agent.services.document.search import SearchResult

JINA_RERANK_URL = "https://api.jina.ai/v1/rerank"
RERANK_TIMEOUT = 10  # 秒，避免拖慢检索链路


class Reranker:
    """Jina cross-encoder 重排序器（可降级）."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "jina-reranker-v2-base-multilingual",
        enabled: bool = True,
    ):
        self.api_key = api_key or get_settings().jina_api_key
        self.model = model
        # 未配置 key 时自动禁用，降级为 RRF 排序
        self.enabled = enabled and bool(self.api_key)

    def rerank(
        self, query: str, results: list[SearchResult], top_k: int
    ) -> list[SearchResult]:
        if not results:
            return []
        if not self.enabled:
            logger.info("[rag] rerank 未启用，使用 RRF 排序")
            return results[:top_k]
        try:
            data = self._call_jina(query, [r.text for r in results], top_k)
            out: list[SearchResult] = []
            for item in data["results"]:
                r = results[item["index"]]
                r.score = float(item["relevance_score"])
                r.source = "rerank"
                out.append(r)
            logger.info("[rag] Jina rerank 成功: {} -> {} 条", len(results), len(out))
            return out
        except Exception as e:
            logger.warning("[rag] Jina rerank 失败，降级为 RRF 排序: {}", e)
            return results[:top_k]

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type(requests.RequestException),
        reraise=True,
    )
    def _call_jina(self, query: str, documents: list[str], top_n: int) -> dict:
        """调用 Jina Rerank API（tenacity 重试 + 超时，重试耗尽抛原异常由 rerank 降级）."""
        resp = requests.post(
            JINA_RERANK_URL,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "query": query,
                "documents": documents,
                "top_n": top_n,
            },
            timeout=RERANK_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
