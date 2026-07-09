"""thread 会话历史测试 - 从 checkpoint 取历史消息并格式化."""

from know_agent.agents import thread as thread_service


class _Msg:
    def __init__(self, msg_type, content):
        self.type = msg_type
        self.content = content


class _State:
    def __init__(self, messages):
        self.checkpoint = {"channel_values": {"messages": messages}} if messages else {}


class _FakeCp:
    def __init__(self, state):
        self._state = state

    def get_tuple(self, config):
        return self._state


def test_get_thread_history_formats_messages(monkeypatch):
    state = _State([
        _Msg("human", "你好"),
        _Msg("ai", "你好，有什么可以帮你"),
        _Msg("tool", "tool result"),  # 跳过（非对话）
        _Msg("ai", ""),  # 跳过（空内容）
    ])
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp(state))

    history = thread_service.get_thread_history("t1")
    assert history == [
        {"role": "user", "content": "你好"},
        {"role": "assistant", "content": "你好，有什么可以帮你"},
    ]


def test_get_thread_history_empty(monkeypatch):
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp(_State([])))
    assert thread_service.get_thread_history("t1") == []


def test_get_thread_history_no_checkpointer(monkeypatch):
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: None)
    assert thread_service.get_thread_history("t1") == []


def test_get_thread_returns_messages(monkeypatch):
    state = _State([_Msg("human", "hi"), _Msg("ai", "hello")])
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp(state))
    t = thread_service.get_thread("t1")
    assert t == {"thread_id": "t1", "messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]}
