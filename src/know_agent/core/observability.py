"""可观测性初始化 — LangSmith tracing 等.

langchain 内置 tracing：设置 LANGSMITH_* 环境变量后，所有 LLM/agent/chain/工具调用
自动上报到 LangSmith，无需侵入业务代码。这里在应用启动时把 Settings 中的配置注入 os.environ，
使 langchain 的回调管理器在 agent 首次创建（lru_cache）前读到。
"""

import os

from loguru import logger

from know_agent.configuration import Settings


def setup_tracing(settings: Settings) -> None:
    """根据配置启用 LangSmith tracing，注入环境变量."""
    if not settings.langsmith_tracing:
        return
    if not settings.langsmith_api_key:
        logger.warning("[tracing] LANGSMITH_TRACING=true 但未配置 LANGSMITH_API_KEY，tracing 不生效")
        return
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    if settings.langsmith_project:
        os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    logger.info(
        "[tracing] LangSmith tracing 已启用 (project={}, endpoint={})",
        settings.langsmith_project,
        settings.langsmith_endpoint,
    )
