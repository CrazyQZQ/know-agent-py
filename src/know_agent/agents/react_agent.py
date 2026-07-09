"""common-agent — langchain create_agent + middleware.

对应源项目 DeepResearchAgent / SimpleAgent。迁移核心：
- create_agent + middleware 替代 create_react_agent + hooks
- PostgresSaver 替代 MysqlSaver
- 工具：datetime / weather / knowledge_base_search / ppt_template
- middleware：Logging（自写）+ Summarization + ToolCallLimit（langchain 现成，不造轮子）
"""

from functools import lru_cache

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware, SummarizationMiddleware, ToolCallLimitMiddleware

from know_agent.agents.checkpoint import get_checkpointer
from know_agent.agents.middleware import LoggingMiddleware
from know_agent.configuration import get_settings
from know_agent.llm.chat import get_chat_model
from know_agent.tools.datetime import get_current_time
from know_agent.tools.knowledge_base_search import knowledge_base_search
from know_agent.tools.memory import save_memory
from know_agent.tools.ppt_template import list_ppt_templates
from know_agent.tools.weather import get_weather

SYSTEM_PROMPT = """你是一个智能助手，可以使用工具帮助用户完成任务。

工作要求：
1. 首先理解用户的核心需求
2. 使用中文回答，回答需要简洁
3. 提供清晰的建议和理由
4. 如果需要更多信息，主动询问
5. 如果用户明确要求记住某事（如"记住XXX"），调用 save_memory 工具保存长期记忆

保持专业、友好的语气。"""

# 工具调用上限，对应源项目 ToolCallLimitHook runLimit=25
TOOL_CALL_LIMIT = 25

# agent 名称，对应源项目 AgentStaticLoader 注册的 agent
AGENT_NAME = "common_agent"


def get_tools():
    """common-agent 工具集（MCP/Jina 工具在阶段 3 联调时按需追加）."""
    return [get_current_time, get_weather, knowledge_base_search, list_ppt_templates, save_memory]


def _build_middleware(chat):
    """构建 agent middleware：日志 + 摘要 + 工具上限 + HITL（按配置）."""
    mw = [
        LoggingMiddleware(),
        SummarizationMiddleware(model=chat, trigger=("messages", 20)),
        ToolCallLimitMiddleware(run_limit=TOOL_CALL_LIMIT),
    ]
    # HITL 工具审批：HITL_TOOLS 配置的工具调用前 interrupt，等前端审批（resume_sse 恢复）
    hitl_tools = [t.strip() for t in (get_settings().hitl_tools or "").split(",") if t.strip()]
    if hitl_tools:
        mw.append(HumanInTheLoopMiddleware(interrupt_on={t: True for t in hitl_tools}))
    return mw


@lru_cache
def get_react_agent():
    """构建并缓存 common-agent（create_agent + middleware）."""
    chat = get_chat_model()
    return create_agent(
        model=chat,
        tools=get_tools(),
        system_prompt=SYSTEM_PROMPT,
        middleware=_build_middleware(chat),
        checkpointer=get_checkpointer(),
    )
