"""Embedding 模型工厂 — 火山方舟 Doubao (OpenAI 兼容, 默认 1024 维)."""

from functools import lru_cache

from langchain_openai import OpenAIEmbeddings

from know_agent.configuration import get_settings


@lru_cache
def get_embeddings() -> OpenAIEmbeddings:
    s = get_settings()
    return OpenAIEmbeddings(
        model=s.ark_embedding_model,
        api_key=s.ark_api_key,
        base_url=s.ark_base_url,
        dimensions=s.embedding_dimensions,
        # 火山方舟不支持 token id 数组输入，关闭 tiktoken 分词，直接传字符串
        check_embedding_ctx_length=False,
        # 外部调用重试与超时（openai 客户端内置）
        max_retries=3,
        timeout=30,
    )
