"""RAG pipeline 测试 — 查询改写 / 跨查询 RRF / 重排序降级 / 引用注入.

全部用 mock：FakeLLM 测查询改写，MagicMock 测检索器，patch requests 测 reranker。
不耗真实 token，不调真实 Jina API。
"""

from unittest.mock import MagicMock, patch

import requests

from know_agent.services.document.rag.injector import inject
from know_agent.services.document.rag.query_transformer import QueryTransformer
from know_agent.services.document.rag.reranker import Reranker
from know_agent.services.document.rag.retriever import MultiQueryRetriever
from know_agent.services.document.search import SearchResult


# ---- QueryTransformer 查询改写 ----

def test_transform_degrades_to_original_on_llm_failure(fake_llm):
    llm = fake_llm(exc=RuntimeError("boom"))
    t = QueryTransformer(llm, enable_multi_query=True, enable_hyde=True)
    # multi_query / hyde 均失败 → 降级为原始 query
    assert t.transform("什么是 RAG") == ["什么是 RAG"]


def test_transform_multi_query_and_hyde(fake_llm):
    llm = fake_llm(responses=["改写一\n改写二", "假设性回答"])
    t = QueryTransformer(llm, enable_multi_query=True, enable_hyde=True)
    queries = t.transform("问题")
    assert queries[0] == "问题"  # 原始 query 在前
    assert "改写一" in queries and "改写二" in queries
    assert "假设性回答" in queries


def test_transform_dedup_preserves_order(fake_llm):
    # hyde 返回与原始重复 → 去重保序
    llm = fake_llm(responses=["改写一", "问题"])
    t = QueryTransformer(llm, enable_multi_query=True, enable_hyde=True)
    queries = t.transform("问题")
    assert queries.count("问题") == 1
    assert queries[0] == "问题"


def test_transform_disabled_flags_skip_llm(fake_llm):
    llm = fake_llm()
    t = QueryTransformer(llm, enable_multi_query=False, enable_hyde=False)
    assert t.transform("问题") == ["问题"]
    assert llm.calls == []  # 两个开关都关，不调 LLM


# ---- MultiQueryRetriever 跨查询 RRF 融合 ----

def _hit(seg_id, text="t"):
    return SearchResult(segment_id=seg_id, text=text, score=0.5, source="hybrid", metadata={})


def test_retriever_cross_query_rrf():
    search = MagicMock()
    search.hybrid_search.side_effect = [
        [_hit(1, "a"), _hit(2, "b")],
        [_hit(1, "a"), _hit(3, "c")],
    ]
    out = MultiQueryRetriever(search).retrieve(["q1", "q2"], top_n=10)
    # segment 1 跨查询双命中 → RRF 分数最高
    assert out[0].segment_id == 1
    assert {r.segment_id for r in out} == {1, 2, 3}


def test_retriever_skips_failed_query():
    search = MagicMock()
    search.hybrid_search.side_effect = [
        RuntimeError("q1 failed"),
        [_hit(1)],
    ]
    out = MultiQueryRetriever(search).retrieve(["q1", "q2"], top_n=10)
    assert len(out) == 1  # q1 失败跳过，q2 正常返回


# ---- Reranker 降级 ----

def _results(n):
    return [SearchResult(segment_id=i, text=f"t{i}", score=0.0, source="hybrid", metadata={}) for i in range(n)]


def test_rerank_no_key_degrades_to_rrf(monkeypatch):
    monkeypatch.setattr(
        "know_agent.services.document.rag.reranker.get_settings",
        lambda: MagicMock(jina_api_key=None),
    )
    r = Reranker(api_key=None, enabled=True)
    assert r.enabled is False  # 无 key 自动禁用
    out = r.rerank("q", _results(3), top_k=2)
    assert [x.segment_id for x in out] == [0, 1]  # RRF 原序截断


def test_rerank_jina_success():
    r = Reranker(api_key="fake-key", enabled=True)
    fake_resp = MagicMock()
    fake_resp.raise_for_status.return_value = None
    fake_resp.json.return_value = {"results": [
        {"index": 2, "relevance_score": 0.9},
        {"index": 0, "relevance_score": 0.5},
    ]}
    with patch("know_agent.services.document.rag.reranker.requests.post", return_value=fake_resp):
        out = r.rerank("q", _results(3), top_k=2)
    assert out[0].segment_id == 2  # Jina 排序后 seg2 最相关
    assert out[0].score == 0.9
    assert out[0].source == "rerank"


def test_rerank_jina_failure_degrades():
    r = Reranker(api_key="fake-key", enabled=True)
    with patch("know_agent.services.document.rag.reranker.requests.post", side_effect=RuntimeError("net")):
        out = r.rerank("q", _results(3), top_k=2)
    # 非网络异常不重试，直接降级 RRF 原序
    assert [x.segment_id for x in out] == [0, 1]


def test_rerank_retries_on_network_error(monkeypatch):
    """网络抖动（RequestException）触发 tenacity 重试 3 次后降级."""
    import time
    monkeypatch.setattr(time, "sleep", lambda *a: None)  # 跳过退避等待
    r = Reranker(api_key="fake-key", enabled=True)
    with patch(
        "know_agent.services.document.rag.reranker.requests.post",
        side_effect=requests.ConnectionError("net"),
    ) as mock_post:
        out = r.rerank("q", _results(3), top_k=2)
    assert mock_post.call_count == 3  # 重试 3 次
    assert [x.segment_id for x in out] == [0, 1]  # 降级 RRF 原序


def test_rerank_retries_then_succeeds(monkeypatch):
    """前次网络错误、后次成功 → 重试后返回 Jina 结果（不降级）."""
    import time
    monkeypatch.setattr(time, "sleep", lambda *a: None)
    r = Reranker(api_key="fake-key", enabled=True)
    fake_resp = MagicMock()
    fake_resp.raise_for_status.return_value = None
    fake_resp.json.return_value = {"results": [{"index": 1, "relevance_score": 0.9}]}
    with patch(
        "know_agent.services.document.rag.reranker.requests.post",
        side_effect=[requests.ConnectionError("net"), fake_resp],
    ) as mock_post:
        out = r.rerank("q", _results(2), top_k=1)
    assert mock_post.call_count == 2  # 第 1 次失败，第 2 次成功
    assert out[0].segment_id == 1
    assert out[0].source == "rerank"


def test_rerank_empty_returns_empty():
    r = Reranker(api_key="fake-key", enabled=True)
    assert r.rerank("q", [], top_k=2) == []


# ---- inject 引用注入 ----

def test_inject_format():
    results = [
        SearchResult(segment_id=1, text="内容A", score=0.953, source="rerank",
                     metadata={"fileName": "doc1.md"}),
        SearchResult(segment_id=2, text="内容B", score=0.871, source="rerank", metadata={}),
    ]
    text = inject(results)
    assert "共检索到 2 条相关知识" in text
    assert "[1]" in text and "[2]" in text
    assert "来源:《doc1.md》" in text
    assert "内容A" in text and "内容B" in text
    assert "---" in text  # 块间分隔


def test_inject_uses_fallback_when_no_filename():
    r = SearchResult(segment_id=1, text="x", score=0.5, source="rerank", metadata={})
    assert "未知文档" in inject([r])


def test_inject_empty():
    assert inject([]) == "未检索到相关信息。"
