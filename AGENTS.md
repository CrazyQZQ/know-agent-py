# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 常用命令

```bash
uv sync                                          # 安装依赖
uv run uvicorn know_agent.main:app --reload --port 8000  # 启动开发服务
uv run alembic upgrade head                      # 应用数据库迁移
uv run alembic revision --autogenerate -m "msg"  # 生成新迁移
uv run pytest                                    # 跑测试（当前无测试用例）
uv run pytest tests/test_foo.py::test_bar        # 跑单个测试
```

首次建库 + 扩展：`psql -d know_agent -f scripts/init_db.sql`（建 vector + pg_trgm 扩展）。

无 lint/format 配置（未引入 ruff/black）。代码风格匹配现有文件：中文 docstring、loguru 日志、`from __future__` 非必需（Python 3.12+）。

## 架构（big picture）

三大模块共享一个 PostgreSQL 实例（业务数据 + pgvector 向量 + pg_trgm 关键词 + langgraph checkpoint），这是核心架构决策——**单一关系型数据库承载一切，不引入 ES/Redis/独立向量库**。

**配置流转**：`configuration.py` (pydantic-settings 读 `.env`) → 各工厂函数 `@lru_cache` 单例（`get_chat_model` / `get_embeddings` / `get_vectorstore` / `get_checkpointer` / `get_oss`）。未配置关键凭证时工厂返回 `None`，调用方需判空。

**文档状态机**（`services/document/service.py`）：`UPLOADED → CONVERTING → CONVERTED → CHUNKED → VECTOR_STORED`。`upload` 同步完成解析（PDF/Word→markdown 上传 RustFS），`split` 切块入库，`embed_and_store` 批量写 pgvector。Excel/CSV/TXT/MD 的 `converted_doc_url = 原始`。

**RAG pipeline**（`services/document/rag/`）：`knowledge_base_search` 工具 → `RagPipeline.run()` 编排 4 步，全链路可降级：
- `QueryTransformer`（multi-query + HyDE，LLM 失败降级为原 query）
- `MultiQueryRetriever`（多查询并行 hybrid_search + 跨查询 RRF 融合）
- `Reranker`（Jina cross-encoder，无 `JINA_API_KEY` 或调用失败降级为 RRF 排序）
- `ContentInjector`（带 `来源:《文档名》` 标注）
- QueryRouter 由 agentic RAG 承担（`create_agent` 自主决定是否调工具），不单独实现

**common-agent**（`agents/react_agent.py`）：`langchain.agents.create_agent` + middleware（自写 `LoggingMiddleware` + 现成 `SummarizationMiddleware` / `ToolCallLimitMiddleware`）+ `PostgresSaver` checkpointer。**不是** `create_react_agent`（已迁移）。

**PPT graph**（`graphs/ppt/`）：`StateGraph` 8 节点（requirement → search → template_select → template_info → outline → schema → render），`interrupt_before=["clarification"]` 人在回路，`workflow.compile(checkpointer=...)`。`render` 节点 subprocess 调 `scripts/render_ppt.py`。

**SSE 流**：`sse-starlette` 的 `EventSourceResponse`。agent `/run_sse` 用 `stream_mode="messages"`（event: message/tool/done）；graph 用 `stream_mode="updates"`（event: update/interrupt/done）。

## 关键约定与陷阱

这些是非显而易见、踩坑后的硬约定，修改相关代码时务必遵守：

