"""检索结果缓存 - TTL + 大小限制，减少重复 embedding/检索调用.

模块级单例，跨请求共享。相同 query+参数在 TTL 内复用结果，
避免重复 embed query（embedding 是检索链路最慢的一步）。
"""

import time
from threading import Lock

from know_agent.configuration import get_settings


class ResultCache:
    """简单 TTL + FIFO 缓存（线程安全）."""

    def __init__(self, ttl: int = 300, maxsize: int = 1000):
        self._store: dict = {}
        self._ttl = ttl
        self._maxsize = maxsize
        self._lock = Lock()

    def get(self, key):
        with self._lock:
            if key in self._store:
                value, ts = self._store[key]
                if time.time() - ts < self._ttl:
                    return value
                del self._store[key]
        return None

    def set(self, key, value) -> None:
        with self._lock:
            if len(self._store) >= self._maxsize:
                # FIFO：删最早插入的
                oldest = next(iter(self._store))
                del self._store[oldest]
            self._store[key] = (value, time.time())

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_cache: ResultCache | None = None


def get_result_cache() -> ResultCache:
    """缓存单例（按配置初始化 TTL/大小）."""
    global _cache
    if _cache is None:
        s = get_settings()
        _cache = ResultCache(ttl=s.cache_ttl, maxsize=s.cache_maxsize)
    return _cache


def make_cache_key(method: str, query: str, top_k: int,
                   roles: list[str] | None, knowledge_base_type: str | None,
                   filter: dict | None) -> tuple:
    """构建缓存键（roles/filter 转 hashable tuple）."""
    roles_t = tuple(roles) if roles else ()
    filter_t = tuple(sorted((filter or {}).items()))
    return (method, query, top_k, roles_t, knowledge_base_type or "", filter_t)
