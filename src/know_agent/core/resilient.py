"""工具熔断降级装饰器 - 统一异常捕获 + 友好降级 + 可选熔断.

langgraph 的 ToolNode 默认会把工具异常转成 ToolMessage 回给 LLM，但内容是原始
错误信息（可能含 traceback / 技术细节），不够友好且可能让 LLM 盲目重试。本装饰器：
  - 异常捕获：返回每个工具定制的友好降级文本（给 LLM 的决策指引，而非给人看的报错）
  - 统一日志：工具名 + 耗时 + 失败原因
  - 可选熔断：连续失败 N 次后快速短路，冷却 T 秒后半开重试（重资源工具开）

用法：
    @tool
    @resilient(fallback="知识库检索暂时不可用，请基于自身已有信息回答用户。")
    def knowledge_base_search(...): ...

    @tool
    @resilient(fallback="...", circuit=True, failure_threshold=5, recovery_timeout=60)
    def heavy_tool(...): ...

注意：@tool 必须在最外层（@resilient 在内层），functools.wraps 会保留原始签名
和 docstring 供 @tool 生成工具 schema。

熔断状态为进程内、每个工具独立（多 worker 不共享，可接受；重启服务重新计数）。
与 get_memory / get_vectorstore 的 lru_cache 旁路互补：那些是「初始化失败」熔断，
本装饰器是「调用失败」熔断，覆盖更广。
"""

import functools
import time

from loguru import logger


def resilient(
    fallback: str,
    *,
    circuit: bool = False,
    failure_threshold: int = 5,
    recovery_timeout: float = 60.0,
):
    """工具统一熔断降级装饰器.

    Args:
        fallback: 降级返回文本（给 LLM 看，每个工具定制，应指引 LLM 后续动作）。
        circuit: 是否启用熔断。重资源工具（依赖 DB/外部服务）建议开，简单工具不开。
        failure_threshold: 连续失败多少次后熔断（开路快速失败）。
        recovery_timeout: 熔断冷却秒数，过后半开重试一次；成功则恢复，失败则重新计时。
    """

    def decorator(fn):
        # 熔断状态：进程内、每个工具独立（多 worker 不共享，可接受）
        state = {"failures": 0, "opened_at": 0.0} if circuit else None

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            name = fn.__name__
            # 熔断开路：冷却期内快速失败，不调实际函数
            if state is not None and state["failures"] >= failure_threshold:
                if time.monotonic() - state["opened_at"] < recovery_timeout:
                    logger.warning("[resilient] {} 熔断中，跳过调用", name)
                    return fallback
                logger.info("[resilient] {} 熔断冷却结束，半开重试", name)
            start = time.monotonic()
            try:
                result = fn(*args, **kwargs)
            except Exception as e:
                logger.warning(
                    "[resilient] {} 失败 ({:.0f}ms)，降级: {}",
                    name, (time.monotonic() - start) * 1000, e,
                )
                if state is not None:
                    state["failures"] += 1
                    if state["failures"] >= failure_threshold:
                        state["opened_at"] = time.monotonic()
                        logger.warning(
                            "[resilient] {} 触发熔断（连续失败 {} 次）", name, state["failures"],
                        )
                return fallback
            # 成功：清空熔断计数
            if state is not None and state["failures"]:
                state["failures"] = 0
            return result

        return wrapper

    return decorator