- **DATABASE_URL 密码特殊字符**：密码含 `@:#/?#` 等会被 psycopg/psycopg 解析错。**永远用 `settings.database_url_safe`**（`configuration.py`，SQLAlchemy `URL.create` 自动 percent-encode），不要直接用 `database_url`。向量库、checkpoint、SessionLocal 都用 safe 版。
- **alembic env.py 绕过 configparser**：`alembic/env.py` 用 `create_engine(url)` 直连，**不用** `set_main_option`。原因：configparser 把密码里的 `%40` 当插值语法报错。新增迁移无需改 env.py。
- **PG 索引名 schema 内唯一**：MySQL 索引名表内唯一即可，PG 是 schema 内唯一。两表都有 `idx_status` 会冲突——segment 表用 `idx_segment_status`。新增索引注意命名。
- **Embedding 必须 `check_embedding_ctx_length=False`**（`llm/embedding.py`）：火山方舟 Doubao 不接受 tiktoken 切出的 token id 数组，只接受字符串。改模型时勿删此参数。
- **PostgresSaver 必须 `autocommit=True`**（`agents/checkpoint.py`）：`psycopg.connect(pg_url, autocommit=True)`。原因：① `setup()` 的 `CREATE INDEX CONCURRENTLY` 不能在事务内；② langgraph 写 checkpoint 不显式 commit，依赖 autocommit 持久化。不加会导致 checkpoint 写丢失（`count=0`）。
- **PostgresSaver 是同步 checkpointer**：不支持 `ainvoke`/`astream` 的异步 checkpoint 操作（`NotImplementedError`）。用同步 `agent.invoke()` 或 `astream`（astream 的 checkpointer 同步 get 仍可用）。前端 SSE 用 `astream` 没问题，但别用 `ainvoke`。
- **ORM `metadata` 字段用 `metadata_` 别名**（`models/document.py`）：`metadata` 是 SQLAlchemy 保留属性。列名仍是 `metadata`（`mapped_column("metadata", JSONB)`），Python 侧访问用 `segment.metadata_`。pydantic `SegmentOut` 用 `validation_alias="metadata_"` 对齐。
- **langgraph 3.x checkpoint 表名**：`checkpoints` / `checkpoint_writes` / `checkpoint_blobs`（不是 `writes`）。`agents/thread.py` 的 `delete_thread` 删这三张表。
- **OSS endpoint 自动补全**（`services/oss.py`）：`_normalize_endpoint` 会给无 scheme 的 endpoint 补 `http://` + 默认端口 9000（RustFS 默认）。相对路径的 `template_url`（如 `ppt-templates/ai.pptx`）直接用作 object name，不要截成 `ai.pptx`。
- **PPT 模板**：仅 `ai` 模板（`graphs/ppt/nodes.py` 硬编码），需预先上传 `ppt-templates/ai.pptx` 到 RustFS。`render_ppt.py` 在 Windows 下有非致命 gbk 编码警告。

## 环境变量

`.env`（从 `.env.example` 复制）。业界标准命名：`DEEPSEEK_*`（LLM）/ `ARK_*`（embedding）/ `DATABASE_URL` / `S3_*`（RustFS）/ `JINA_*`（MCP + Rerank 复用）/ `RAG_*`（pipeline 开关，均有默认值）。`JINA_API_KEY` 同时用于 MCP 搜索和 Rerank 重排序。

## 权限校验

两层权限（`core/security.py` + `core/request_context.py`）：

- **API 认证**（服务级）— `verify_auth` 依赖分发，业务路由 `dependencies=[Depends(verify_auth)]`，`/health` 放行：
  - `AUTH_ENABLED=false`（默认）：旁路（本地开发）
  - `AUTH_ENABLED=true` + `CASDOOR_ENABLED=true`：Casdoor JWT，调 `/api/userinfo` 验证 Bearer token + 内存缓存（TTL=`CASDOOR_TOKEN_CACHE_TTL`）
  - `AUTH_ENABLED=true` + `CASDOOR_ENABLED=false`：API Key 头（`x-api-key`）
- **数据权限**（数据级）— `accessible_by` 字段存**角色列表**（逗号分隔，空=公开）：
  - 检索（keyword/vector/hybrid）+ 文档查询（page/get）按 当前用户角色 ∩ 文档角色 过滤
  - 角色从 Casdoor JWT `roles` 字段提取（`org/role_name` 取 `/` 后的 role_name），存 `roles_var` contextvar
  - keyword 用 SQL `string_to_array(accessible_by,',') && :roles` 数组重叠；vector over-fetch 3x + Python `_can_access`；文档查询用 `_doc_accessible`
  - contextvar 贯穿 HTTP→agent→工具：`verify_casdoor_token` set roles → `get_current_roles()` 在 search/repository/rag 工具读取
  - `accessible_by` 在 `service.py upload` 时 trim 规范化

## CodeGraph

本项目已配置 CodeGraph MCP（`codegraph_*` 工具），索引基于 tree-sitter AST 解析。

**结构化问题优先用 codegraph，纯文本查询用 grep/read。**

- 查符号定义/签名 → `codegraph_search`（不要 grep 符号名）
- 调用关系 → `codegraph_callers` / `codegraph_callees`
- 改动影响 → `codegraph_impact`
- 任务上下文 → `codegraph_context`（一次调用）
- 多符号源码 → `codegraph_explore`（一次调用，token 重，重时用 subagent）
- 流程追踪 → `codegraph_trace`（从 X 到 Y 的完整路径）

信任 codegraph 结果（全 AST 解析），不要用 grep 二次验证。文件写入后索引有 ~500ms 延迟，同轮编辑后不要立即重查。若 `.codegraph/` 不存在，提示用户运行 `codegraph init -i`。
