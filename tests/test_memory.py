"""mem0 长期记忆测试 - 检索注入 + 自动提取（无 key 旁路）."""

from unittest.mock import MagicMock

from know_agent.agents import memory as mem_module
from know_agent.configuration import get_settings


def test_get_memory_no_key(monkeypatch):
    """无 MEM0_API_KEY 时 get_memory 返回 None（旁路）."""
    monkeypatch.setenv("MEM0_API_KEY", "")
    get_settings.cache_clear()
    mem_module.get_memory.cache_clear()
    assert mem_module.get_memory() is None


def test_search_memories_no_key_returns_empty(monkeypatch):
    monkeypatch.setattr(mem_module, "get_memory", lambda: None)
    assert mem_module.search_memories("q", "user1") == []


def test_search_memories_calls_mem0(monkeypatch):
    mock_m = MagicMock()
    mock_m.search.return_value = [{"memory": "喜欢咖啡"}, {"memory": "在北京"}, {"memory": ""}]
    monkeypatch.setattr(mem_module, "get_memory", lambda: mock_m)

    result = mem_module.search_memories("query", "user1")
    mock_m.search.assert_called_once_with("query", user_id="user1", limit=5)
    assert result == ["喜欢咖啡", "在北京"]  # 空 memory 跳过


def test_search_memories_no_user_id(monkeypatch):
    mock_m = MagicMock()
    monkeypatch.setattr(mem_module, "get_memory", lambda: mock_m)
    assert mem_module.search_memories("q", "") == []
    mock_m.search.assert_not_called()


def test_extract_memories_calls_add(monkeypatch):
    class _Msg:
        def __init__(self, t, c):
            self.type = t
            self.content = c

    class _State:
        values = {"messages": [_Msg("human", "hi"), _Msg("ai", "hello"), _Msg("tool", "x")]}

    class _FakeCp:
        def get_state(self, config):
            return _State()

    mock_m = MagicMock()
    monkeypatch.setattr(mem_module, "get_memory", lambda: mock_m)
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: _FakeCp())

    mem_module.extract_memories("t1", "user1")
    mock_m.add.assert_called_once()
    call = mock_m.add.call_args
    assert call.kwargs.get("user_id") == "user1"
    msgs = call.args[0]
    # 仅 human/ai，跳过 tool
    assert msgs == [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]


def test_extract_memories_no_key_noop(monkeypatch):
    """无 key 时 extract_memories 不报错、不调 add."""
    mock_cp = MagicMock()
    monkeypatch.setattr(mem_module, "get_memory", lambda: None)
    monkeypatch.setattr("know_agent.agents.checkpoint.get_checkpointer", lambda: mock_cp)
    mem_module.extract_memories("t1", "user1")
    mock_cp.get_state.assert_not_called()
