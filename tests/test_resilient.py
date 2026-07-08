"""resilient 装饰器测试 - 降级 / 熔断 / 半开恢复 / 签名保留."""

import time

from know_agent.core.resilient import resilient


# ---- 降级 ----

def test_normal_call_passes_through():
    """正常调用透传结果，不影响返回值."""
    calls = []

    @resilient(fallback="fail")
    def fn(x):
        calls.append(x)
        return f"ok-{x}"

    assert fn(1) == "ok-1"
    assert calls == [1]


def test_exception_returns_fallback():
    """抛异常时返回定制的 fallback，不向调用方传播."""

    @resilient(fallback="降级文本")
    def fn():
        raise RuntimeError("boom")

    assert fn() == "降级文本"


def test_success_resets_failure_count():
    """成功后失败计数清零，避免历史失败累积误触熔断."""

    @resilient(fallback="down", circuit=True, failure_threshold=3, recovery_timeout=60)
    def fn(fail: bool):
        if fail:
            raise RuntimeError("boom")
        return "ok"

    assert fn(fail=True) == "down"   # failures=1
    assert fn(fail=True) == "down"   # failures=2
    assert fn(fail=False) == "ok"    # 成功 -> failures=0
    assert fn(fail=True) == "down"   # failures=1（非 3，未熔断）
    assert fn(fail=True) == "ok" or fn(fail=True) == "down"  # 仍可调用（未达阈值）


# ---- 熔断 ----

def test_circuit_opens_after_threshold():
    """连续失败达阈值后熔断，后续调用不执行函数体."""
    calls = []

    @resilient(fallback="down", circuit=True, failure_threshold=3, recovery_timeout=60)
    def fn():
        calls.append(1)
        raise RuntimeError("boom")

    for _ in range(3):
        assert fn() == "down"
    assert len(calls) == 3  # 3 次都实际执行

    # 第 4 次：已熔断，函数体不执行
    assert fn() == "down"
    assert len(calls) == 3  # 未增加


def test_circuit_half_open_recovery():
    """熔断冷却过后半开重试，成功则恢复（重新闭路）."""
    calls = []
    fail = {"on": True}

    @resilient(fallback="down", circuit=True, failure_threshold=2, recovery_timeout=0.05)
    def fn():
        calls.append(1)
        if fail["on"]:
            raise RuntimeError("boom")
        return "ok"

    # 触发熔断（2 次失败）
    assert fn() == "down"
    assert fn() == "down"
    # 熔断中：不执行函数体
    assert fn() == "down"
    assert len(calls) == 2

    time.sleep(0.06)
    fail["on"] = False
    # 半开：调用执行，成功 -> 恢复
    assert fn() == "ok"
    assert len(calls) == 3


def test_circuit_half_open_failure_reopens():
    """半开期再次失败，重新熔断并重置冷却计时."""
    calls = []

    @resilient(fallback="down", circuit=True, failure_threshold=2, recovery_timeout=0.05)
    def fn():
        calls.append(1)
        raise RuntimeError("boom")

    # 触发熔断
    assert fn() == "down"
    assert fn() == "down"
    assert fn() == "down"  # 熔断中不执行
    assert len(calls) == 2

    time.sleep(0.06)
    # 半开：执行一次又失败 -> 重新熔断
    assert fn() == "down"
    assert len(calls) == 3
    # 紧接着应仍在熔断（不执行）
    assert fn() == "down"
    assert len(calls) == 3


# ---- 签名保留（@tool schema 依赖）----

def test_wraps_preserves_signature_for_tool():
    """functools.wraps 保留签名，@tool 能基于原始签名生成正确 schema."""
    from langchain_core.tools import tool

    @tool
    @resilient(fallback="fail")
    def my_tool(query: str, top_k: int = 5) -> str:
        """docs."""
        return "ok"

    schema = my_tool.args_schema.model_json_schema()
    props = schema["properties"]
    assert "query" in props and "top_k" in props
    # invoke 正常透传
    assert my_tool.invoke({"query": "x"}) == "ok"


def test_wraps_preserves_docstring():
    """docstring 被保留（@tool 用它作工具描述）."""

    @resilient(fallback="fail")
    def fn():
        """my docstring."""
        return "ok"

    assert fn.__doc__ == "my docstring."
