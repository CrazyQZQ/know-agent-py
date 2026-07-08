"""全局配置 — 通过环境变量 / .env 注入（pydantic-settings）.

环境变量命名遵循业内公认习惯：
  - DeepSeek (LLM, OpenAI 兼容): DEEPSEEK_*
  - 火山方舟 Doubao (Embedding, OpenAI 兼容): ARK_*
  - PostgreSQL (业务数据 + pgvector 向量 + 关键词检索 + langgraph checkpoint): DATABASE_URL
  - RustFS (S3 兼容对象存储): S3_*
  - Jina MCP (搜索): JINA_*

关键词检索使用 PostgreSQL 内置 pg_trgm 扩展（全文检索），与 pgvector 向量检索组成混合检索，
不依赖 Elasticsearch。
"""

from functools import lru_cache
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # 应用
    app_name: str = "know-agent"
    app_env: str = "dev"
    app_port: int = 8000

    # 认证 — API Key 头校验（AUTH_ENABLED=false 时旁路，本地开发友好）
    auth_enabled: bool = False
    api_key: str | None = None
    # Casdoor（OIDC 认证）— AUTH_ENABLED=true 且 CASDOOR_ENABLED=true 时启用
    casdoor_enabled: bool = False
    casdoor_endpoint: str = ""  # 如 https://casdoor.example.com
    casdoor_userinfo_path: str = "/api/userinfo"  # userinfo 端点路径
    casdoor_roles_field: str = "roles"  # userinfo 返回的角色字段名
    casdoor_token_cache_ttl: int = 300  # token 验证缓存秒数
    # Casdoor 应用凭证 + 组织（用于 client credentials 列角色，供上传时选择）
    casdoor_client_id: str = ""
    casdoor_client_secret: str = ""
    casdoor_org: str = ""  # 组织名（如 qq），列角色用
    # CORS 允许源，逗号分隔；默认 * 开发友好，生产应配白名单
    cors_origins: str = "*"

    # 文件上传安全
    upload_max_size_mb: int = 50  # 上传文件大小上限（MB）
    upload_allowed_extensions: str = "pdf,doc,docx,txt,md,markdown,html,htm,csv,xlsx,xls"

    # LLM — DeepSeek (OpenAI 兼容)
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # Embedding — 火山方舟 Doubao (OpenAI 兼容)
    ark_api_key: str | None = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_embedding_model: str = "doubao-embedding-vision"
    embedding_dimensions: int = 2048

    # PostgreSQL — 业务数据 + pgvector 向量 + pg_trgm 关键词 + langgraph checkpoint
    database_url: str | None = None

    # RustFS — S3 兼容对象存储
    s3_endpoint: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket: str | None = None
    s3_region: str = "us-east-1"

    # Jina MCP
    jina_api_key: str | None = None
    jina_mcp_url: str = "https://mcp.jina.ai/sse"

    # RAG pipeline（生产级检索：多查询改写 + HyDE + 混合检索 + Jina 重排序）
    rag_top_k: int = 5  # 最终返回片段数
    rag_candidate_pool: int = 20  # 重排序前候选池大小
    rag_multi_query: bool = True  # 多查询改写（LLM 生成多视角查询）
    rag_hyde: bool = True  # HyDE 假设性文档嵌入
    rag_rerank: bool = True  # Jina cross-encoder 重排序（无 key 自动降级为 RRF 排序）
    rag_rerank_model: str = "jina-reranker-v2-base-multilingual"

    # API 限流（slowapi，按 IP 限流，保护 agent/graph 等高成本端点）
    rate_limit: str = "60/minute"
    # HITL 工具审批：逗号分隔的工具名，这些工具调用前 interrupt 等前端审批（空=不启用）
    hitl_tools: str = ""
    # pgvector HNSW 检索候选池大小（越大召回越高、越慢；HNSW 索引由 alembic 0004 建）
    hnsw_ef_search: int = 40
    # 检索结果缓存（TTL 秒 + 最大条数；短期缓存减少重复 embedding/检索）
    cache_ttl: int = 300
    cache_maxsize: int = 1000
    # mem0 长期记忆（云端 OpenMemory，https://mem0.ai 注册获取；空=记忆系统旁路）
    mem0_api_key: str | None = None

    # 可观测性 — LangSmith tracing（langchain 内置，设环境变量即生效，无需改业务代码）
    langsmith_tracing: bool = False
    langsmith_api_key: str | None = None
    langsmith_project: str = "know-agent"
    langsmith_endpoint: str = "https://api.smith.langchain.com"

    @property
    def database_url_safe(self) -> str | None:
        """返回密码经 URL 编码的连接串.

        DATABASE_URL 中密码若含 @ : / # 等特殊字符，直接传给 psycopg 会解析失败，
        这里用 SQLAlchemy URL.create 重新构造，自动对密码做 percent-encoding。
        """
        url = self.database_url
        if not url:
            return None
        p = urlparse(url)
        return URL.create(
            drivername="postgresql+psycopg",
            username=p.username,
            password=p.password,
            host=p.hostname,
            port=p.port,
            database=p.path.lstrip("/"),
        ).render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
