"""common-agent — langchain create_agent + middleware.

对应源项目 DeepResearchAgent / SimpleAgent。迁移核心：
- create_agent + middleware 替代 create_react_agent + hooks
- PostgresSaver 替代 MysqlSaver
- 工具：datetime / weather / knowledge_base_search / ppt_template
- middleware：Logging（自写）+ Summarization + ToolCallLimit（langchain 现成，不造轮子）
"""

from functools import lru_cache

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware, ToolCallLimitMiddleware

from know_agent.agents.checkpoint import get_checkpointer
from know_agent.agents.middleware import LoggingMiddleware
from know_agent.llm.chat import get_chat_model
from know_agent.tools.datetime import get_current_time
from know_agent.tools.knowledge_base_search import knowledge_base_search
from know_agent.tools.ppt_template import list_ppt_templates
from know_agent.tools.weather import get_weather

SYSTEM_PROMPT = """你是一个智能助手，可以使用工具帮助用户完成任务。

工作要求：
1. 首先理解用户的核心需求
2. 使用中文回答
3. 提供清晰的建议和理由
4. 如果需要更多信息，主动询问

保持专业、友好的语气。"""

# 工具调用上限，对应源项目 ToolCallLimitHook runLimit=25
TOOL_CALL_LIMIT = 25

# agent 名称，对应源项目 AgentStaticLoader 注册的 agent
AGENT_NAME = "common_agent"


def get_tools():
    """common-agent 工具集（MCP/Jina 工具在阶段 3 联调时按需追加）."""
    return [get_current_time, get_weather, knowledge_base_search, list_ppt_templates]


@lru_cache
def get_react_agent():
    """构建并缓存 common-agent（create_agent + middleware）."""
    chat = get_chat_model()
    return create_agent(
        model=chat,
        tools=get_tools(),
        system_prompt=SYSTEM_PROMPT,
        middleware=[
            LoggingMiddleware(),
            SummarizationMiddleware(model=chat, trigger=("messages", 20)),
            ToolCallLimitMiddleware(run_limit=TOOL_CALL_LIMIT),
        ],
        checkpointer=get_checkpointer(),
    )
