"""查询改写 — Multi-Query + HyDE，提升检索召回率.

- Multi-Query：LLM 从不同角度生成多个语义等价的改写查询，扩大检索覆盖
- HyDE (Hypothetical Document Embeddings)：LLM 先生成假设性答案，用答案做向量检索，
  使 query 在向量空间更接近真实答案（适合 query 短但答案长的场景）

任一环节失败均降级为原始 query，不影响主流程。
"""

from langchain_openai import ChatOpenAI
from loguru import logger

MULTI_QUERY_PROMPT = """你是搜索查询改写助手。给定用户问题，从不同角度生成 3 个语义等价但表述不同的查询，用于提升知识库检索的召回率。

要求：
- 保持原意，变换用词、视角或表述方式
- 每行一个改写查询，不要编号、不要解释、不要引号

用户问题：{question}

改写查询（每行一个）："""

HYDE_PROMPT = """请针对以下问题，撰写一段 200 字左右的假设性回答，用于向量检索。
回答应包含可能的事实信息、关键术语和概念，即使不确定也要合理推测，使其在向量空间中接近真实答案。

问题：{question}

假设性回答："""

MAX_MULTI_QUERY = 3  # 多查询改写数量上限


class QueryTransformer:
    """查询改写器：Multi-Query + HyDE."""

    def __init__(
        self,
        llm: ChatOpenAI,
        enable_multi_query: bool = True,
        enable_hyde: bool = True,
    ):
        self.llm = llm
        self.enable_multi_query = enable_multi_query
        self.enable_hyde = enable_hyde

    def transform(self, query: str) -> list[str]:
        """返回用于检索的查询列表（含原始 query，去重保序）."""
        queries = [query]
        if self.enable_multi_query:
            queries.extend(self._multi_query(query))
        if self.enable_hyde:
            hyde = self._hyde(query)
            if hyde:
                queries.append(hyde)

        # 去重保序
        seen: set[str] = set()
        out: list[str] = []
        for q in queries:
            q = q.strip()
            if q and q not in seen:
                seen.add(q)
                out.append(q)
        logger.info("[rag] 查询改写: {} -> {} 条查询", query[:50], len(out))
        return out

    def _multi_query(self, query: str) -> list[str]:
        try:
            resp = self.llm.invoke(MULTI_QUERY_PROMPT.format(question=query))
            lines = [
                ln.strip().strip('"').strip("'").strip("「」")
                for ln in resp.content.splitlines()
            ]
            return [ln for ln in lines if ln][:MAX_MULTI_QUERY]
        except Exception as e:
            logger.warning("[rag] multi-query 改写失败，降级为原始查询: {}", e)
            return []

    def _hyde(self, query: str) -> str | None:
        try:
            resp = self.llm.invoke(HYDE_PROMPT.format(question=query))
            return resp.content.strip()
        except Exception as e:
            logger.warning("[rag] HyDE 生成失败，跳过: {}", e)
            return None
