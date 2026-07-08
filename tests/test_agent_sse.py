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

    def get_state(self, config):
        from types import SimpleNamespace
        return SimpleNamespace(tasks=(), next=())


def test_run_sse_uses_sync_stream_for_sync_checkpointer(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: _SyncOnlyAgent())
    client = TestClient(create_app())

    with client.stream(
        "POST",
        "/v1/run_sse",
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


# ===== HITL 工具审批 =====

class _FakeInterrupt:
    def __init__(self, value):
        self.value = value


class _FakeTask:
    def __init__(self, interrupts):
        self.interrupts = interrupts


class _FakeState:
    def __init__(self, hitl=None):
        self.tasks = ((_FakeTask([_FakeInterrupt(hitl)]),) if hitl else ())
        self.next = ("tools",) if hitl else ()


class _HitlAgent:
    """假 agent：记录 stream 输入，可配置 get_state 返回 interrupt."""

    def __init__(self, hitl=None, messages=None):
        self.hitl = hitl
        self.messages = messages or [_FakeMessage("hi", "AIMessageChunk")]
        self.stream_inputs = []

    def stream(self, inputs, config, stream_mode):
        self.stream_inputs.append(inputs)
        for msg in self.messages:
            yield msg, {}

    def get_state(self, config):
        return _FakeState(self.hitl)


def test_run_sse_emits_interrupt_event(monkeypatch):
    """工具需审批时，SSE 流以 interrupt 事件推送 HITLRequest."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    hitl = {"action_requests": [{"name": "weather", "args": {"city": "x"}}], "review_configs": []}
    fake = _HitlAgent(hitl=hitl)
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: fake)

    client = TestClient(create_app())
    with client.stream("POST", "/v1/run_sse", json={
        "appName": "common_agent", "userId": "u", "threadId": "t",
        "newMessage": {"content": "hi", "role": "user"}, "streaming": True,
    }) as resp:
        body = "".join(resp.iter_text())

    assert resp.status_code == 200
    assert "event: interrupt" in body
    assert "weather" in body


def test_resume_sse_approve_decision(monkeypatch):
    """resume_sse 把 APPROVED 转为 Command(resume={'decisions':[{'type':'approve'}]})."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    fake = _HitlAgent(hitl=None)
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: fake)

    client = TestClient(create_app())
    resp = client.post("/v1/resume_sse", json={
        "appName": "common_agent", "userId": "u", "threadId": "t",
        "toolFeedbacks": [{"id": "1", "name": "weather", "result": "APPROVED"}],
    })
    assert resp.status_code == 200
    assert len(fake.stream_inputs) == 1
    assert fake.stream_inputs[0].resume == {"decisions": [{"type": "approve"}]}


def test_resume_sse_reject_decision(monkeypatch):
    """resume_sse 把 REJECTED 转为 reject decision（含 message）."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    fake = _HitlAgent(hitl=None)
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: fake)

    client = TestClient(create_app())
    resp = client.post("/v1/resume_sse", json={
        "appName": "common_agent", "userId": "u", "threadId": "t",
        "toolFeedbacks": [{"id": "1", "name": "weather", "result": "REJECTED", "description": "不允许"}],
    })
    assert resp.status_code == 200
    assert fake.stream_inputs[0].resume == {"decisions": [{"type": "reject", "message": "不允许"}]}


def test_resume_sse_edit_decision(monkeypatch):
    """resume_sse 把 EDITED 转为 edit decision（arguments 作为工具入参）."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    get_settings.cache_clear()
    fake = _HitlAgent(hitl=None)
    monkeypatch.setattr(agent_router, "get_react_agent", lambda: fake)

    client = TestClient(create_app())
    resp = client.post("/v1/resume_sse", json={
        "appName": "common_agent", "userId": "u", "threadId": "t",
        "toolFeedbacks": [{
            "id": "1", "name": "weather", "result": "EDITED",
            "arguments": {"city": "shanghai"},
        }],
    })
    assert resp.status_code == 200
    assert fake.stream_inputs[0].resume == {
        "decisions": [{
            "type": "edit",
            "edited_action": {"name": "weather", "args": {"city": "shanghai"}},
        }]
    }
