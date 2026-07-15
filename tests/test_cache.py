"""检索结果缓存测试."""

import time

from know_agent.core.cache import ResultCache, make_cache_key


def test_cache_set_get():
    c = ResultCache(ttl=60)
    c.set("k", "v")
    assert c.get("k") == "v"


def test_cache_miss():
    assert ResultCache().get("nope") is None


def test_cache_ttl_expiry():
    c = ResultCache(ttl=0)  # 立即过期
    c.set("k", "v")
    time.sleep(0.01)
    assert c.get("k") is None


def test_cache_fifo_evict():
    c = ResultCache(ttl=60, maxsize=2)
    c.set("a", 1)
    c.set("b", 2)
    c.set("c", 3)  # 满，淘汰最早插入的 a
    assert c.get("a") is None
    assert c.get("b") == 2
    assert c.get("c") == 3


def test_make_cache_key():
    key = make_cache_key("vector", "query", 5, ["a", "b"], "DOCUMENT_SEARCH", {"x": 1})
    assert key == ("vector", "query", 5, ("a", "b"), "DOCUMENT_SEARCH", (("x", 1),), "")


def test_make_cache_key_none():
    key = make_cache_key("hybrid", "q", 10, None, None, None)
    assert key == ("hybrid", "q", 10, (), "", (), "")


def test_make_cache_key_distinguishes_user():
    """current_user 进缓存键，不同用户检索结果不共享缓存."""
    k1 = make_cache_key("vector", "q", 5, None, None, None, "alice")
    k2 = make_cache_key("vector", "q", 5, None, None, None, "bob")
    assert k1 != k2
