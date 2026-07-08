"""SSE 事件缓存 — 支持 Last-Event-ID 断线重连.

按 thread_id 缓存 SSE 事件流（内存），断线重连时按 Last-Event-ID 续发该 id 之后的事件。
进程内缓存，单 worker 适用（多 worker 需共享存储如 Redis，见架构决策 A）。
"""

import threading
import time
from dataclasses import dataclass, field

_TTL_SECONDS = 3600  # 缓存保留 1 小时


@dataclass
class _Entry:
    events: list[tuple[int, dict]] = field(default_factory=list)  # (id, event)
    done: bool = False
    next_id: int = 1
    updated: float = field(default_factory=time.time)


class SseEventStore:
    """按 thread_id 缓存 SSE 事件，支持 Last-Event-ID 续传."""

    def __init__(self, ttl_seconds: int = _TTL_SECONDS):
        self._store: dict[str, _Entry] = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds

    def append(self, thread_id: str, event: dict) -> int:
        """追加事件，返回分配的递增 id."""
        with self._lock:
            self._maybe_cleanup()
            entry = self._store.setdefault(thread_id, _Entry())
            eid = entry.next_id
            entry.next_id += 1
            entry.events.append((eid, event))
            entry.updated = time.time()
            return eid

    def get_since(self, thread_id: str, last_id: int) -> list[tuple[int, dict]]:
        """取 last_id 之后的事件（含 id），用于断线重连重放."""
        with self._lock:
            entry = self._store.get(thread_id)
            if not entry:
                return []
            return [(eid, ev) for eid, ev in entry.events if eid > last_id]

    def mark_done(self, thread_id: str) -> None:
        """标记流结束（重连时若已 done，重放完即止）."""
        with self._lock:
            entry = self._store.get(thread_id)
            if entry:
                entry.done = True
                entry.updated = time.time()

    def is_done(self, thread_id: str) -> bool:
        with self._lock:
            entry = self._store.get(thread_id)
            return entry.done if entry else False

    def _maybe_cleanup(self) -> None:
        """清理过期缓存（append 时触发，惰性清理）."""
        now = time.time()
        expired = [tid for tid, e in self._store.items() if now - e.updated > self._ttl]
        for tid in expired:
            del self._store[tid]


def parse_last_event_id(headers) -> int | None:
    """解析 Last-Event-ID 请求头（SSE 断线重连用）."""
    val = headers.get("Last-Event-ID")
    if val is None:
        return None
    try:
        return int(val)
    except ValueError:
        return None


# 单例
sse_store = SseEventStore()
