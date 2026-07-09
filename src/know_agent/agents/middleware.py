"""agent middleware — 对应源项目 4 个核心 hook（langchain middleware 机制）.

- LoggingHook        → LoggingMiddleware（自写，wrap_tool_call 日志）
- SummarizationHook  → langchain SummarizationMiddleware（trigger 消息数阈值）
- ToolCallLimitHook  → langchain ToolCallLimitMiddleware（run_limit）
- HumanInTheLoopHook → langchain HumanInTheLoopMiddleware（按需启用，对应源项目 approvalOn）
"""

from langchain.agents.middleware import AgentMiddleware, ToolCallRequest
from langchain_core.messages import SystemMessage
from langgraph.config import get_config
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


class MemoryContextMiddleware(AgentMiddleware):
    """将长期记忆临时注入 system prompt，不写入 checkpoint 消息历史。"""

    @staticmethod
    def _memory_text(memories: list[str]) -> str:
        items = "\n".join(f"- {m}" for m in memories if m)
        return f"以下是关于该用户的长期记忆，回答时可参考：\n{items}"

    def _wrap(self, request, handler, memories: list[str] | None = None):
        memories = memories or []
        if not memories:
            return handler(request)

        memory_text = self._memory_text(memories)
        base = request.system_message.content if request.system_message else ""
        content = f"{base}\n\n{memory_text}" if base else memory_text
        return handler(request.override(system_message=SystemMessage(content=content)))

    def wrap_model_call(self, request, handler):
        try:
            config = get_config()
        except RuntimeError:
            config = {}
        memories = (config.get("metadata") or {}).get("user_memories") or []
        return self._wrap(request, handler, memories)
