"""混合检索 — pg_trgm 关键词 + pgvector 向量 + RRF 融合.

对应源项目 HybridEsDocumentRetriever 的混合检索逻辑。
- 关键词检索：PG 内置 pg_trgm 扩展（word_similarity 子串匹配），替代 ES multi_match
- 向量检索：pgvector cosine 距离，替代 ES knn
- RRF 融合：score = 1/(K + rank)，与源项目一致（K=60）
"""

import re
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from know_agent.services.document.vectorstore import collection_for, get_vectorstore

RRF_K = 60  # RRF 常数，与源项目 HybridEsDocumentRetriever 一致

# 过滤 key 白名单（防 SQL 注入）：字母/下划线开头，字母数字下划线
_FILTER_KEY_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _build_filter_clause(filter: dict | None) -> tuple[str, dict]:
    """构建 metadata 过滤 SQL 片段 + 参数。

    document_id 用表列，其他 key 用 metadata->>'key'；key 经白名单校验防注入。
    """
    if not filter:
        return "", {}
    clauses: list[str] = []
    params: dict = {}
    for key, val in filter.items():
        if not _FILTER_KEY_RE.match(str(key)):
            continue
        param_name = f"f_{key}"
        if key == "document_id":
            clauses.append(f"document_id = :{param_name}")
        else:
            clauses.append(f"metadata->>'{key}' = :{param_name}")
        params[param_name] = str(val)
    if not clauses:
        return "", {}
    return " AND " + " AND ".join(clauses), params


def _can_access(metadata: dict | None, roles: list[str] | None) -> bool:
    """权限过滤：accessible_by 为空=公开；否则当前用户角色与文档角色求交集."""
    ab = (metadata or {}).get("accessibleBy")
    if not ab:
        return True
    if not roles:
        return False
    doc_roles = [r.strip() for r in ab.split(",") if r.strip()]
    return any(r in doc_roles for r in roles)


@dataclass
class SearchResult:
    segment_id: int | None
    text: str
    score: float
    source: str  # keyword / vector / hybrid
    metadata: dict


class SearchService:
    def __init__(self, db: Session):
        self.db = db
        self.vectorstore = get_vectorstore()

    def keyword_search(
        self, query: str, top_k: int = 10, threshold: float = 0.1,
        roles: list[str] | None = None, filter: dict | None = None,
    ) -> list[SearchResult]:
        """pg_trgm 关键词检索（word_similarity 子串匹配，替代 ES multi_match/BM25）.

        word_similarity(q, text) 衡量 q 作为 text 子串的 trigram 相似度，
        比 similarity() 更适合"短关键词 vs 长文本"场景。
        按 accessible_by 角色过滤：空=公开，否则当前用户角色与文档角色求交集。
        filter 按 metadata 过滤（document_id 用列，其他用 metadata->>'key'）。
        """
        # roles 为空时只返回公开分块；非空时包含其可访问的
        if not roles:
            access_clause = "(metadata->>'accessibleBy' IS NULL OR metadata->>'accessibleBy' = '')"
        else:
            access_clause = (
                "(metadata->>'accessibleBy' IS NULL OR metadata->>'accessibleBy' = '' "
                "OR string_to_array(metadata->>'accessibleBy', ',') && :roles)"
            )
        filter_clause, filter_params = _build_filter_clause(filter)
        sql = text(
            f"""
            SELECT id, text, chunk_id, metadata, document_id, chunk_order,
                   word_similarity(:q, text) AS score
            FROM knowledge_segment
            WHERE deleted = 0 AND word_similarity(:q, text) > :threshold
            AND {access_clause}{filter_clause}
            ORDER BY score DESC
            LIMIT :k
            """
        )
        params: dict = {"q": query, "threshold": threshold, "k": top_k}
        if roles:
            params["roles"] = roles
        params.update(filter_params)
        rows = self.db.execute(sql, params).mappings().all()
        return [
            SearchResult(
                segment_id=r["id"],
                text=r["text"],
                score=float(r["score"]),
                source="keyword",
                metadata=r["metadata"] or {},
            )
            for r in rows
        ]

    def vector_search(self, query: str, top_k: int = 10, roles: list[str] | None = None,
                      knowledge_base_type: str | None = None, filter: dict | None = None) -> list[SearchResult]:
        """pgvector 向量检索（cosine 距离，越小越相似）.

        PGVector metadata filter 难以表达"为空 OR 包含"语义，
        改为 over-fetch 后 Python 侧按 accessible_by 角色过滤。
        knowledge_base_type 指定时按类型隔离 collection 检索。
        filter 透传给 PGVector 做 metadata 预过滤。
        """
        vs = get_vectorstore(collection_for(knowledge_base_type)) if knowledge_base_type else self.vectorstore
        if not vs:
            return []
        # over-fetch 3 倍以补偿权限过滤导致的结果减少
        fetch_k = top_k * 3 if roles else top_k
        results = vs.similarity_search_with_score(query, k=fetch_k, filter=filter)
        out: list[SearchResult] = []
        for doc, distance in results:
            meta = doc.metadata or {}
            if not _can_access(meta, roles):
                continue
            out.append(
                SearchResult(
                    segment_id=meta.get("segment_id"),
                    text=doc.page_content,
                    score=float(distance),  # 距离（RRF 只用 rank，不直接比较分数）
                    source="vector",
                    metadata=meta,
                )
            )
            if len(out) >= top_k:
                break
        return out

    def hybrid_search(self, query: str, top_k: int = 10, roles: list[str] | None = None,
                      knowledge_base_type: str | None = None, filter: dict | None = None) -> list[SearchResult]:
        """RRF 融合：keyword + vector. score = Σ 1/(K + rank). 按 roles 过滤权限.
        knowledge_base_type 透传给向量检索（按类型隔离 collection）；filter 透传给两侧.
        """
        kw = self.keyword_search(query, top_k=top_k, roles=roles, filter=filter)
        vec = self.vector_search(query, top_k=top_k, roles=roles,
                                 knowledge_base_type=knowledge_base_type, filter=filter)

        scores: dict[int, float] = {}
        results: dict[int, SearchResult] = {}

        for rank, r in enumerate(kw):
            key = r.segment_id
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
            results.setdefault(key, r)
        for rank, r in enumerate(vec):
            if r.segment_id is None:
                continue
            key = r.segment_id
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank + 1)
            results.setdefault(key, r)

        ranked = sorted(scores.items(), key=lambda x: -x[1])[:top_k]
        out: list[SearchResult] = []
        for seg_id, score in ranked:
            r = results[seg_id]
            r.score = score
            r.source = "hybrid"
            out.append(r)
        return out
