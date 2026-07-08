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
    )
