"""agent middleware — 对应源项目 4 个核心 hook（langchain middleware 机制）.

- LoggingHook        → LoggingMiddleware（自写，wrap_tool_call 日志）
- SummarizationHook  → langchain SummarizationMiddleware（trigger 消息数阈值）
- ToolCallLimitHook  → langchain ToolCallLimitMiddleware（run_limit）
- HumanInTheLoopHook → langchain HumanInTheLoopMiddleware（按需启用，对应源项目 approvalOn）
"""

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from loguru import logger


class LoggingMiddleware(AgentMiddleware):
    """工具调用日志 — 对应源项目 LoggingHook."""

    def wrap_tool_call(self, request: ToolCallRequest, handler):
        tc = request.tool_call
        name = tc.get("name", "?") if isinstance(tc, dict) else getattr(tc, "name", "?")
        logger.info("[tool] start: {}", name)
        result = handler(request)
        content = getattr(result, "content", result)
        logger.info("[tool] end: {}", str(content)[:200])
        return result
