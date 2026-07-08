"""API 限流测试 — 超频返回 429."""

from fastapi.testclient import TestClient

from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.main import create_app
from know_agent.routers import agent as agent_router


class _FakeMessage:
    def __init__(self, content: str, msg_type: str):
        self.content = content
        self.type = msg_type


class _FakeAgent:
    """假 agent：stream/invoke 都返回固定内容，避免真实 LLM 调用."""

    def stream(self, inputs, config, stream_mode):
        assert stream_mode == "messages"
        yield _FakeMessage("ok", "AIMessageChunk"), {}

    def invoke(self, inputs, config):
        return {"messages": [_FakeMessage("ok", "AIMessage")]}

    def get_state(self, config):
        from types import SimpleNamespace
        return SimpleNamespace(tasks=(), next=())


def _reset_limiter_storage() -> None:
    """清除 slowapi 内存计数器，隔离前后测试."""
    limiter._storage.reset()


def _payload() -> dict:
    return {
        "appName": "common_agent",
        "userId": "u1",
        "threadId": "t1",
        "newMessage": {"content": "hi", "role": "user"},
        "streaming": True,
    }


def test_run_sse_returns_429_after_exceeding_limit(monkeypatch):
    _reset_limiter_storage()
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT", "2/minute")
    get_settings.cache_clear()
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: _FakeAgent())

    client = TestClient(create_app())
    payload = _payload()
    assert client.post("/v1/run_sse", json=payload).status_code == 200
    assert client.post("/v1/run_sse", json=payload).status_code == 200
    # 第 3 次超频 → 429
    assert client.post("/v1/run_sse", json=payload).status_code == 429


def test_chat_ask_returns_429_after_exceeding_limit(monkeypatch):
    _reset_limiter_storage()
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT", "2/minute")
    get_settings.cache_clear()
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: _FakeAgent())

    client = TestClient(create_app())
    params = {"question": "hi"}
    assert client.get("/v1/chat/ask", params=params).status_code == 200
    assert client.get("/v1/chat/ask", params=params).status_code == 200
    # 第 3 次超频 → 429
    assert client.get("/v1/chat/ask", params=params).status_code == 429
