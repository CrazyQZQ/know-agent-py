from fastapi.testclient import TestClient

from know_agent.configuration import get_settings
from know_agent.main import create_app
from know_agent.routers import agent as agent_router


class _FakeMessage:
    def __init__(self, content: str, msg_type: str):
        self.content = content
        self.type = msg_type


class _SyncOnlyAgent:
    def stream(self, inputs, config, stream_mode):
        assert stream_mode == "messages"
        yield _FakeMessage("hello", "AIMessageChunk"), {}

    async def astream(self, inputs, config, stream_mode):
        raise NotImplementedError("async checkpoint path should not be used")


def test_run_sse_uses_sync_stream_for_sync_checkpointer(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: _SyncOnlyAgent())
    client = TestClient(create_app())

    with client.stream(
        "POST",
        "/run_sse",
        json={
            "appName": "common_agent",
            "userId": "alice",
            "threadId": "thread-1",
            "newMessage": {"content": "hi", "role": "user"},
            "streaming": True,
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: message" in body
    assert "data: hello" in body
    assert "event: done" in body
