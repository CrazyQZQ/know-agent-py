"""测试夹具 — mock LLM/embedding/DB/外部服务，测试不依赖真实基础设施.

测试风格与现有 test_agent_sse / test_auth_login 一致：用 monkeypatch / MagicMock
隔离外部依赖，只测业务逻辑。FakeLLM 供 RAG 组件测试用，不耗真实 token。
"""

import pytest


class FakeLLM:
    """假 LLM：invoke 返回预设 content，支持返回值队列与异常注入."""

    def __init__(self, responses=None, default="", exc=None):
        self._responses = list(responses) if responses else []
        self._default = default
        self._exc = exc
        self.calls: list[str] = []

    def invoke(self, prompt, **kwargs):
        self.calls.append(prompt)
        if self._exc is not None:
            raise self._exc
        if self._responses:
            return _Msg(self._responses.pop(0))
        return _Msg(self._default)


class _Msg:
    """模拟 langchain AIMessage 的最小接口（.content）."""

    def __init__(self, content):
        self.content = content


@pytest.fixture
def fake_llm():
    """返回 FakeLLM 类，测试自行实例化以定制 responses / exc."""
    return FakeLLM
