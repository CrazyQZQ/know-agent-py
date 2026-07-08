"""Chat 模型工厂 — DeepSeek (OpenAI 兼容)."""

from functools import lru_cache

from langchain_openai import ChatOpenAI

from know_agent.configuration import get_settings


@lru_cache
def get_chat_model() -> ChatOpenAI:
    s = get_settings()
    return ChatOpenAI(
        model=s.deepseek_model,
        api_key=s.deepseek_api_key,
        base_url=s.deepseek_base_url,
        temperature=0.7,
        # 外部调用重试与超时（openai 客户端内置）：网络抖动自动重试，不透传 500
        max_retries=3,
        timeout=30,
    )
