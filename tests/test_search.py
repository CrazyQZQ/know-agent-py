"""SearchService 测试 — 权限过滤 + RRF 融合 + 结果映射.

不连真实 DB/pgvector：keyword_search 的 SQL 执行用 mock db，vector_search 用 mock
vectorstore，hybrid_search 通过 mock 两个子方法隔离测 RRF 融合逻辑。
"""

from unittest.mock import MagicMock

from langchain_core.documents import Document

from know_agent.services.document.search import (
    RRF_K,
    SearchService,
    SearchResult,
    _can_access,
)


# ---- _can_access 权限过滤 ----

def test_can_access_public_when_accessible_by_empty():
    assert _can_access(None, None) is True
    assert _can_access({}, None) is True
    assert _can_access({"accessibleBy": ""}, None) is True


def test_can_access_denied_when_restricted_and_no_roles():
    assert _can_access({"accessibleBy": "admin"}, None) is False


def test_can_access_allowed_when_role_intersects():
    assert _can_access({"accessibleBy": "admin,editor"}, ["editor"]) is True
    assert _can_access({"accessibleBy": "admin"}, ["editor"]) is False


# ---- vector_search 权限过滤（over-fetch + _can_access）----

def _doc(text, meta, distance=0.5):
    return Document(page_content=text, metadata=meta), distance


def test_vector_search_filters_by_roles(monkeypatch):
    mock_vs = MagicMock()
    mock_vs.similarity_search_with_score.return_value = [
        _doc("public", {"segment_id": 1}),
        _doc("restricted", {"segment_id": 2, "accessibleBy": "admin"}),
    ]
    monkeypatch.setattr("know_agent.services.document.search.get_vectorstore", lambda: mock_vs)

    svc = SearchService(db=MagicMock())
    # editor 角色只能看公开分块
    results = svc.vector_search("q", top_k=10, roles=["editor"])
    assert [r.segment_id for r in results] == [1]

    # admin 角色：两条都可看
    mock_vs.similarity_search_with_score.return_value = [
        _doc("public", {"segment_id": 1}),
        _doc("restricted", {"segment_id": 2, "accessibleBy": "admin"}),
    ]
    results = svc.vector_search("q", top_k=10, roles=["admin"])
    assert {r.segment_id for r in results} == {1, 2}


def test_vector_search_returns_empty_when_no_vectorstore(monkeypatch):
    monkeypatch.setattr("know_agent.services.document.search.get_vectorstore", lambda: None)
    svc = SearchService(db=MagicMock())
    assert svc.vector_search("q") == []


# ---- hybrid_search RRF 融合 ----

def test_hybrid_search_rrf_fusion(monkeypatch):
    monkeypatch.setattr("know_agent.services.document.search.get_vectorstore", lambda: None)
    svc = SearchService(db=MagicMock())
    monkeypatch.setattr(svc, "keyword_search", lambda q, top_k=10, roles=None: [
        SearchResult(segment_id=1, text="a", score=0.9, source="keyword", metadata={}),
        SearchResult(segment_id=2, text="b", score=0.8, source="keyword", metadata={}),
    ])
    monkeypatch.setattr(svc, "vector_search", lambda q, top_k=10, roles=None, knowledge_base_type=None: [
        SearchResult(segment_id=1, text="a", score=0.1, source="vector", metadata={}),
        SearchResult(segment_id=3, text="c", score=0.2, source="vector", metadata={}),
    ])

    results = svc.hybrid_search("q", top_k=10)

    # segment 1 在 keyword/vector 均 rank 0 → RRF 分数最高，排首位
    assert results[0].segment_id == 1
    assert results[0].source == "hybrid"
    expected = 1.0 / (RRF_K + 1) + 1.0 / (RRF_K + 1)
    assert abs(results[0].score - expected) < 1e-9
    assert {r.segment_id for r in results} == {1, 2, 3}


# ---- keyword_search 结果映射 ----

def test_keyword_search_maps_rows(monkeypatch):
    # mock db.execute 返回 mapping 行，验证结果映射与 roles 参数注入
    mock_db = MagicMock()
    mock_db.execute.return_value.mappings.return_value.all.return_value = [
        {"id": 1, "text": "hello world", "chunk_id": "c1", "metadata": {"k": "v"},
         "document_id": 9, "chunk_order": 0, "score": 0.8},
    ]
    monkeypatch.setattr("know_agent.services.document.search.get_vectorstore", lambda: None)
    svc = SearchService(db=mock_db)

    results = svc.keyword_search("hello", top_k=5, roles=["editor"])

    assert len(results) == 1
    r = results[0]
    assert r.segment_id == 1
    assert r.text == "hello world"
    assert r.source == "keyword"
    assert r.score == 0.8
    assert r.metadata == {"k": "v"}
    # roles 应作为 SQL 参数传入
    executed_params = mock_db.execute.call_args[0][1]
    assert executed_params["roles"] == ["editor"]
