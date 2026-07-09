"""SSE 断线重连测试 — 事件缓存 + Last-Event-ID 续传."""

from types import SimpleNamespace

from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from know_agent.configuration import get_settings
from know_agent.core.sse_store import SseEventStore, parse_last_event_id, sse_store
from know_agent.main import create_app
from know_agent.routers import agent as agent_router


# ---- SseEventStore ----

def test_sse_store_append_and_get_since():
    store = SseEventStore()
    eid1 = store.append("t1", {"event": "message", "data": "a"})
    eid2 = store.append("t1", {"event": "message", "data": "b"})
    assert eid1 == 1 and eid2 == 2
    # 取 eid1 之后 = [(2, b)]
    since = store.get_since("t1", 1)
    assert len(since) == 1 and since[0][0] == 2
    # 取 0 之后 = 全部
    assert len(store.get_since("t1", 0)) == 2
    # 不存在的 thread
    assert store.get_since("nope", 0) == []


def test_sse_store_done():
    store = SseEventStore()
    store.append("t1", {"event": "message", "data": "a"})
    assert not store.is_done("t1")
    store.mark_done("t1")
    assert store.is_done("t1")
    assert not store.is_done("nope")


def test_parse_last_event_id():
    assert parse_last_event_id(Headers({"Last-Event-ID": "5"})) == 5
    assert parse_last_event_id(Headers({})) is None
    assert parse_last_event_id(Headers({"Last-Event-ID": "abc"})) is None


# ---- run_sse 断线重连 ----

class _FakeMessage:
    def __init__(self, content, msg_type):
        self.content = content
        self.type = msg_type


class _ReconnectAgent:
    """假 agent：stream 产 2 条消息，get_state 无 interrupt."""

    def __init__(self):
        self.stream_calls = 0

    def stream(self, inputs, config, stream_mode):
        self.stream_calls += 1
        yield _FakeMessage("hello", "AIMessageChunk"), {}
        yield _FakeMessage("world", "AIMessageChunk"), {}

    def get_state(self, config):
        return SimpleNamespace(tasks=(), next=())


def test_run_sse_reconnect_replays_cached_events(monkeypatch):
    """首次 run_sse 产生事件并缓存；重连带 Last-Event-ID 只重放缓存，不重新执行 agent."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    sse_store._store.clear()  # 隔离单例，避免跨测试污染

    fake = _ReconnectAgent()
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: fake)
    monkeypatch.setattr(agent_router.thread_service, "ensure_thread_meta", lambda *args, **kwargs: False)
    monkeypatch.setattr(agent_router.thread_service, "generate_and_update_thread_title", lambda *args, **kwargs: None)

    client = TestClient(create_app())
    payload = {
        "appName": "common_agent", "userId": "u", "threadId": "recon-1",
        "newMessage": {"content": "hi", "role": "user"}, "streaming": True,
    }
    # 首次：执行 agent，产生事件（带 id）
    with client.stream("POST", "/v1/run_sse", json=payload) as r1:
        body1 = "".join(r1.iter_text())
    assert r1.status_code == 200
    assert "event: message" in body1
    assert "id: 1" in body1
    assert fake.stream_calls == 1

    # 重连：带 Last-Event-ID: 1，重放 id>1 的事件，不重新执行 agent
    with client.stream("POST", "/v1/run_sse", json=payload, headers={"Last-Event-ID": "1"}) as r2:
        body2 = "".join(r2.iter_text())
    assert r2.status_code == 200
    assert "id: 2" in body2  # 重放了第二条
    assert "world" in body2
    assert "hello" not in body2  # id=1 已过，不重放
    assert fake.stream_calls == 1  # 重连未重新执行 agent
