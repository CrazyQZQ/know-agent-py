# 工程化补足路线图

> 目标：将 know-agent 从"功能可跑"推进到"可落地生产的工程化 agent 项目"。
> 按落地阻塞度分三批，每项含**现状 / 目标 / 改动点 / 验收**，逐项推进，完成即勾选。

## 推进原则

- **先可观测后加固**：先接 trace，后续每项改动都能借 trace 调试，事半功倍
- **每项独立可交付**：一项一个 PR/提交，不混合
- **验收驱动**：每项有明确验收标准，不达标不勾选
- **不破坏现有链路**：文档管理 / agent / PPT graph 三条主链路始终可跑

## 进度总览

| 批次 | 项数 | 完成 | 状态 |
|---|---|---|---|
| 第一批 · 落地及格线 | 6 | 6 | 完成 |
| 第二批 · 生产可用 | 6 | 6 | 完成 |
| 第三批 · 持续优化 | 4 | 3 | 进行中 |
| 架构前置决策 | 2 | 2 | 已决策 |

---

## 第一批 · 落地及格线

> 不补完这 5 项不能进生产。

### 1. 可观测性 — LangSmith trace + 结构化日志

- [x] **1.1 接入 LangSmith trace**
  - 现状：agent 链路（改写→检索→rerank→LLM→工具）是黑盒，出问题无法定位
  - 目标：每次 agent/graph 运行在 LangSmith 可见完整 trace（含每步输入输出、token、耗时）
  - 改动点：
    - `configuration.py` 增 `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` / `LANGSMITH_TRACING=true`
    - `langchain` 已内置 tracing，设置环境变量即生效，无需改业务代码
    - `.env.example` 补配置；README 技术栈表加一行
  - 验收：跑一次 `/run_sse`，LangSmith UI 能看到完整调用链 + 每个工具/检索的输入输出

- [x] **1.2 结构化日志 + request_id 串联**
  - 现状：loguru 日志无请求级关联，并发时无法区分哪个请求
  - 目标：每个请求带 `request_id`，贯穿 agent/检索/工具日志
  - 改动点：FastAPI 中间件注入 `request_id`（UUID）到 contextvar，loguru patcher 注入日志字段
  - 验收：并发请求时，按 `request_id` 可过滤出单次请求的完整日志链

### 2. 安全 — 认证授权

- [x] **2.1 API 认证（API Key / JWT）**
  - 现状：API 完全裸奔，CORS `*`
  - 目标：受保护接口需认证；本地开发可旁路
  - 改动点：
    - `core/security.py` 新增认证依赖（API Key 头 `x-api-key`，可选 JWT）
    - `configuration.py` 增 `AUTH_ENABLED` / `API_KEY` / `JWT_SECRET`
    - FastAPI 依赖注入保护业务路由；`/health` 放行
    - CORS 收紧到白名单
  - 验收：无凭证请求业务接口返回 401；带凭证正常；`AUTH_ENABLED=false` 时旁路

- [x] **2.2 检索强制权限过滤**
  - 现状：`accessible_by` 字段存了但检索时未过滤，无权限用户可读到受限文档
  - 目标：检索（keyword/vector/hybrid）按当前用户过滤 `accessible_by`
  - 改动点：`SearchService` 各查询方法增 `user` 参数，SQL/向量 metadata 加过滤条件
  - 验收：用户 A 上传的 `accessible_by=A` 文档，用户 B 检索不到

- [x] **2.3 文件上传安全**

- [x] **2.4 Casdoor 对接 + 角色过滤升级**
  - 现状：2.1 API Key 认证 + 2.2 按 user 过滤，user 来自 `x-user` 头（明文可伪造）
  - 目标：对接 Casdoor OIDC（方式 A：远程验证 `/api/userinfo` + 缓存），角色来自 Casdoor JWT；`accessible_by` 改为角色列表；检索 + 文档查询按角色过滤
  - 改动点：
    - `core/security.py` 新增 `verify_casdoor_token`（调 `/api/userinfo` + 内存缓存）+ `verify_auth` 分发
    - `configuration.py` 加 `CASDOOR_*` 配置；`core/request_context.py` 加 `roles_var`
    - `accessible_by` 语义改为角色列表（逗号分隔，空=公开）
    - `search.py` `_can_access` + 三方法按角色过滤
    - `repository.py` `page_documents` / `get_document` 加角色过滤
    - `routers/document.py` 文档查询接入角色过滤
  - 验收：带 Casdoor token 请求，角色正确提取；无权限角色检索/查询不到受限文档
  - 现状：无文件大小/类型校验
  - 目标：限制大小（如 50MB）+ 扩展名白名单 + MIME 校验
  - 改动点：`routers/document.py` upload 端点加校验
  - 验收：超大/非白名单文件返回 415/413

### 3. 异步化 — 文档处理不阻塞请求

- [x] **3.1 文档处理异步任务化**
  - 现状：`upload` 同步解析 PDF + `embed_and_store` 同步批量，大文件卡死请求
  - 目标：upload 立即返回（状态 `UPLOADED`），解析/分块/向量化异步执行，前端轮询状态
  - 改动点：
    - 评估方案：`BackgroundTasks`（轻量，单进程）vs 任务队列（Celery/RQ，可扩展）
    - 推荐：先用 FastAPI `BackgroundTasks` + DB 状态机轮询，避免引入队列中间件
    - `service.py` 拆分 upload（仅入库+OSS）与 process（异步解析+分块+向量化）
    - 前端轮询 `GET /api/document/{id}` 看 `status`
  - 验收：上传 10MB PDF 接口 <1s 返回；后台处理完成后状态流转到 `VECTOR_STORED`

### 4. 容器化与 CI

- [x] **4.1 Dockerfile + docker-compose**
  - 现状：无容器化，环境漂移
  - 目标：一键 `docker compose up` 起服务（app + postgres 带 vector/pg_trgm 扩展）
  - 改动点：
    - `Dockerfile`（多阶段构建，uv 安装）
    - `docker-compose.yml`（app + pgvector/pgvector 镜像 + rustfs 可选）
    - `.dockerignore`
  - 验收：`docker compose up` 后 `/health` 200，迁移自动跑

- [ ] **4.2 基础 CI（GitHub Actions）**
  - 现状：无 CI
  - 目标：PR 触发 lint（ruff）+ 测试 + 迁移检查
  - 改动点：
    - 引入 ruff 配置（`pyproject.toml`）
    - `.github/workflows/ci.yml`：`uv sync` → `ruff check` → `pytest` → `alembic check`
  - 验收：PR 有 CI 状态；ruff 报错阻断合并

### 5. 测试 — 核心链路回归保障

- [x] **5.1 核心链路测试**
  - 现状：零测试
  - 目标：文档管理 + RAG pipeline + agent 工具有回归测试
  - 改动点：
    - `tests/conftest.py` 测试夹具（mock LLM/embedding/DB）
    - `tests/test_rag_pipeline.py`：多查询改写/RRF 融合/rerank 降级/引用注入
    - `tests/test_document_service.py`：状态机流转、splitter
    - `tests/test_search.py`：keyword/vector/hybrid
    - agent 工具测试用 mock LLM（不耗 token）
  - 验收：`uv run pytest` 全绿，覆盖率覆盖核心业务逻辑

### 6. 记忆系统 - 会话历史 + 长期记忆

- [x] **6.1 会话历史接口（短期记忆）**
  - 现状：checkpoint 存了对话历史，但 get_thread 返回 state.values（含 langgraph Message 对象，FastAPI 无法序列化），进入旧会话看不到历史
  - 目标：进入旧会话能拉取历史消息展示
  - 改动点：`agents/thread.py` `_format_message` 格式化为 {role, content}；`get_thread` 返回 {thread_id, messages}；`GET /v1/.../threads/{id}/history`
  - 验收：进入旧会话调 history 端点看到历史消息

- [x] **6.2 mem0 长期记忆（云端，c 方案）**
  - 现状：只有 checkpoint（短期），跨会话无记忆
  - 目标：跨会话长期记忆（用户偏好/事实），自动提取 + 检索注入
  - 改动点：`agents/memory.py` get_memory（mem0 云端，无 key 旁路）+ search_memories + extract_memories；`run_sse` 检索注入 SystemMessage + BackgroundTasks 自动提取；`MEM0_API_KEY` 配置
  - 验收：对话后 mem0 存记忆，下次对话注入相关记忆

---

## 第二批 · 生产可用

> 补完进入小规模生产。

### 6. 健壮性 — 重试/超时/限流

- [x] **6.1 外部调用重试与超时**
  - 现状：LLM/Embedding/Jina/RustFS 调用无重试无超时，抖动即 500
  - 目标：外部调用统一 tenacity 重试 + 超时
  - 改动点：`llm/chat.py` `llm/embedding.py` `services/oss.py` `rag/reranker.py` 加 `retry` 装饰器 + `timeout`
  - 验收：模拟网络抖动，调用自动重试不透传 500

- [x] **6.2 API 限流**
  - 现状：无限流，易被刷爆 token
  - 目标：按用户/IP 限流（如 60 req/min）
  - 改动点：引入 `slowapi`，保护 `/run_sse` `/chat/ask` `/graph_run_sse`
  - 验收：超频请求返回 429

### 7. 多知识库与检索增强

- [x] **7.1 多知识库隔离**
  - 现状：`collection_name="know_agent"` 写死，单库
  - 目标：按 `knowledge_base_type` 或租户分 collection
  - 改动点：`vectorstore.py` 支持动态 collection；检索带 collection 过滤
  - 验收：不同知识库向量互不干扰

- [x] **7.2 检索 metadata 过滤**
  - 现状：检索无过滤条件
  - 目标：支持按 `document_id` / `file_name` / 时间范围 / 自定义 metadata 过滤
  - 改动点：`SearchService` + `RagPipeline` 增 `filter` 参数；向量检索用 PGVector `filter`；关键词 SQL 加 where
  - 验收：指定 `document_id` 检索只返回该文档分块

### 8. HITL — 工具审批

- [x] **8.1 HumanInTheLoopMiddleware 启用**
  - 现状：`/resume_sse` 501，工具审批空缺
  - 目标：agent 工具调用可配置为需审批，前端审批后恢复
  - 改动点：
    - `agents/react_agent.py` 加 `HumanInTheLoopMiddleware`（按工具名配置）
    - `/resume_sse` 实现：接收审批结果，`Command(resume=...)` 继续
    - SSE 流在 interrupt 时推送待审批工具信息
  - 验收：工具调用中断→前端审批→恢复执行，全链路通

### 9. SSE 断线重连

- [x] **9.1 Last-Event-ID 续传**
  - 现状：SSE 断线丢流，前端只能重来
  - 目标：支持 `Last-Event-ID` 头续传
  - 改动点：SSE 事件带 id，服务端缓存事件流，重连时按 id 续发
  - 验收：流中断后带 `Last-Event-ID` 重连，从中断处续传

### 10. 向量检索性能

- [x] **10.1 pgvector HNSW 索引调优**
  - 现状：默认 ivfflat，未调参
  - 目标：建 HNSW 索引，调 `ef_construction` / `ef_search`
  - 改动点：新 alembic 迁移建 HNSW 索引；`vectorstore.py` 检索参数调优
  - 验收：10万+向量时检索延迟 <100ms，召回率不降

### 11. API 版本化

- [x] **11.1 /v1 前缀**
  - 现状：无版本前缀
  - 目标：所有业务接口挂 `/v1`，为破坏性变更留退路
  - 改动点：`main.py` router prefix 统一加 `/v1`
  - 验收：`/v1/api/document/...` 可用，旧路径可设兼容期

---

## 第三批 · 持续优化

> 量化和扩展。

### 12. RAG 评估体系
- [x] 接入 RAGAS：检索 recall/precision、答案 faithfulness/relevance
  - 注：ragas 0.4.x 与 langchain_community 0.4 不兼容（ragas import 已移除的 `langchain_community.chat_models.vertexai`），改用 LLM 评判自建脚本，指标定义与 ragas 一致
- [x] 构建评估数据集，CI 跑评估，量化 RAG 调参效果
  - `scripts/eval_rag.py`（LLM 评判 4 指标）+ `data/rag_eval.jsonl`（示例数据集）+ `docs/rag-eval.md`
  - CI 跑评估留待有真实数据集后接入

### 13. 文档增量更新
- [x] 重新上传走增量（仅重算变更分块），非全量重向量化
  - MD5 对比：分块 MD5 相同复用旧 embedding（不重算），不同/新建重算，删除的删 embedding
  - 配合 SMART 切分（按标题），改动局部化，增量生效（LENGTH 模式中间插入会导致后续全变）
- [x] 文档版本管理
  - `content_md5` 字段（文档内容版本标识，同 MD5 = 同版本）

### 14. 缓存
- [x] embedding 缓存（相同 query 不重复算）
  - 通过检索结果缓存间接实现：结果命中缓存则不调 vectorstore，不重复 embed query
- [x] 检索结果缓存（短期）
  - `core/cache.py` ResultCache（TTL + FIFO，线程安全，模块级单例跨请求共享）；vector_search/hybrid_search 缓存；hybrid 创建新 SearchResult 不污染缓存

### 15. 多 agent 编排
- [ ] supervisor 模式，复杂任务拆分给子 agent
- [ ] agent 间通信与结果聚合

---

## 架构前置决策（需先评估再动手）

### A. Checkpointer 水平扩展

- 现状：`PostgresSaver` 是同步 checkpointer，不支持 `ainvoke`，**无法多 worker 水平扩展**
- 决策点：
  - 方案 1：限定单 worker（简单，但无高可用）
  - 方案 2：换 `AsyncPostgresSaver`（需异步化所有 agent 调用路径）
  - 方案 3：换 Redis checkpointer（引入 Redis）
- 建议：落地初期单 worker 够用；若需扩展，在第二批前评估方案 2
- [x] 已评估并决策：**落地初期单 worker，暂不换 AsyncPostgresSaver**；第二批前视负载再评估

### B. 任务队列选型

- 现状：文档处理在请求线程
- 决策点：
  - 方案 1：FastAPI `BackgroundTasks`（单进程，重启丢任务，无重试）
  - 方案 2：Celery/RQ + Redis/RabbitMQ（可扩展，有重试，引入中间件）
  - 方案 3：PostgreSQL 作为任务队列（如 `pgqueuer`，不引入新中间件）
- 建议：第一批先用 `BackgroundTasks`；若任务量上来或需可靠重试，第二批切方案 3（复用 PG）
- [x] 已评估并决策：**第一批用 `BackgroundTasks`**；任务量上来或需可靠重试时切方案 3（pgqueuer 复用 PG）

---

## 生产落地补充路线图（后端）

> 这部分承接前面已完成的“功能可用”路线图，目标是把当前单实例/开发态实现逐步推进到可恢复、可扩展、可审计的生产后端。  
> 原则：不一次性大改架构；先补最影响稳定性的点，再补多实例和运维治理。

### P0. 可靠后台任务

- [ ] **P0.1 文档处理任务持久化**
  - 现状：`upload` 通过 FastAPI `BackgroundTasks` 触发解析、切分、向量化；进程重启、worker 崩溃会丢任务。
  - 目标：文档处理任务进入持久化队列，支持恢复、重试、排队、人工重跑。
  - 改动点：
    - 新增 `background_jobs` 或 `document_jobs` 表：`job_id`、`job_type`、`resource_id`、`status`、`attempts`、`max_attempts`、`next_run_at`、`locked_by`、`locked_until`、`error_code`、`error_message`。
    - `upload` 只负责入库、上传 OSS、创建任务，不直接依赖进程内后台任务完成。
    - worker 使用 PG lease 领取任务，执行 `run_document_pipeline`，成功/失败均落库。
    - 支持服务启动时扫描 `running` 但 lease 过期的任务并重新入队。
  - 验收：
    - 上传后杀掉 app 进程，重启 worker 后任务能继续处理到 `VECTOR_STORED` 或明确 `FAILED`。
    - 同一文档任务不会被两个 worker 同时执行。
    - 失败任务记录可读错误，并按 `max_attempts` 自动重试。

- [ ] **P0.2 Pipeline 步骤级恢复点**
  - 现状：文档状态机有 `UPLOADED / CONVERTING / CONVERTED / CHUNKED / VECTOR_STORED / FAILED`，但任务失败后恢复策略仍偏粗。
  - 目标：每个阶段可幂等重跑，失败后从最近的可靠状态继续。
  - 改动点：
    - 解析、切分、向量化分别记录开始/结束时间、耗时、失败原因。
    - `run_pipeline` 根据当前 `document.status` 决定从哪一步继续，而不是只处理 `UPLOADED`。
    - 向量写入使用批次级提交，记录已完成 segment，避免大文档失败后全量重算。
  - 验收：
    - 人为让向量化中途失败，修复后重跑只处理未完成 segment。
    - `FAILED` 文档可通过管理接口或脚本重新入队。

### P0. 多实例共享状态

- [ ] **P0.3 SSE 事件缓存外置**
  - 现状：`core/sse_store.py` 使用进程内内存缓存，单 worker 可用，多实例下 `Last-Event-ID` 可能连到另一台机器而取不到历史事件。
  - 目标：SSE 重连事件缓存外置到 PostgreSQL 或 Redis。
  - 改动点：
    - 新增 `sse_events` 表或 Redis Stream：按 `stream_id/thread_id` 存 `event_id`、`event`、`data`、`created_at`、`expires_at`。
    - `_stream_agent` / `_stream` 写事件时落共享存储。
    - `Last-Event-ID` 重连从共享存储读取。
    - 定期清理过期事件。
  - 验收：
    - 两个 app 实例后，第一次连接实例 A，中断后重连实例 B，仍能从 `Last-Event-ID` 后续传。

- [ ] **P0.4 Token 缓存与注销状态外置**
  - 现状：Casdoor token 缓存和 `_revoked_tokens` 都在进程内，重启或多实例后注销状态不一致。
  - 目标：认证缓存、注销黑名单在多实例间一致。
  - 改动点：
    - 使用 Redis/PG 存 token 验证缓存和 revoked token，设置 TTL。
    - logout 写共享黑名单。
    - 保留本地短 TTL 缓存作为可选优化，但以共享状态为准。
  - 验收：
    - 实例 A logout 后，实例 B 立即拒绝同 token。

### P1. 集成测试与质量门禁

- [ ] **P1.1 Docker Compose 集成测试**
  - 现状：已有较多 mock 单元测试，但真实 PostgreSQL、pgvector、pg_trgm、迁移、SSE、权限链路还缺端到端验证。
  - 目标：在本地和 CI 中用真实基础设施跑核心链路。
  - 改动点：
    - 新增 `docker-compose.test.yml`：PostgreSQL(pgvector) + app/test runner。
    - 测试启动时执行 `alembic upgrade head`。
    - 覆盖文档上传、状态轮询、切分、向量写入、keyword/vector/hybrid 检索、角色权限过滤、SSE 重连。
  - 验收：
    - 一条命令可跑完整集成测试。
    - 迁移失败、索引失败、权限绕过能在 CI 暴露。

- [ ] **P1.2 CI 质量门禁**
  - 现状：路线图已有基础 CI 项，但仍未落到工程约束。
  - 目标：PR 必须通过格式/静态检查、单测、迁移检查、核心集成测试。
  - 改动点：
    - 引入 `ruff`，先只启用低争议规则，避免一次性格式大改。
    - GitHub Actions 或本地 CI：`uv sync --frozen`、`ruff check`、`pytest`、`alembic upgrade head`。
    - 后续接入 RAG eval baseline，真实数据集成熟后再设阈值。
  - 验收：
    - 破坏数据库迁移、核心状态机、权限过滤时 CI 失败。

### P1. 可观测性与运维

- [ ] **P1.3 结构化 JSON 日志**
  - 现状：loguru 已注入 `request_id`，但输出仍偏开发态文本。
  - 目标：生产日志可被日志平台稳定采集、检索、聚合。
  - 改动点：
    - `APP_ENV=prod` 时输出 JSON 日志。
    - 标准字段：`timestamp`、`level`、`request_id`、`user_id`、`route`、`method`、`status_code`、`duration_ms`、`thread_id`、`document_id`、`job_id`。
    - 异常日志附 `error_type`、`error_code`、脱敏后的 `error_message`。
  - 验收：
    - 任意文档处理失败可通过 `request_id/document_id/job_id` 串起 HTTP、任务、LLM/OSS 调用日志。

- [ ] **P1.4 Prometheus 指标与告警**
  - 现状：有 LangSmith trace，但缺服务级、任务级、资源级指标。
  - 目标：能看见吞吐、延迟、失败率、队列积压、LLM 成本和检索质量趋势。
  - 改动点：
    - 暴露 `/metrics`。
    - 指标覆盖：HTTP QPS/latency/error、SSE 活跃连接、任务队列积压、任务耗时/失败率、LLM token/耗时、Embedding 批次耗时、RAG 检索耗时、rerank 耗时、DB 连接池。
    - 建议告警：任务积压超过阈值、失败率升高、外部 LLM 连续失败、DB 连接池耗尽、SSE 错误率升高。
  - 验收：
    - Grafana 能看到三条主链路的延迟与错误率。
    - 人为制造 OSS/LLM 失败后能触发对应告警。

### P1. 安全加固

- [ ] **P1.5 上传与解析安全**
  - 现状：已有文件大小和扩展名白名单，但还缺内容级校验和隔离策略。
  - 目标：降低恶意文件、伪扩展名、解析器漏洞、对象路径污染风险。
  - 改动点：
    - 增加 MIME/content sniffing，扩展名与实际类型不匹配则拒绝。
    - 规范化 OSS object name，避免用户文件名直接进入路径。
    - PDF/Word 解析放入低权限 worker，限制单文件解析时间和内存。
    - 可选接入杀毒扫描或文件安全网关。
  - 验收：
    - `.pdf` 后缀但实际为脚本/二进制异常内容的文件被拒绝。
    - 超时或解析异常不会拖垮 app 进程。

- [ ] **P1.6 API 权限与审计**
  - 现状：已有 API Key / Casdoor / 角色过滤；审计和生产默认安全策略还可加强。
  - 目标：关键操作可审计，生产默认不裸奔。
  - 改动点：
    - `APP_ENV=prod` 时强制 `AUTH_ENABLED=true`，禁止 `CORS_ORIGINS=*`。
    - 记录审计日志：登录/登出、上传、删除、重跑任务、修改权限、HITL 审批。
    - API Key 模式下明确只允许公开文档或服务级调用，不混用用户权限。
  - 验收：
    - 生产配置缺认证或 CORS 为 `*` 时启动失败。
    - 删除文档、重跑任务、审批工具调用都能查到审计记录。

### P2. 部署与数据库治理

- [ ] **P2.1 迁移独立执行**
  - 现状：Dockerfile 启动命令里执行 `alembic upgrade head`，多实例部署时可能并发抢迁移。
  - 目标：迁移作为独立 release job，app 只负责启动服务。
  - 改动点：
    - 拆分镜像启动命令：`migrate` job 和 `app` command。
    - 部署流程先跑迁移，成功后滚动更新 app。
    - 迁移增加回滚说明和大表变更风险提示。
  - 验收：
    - 多副本 app 启动时不会重复执行迁移。
    - 迁移失败时 app 不发布新版本。

- [ ] **P2.2 pgvector 索引方案确认**
  - 现状：HNSW 迁移里对维度限制做了异常跳过；如果 embedding 维度为 2048，索引可能没有真正建成。
  - 目标：明确线上向量索引策略，避免“迁移成功但性能没达标”。
  - 改动点：
    - 确认当前 pgvector 版本对 `vector(2048)` HNSW 的支持情况。
    - 选型：降低 embedding 维度、改 halfvec、拆分/升级 pgvector，或接受无 HNSW 并设置数据量上限。
    - 建立基准测试：1k/10k/100k segments 的召回率、P95 延迟。
  - 验收：
    - 线上目标数据量下 hybrid/vector 检索 P95 达标，并有索引存在性检查。

- [ ] **P2.3 备份、恢复与数据保留**
  - 现状：单 PostgreSQL 承载业务数据、向量、checkpoint，RustFS 承载原始/转换文件；备份恢复策略未文档化。
  - 目标：可恢复用户数据、文档、向量和会话状态。
  - 改动点：
    - PostgreSQL 定期备份，明确 RPO/RTO。
    - RustFS bucket 备份或版本化。
    - 定义 checkpoint、SSE 事件、任务历史、审计日志保留周期。
    - 编写恢复演练脚本和 runbook。
  - 验收：
    - 从备份恢复到新环境后，文档列表、检索、会话历史可用。

### P2. 成本与容量治理

- [ ] **P2.4 用户/租户级配额**
  - 现状：已有 IP 级限流和 tool call limit，但缺用户级成本约束。
  - 目标：避免单用户或单租户耗尽 LLM、Embedding、存储和任务资源。
  - 改动点：
    - 统计用户级 token、请求数、上传大小、文档数、任务数。
    - 配额策略：每日 token、并发任务数、单文档大小、知识库总容量。
    - 超额返回明确错误码，并写审计日志。
  - 验收：
    - 同一用户超过并发任务数后新任务进入排队或拒绝。
    - 超过 token/上传容量限制时返回可解释错误。

- [ ] **P2.5 Run 取消与超时治理**
  - 现状：SSE 能流式返回，但 agent/graph 长运行任务的取消、超时、资源释放还不完整。
  - 目标：用户停止生成或超时后，后端能及时停止后续高成本调用。
  - 改动点：
    - 为 agent/graph run 建立运行记录：`run_id`、`thread_id`、`status`、`started_at`、`deadline_at`。
    - 支持取消接口，流式循环和工具调用前检查取消状态。
    - 设置最大运行时间、最大 token、最大工具调用次数。
  - 验收：
    - 前端停止生成后，后端 run 状态变为 `cancelled`，不再继续调用 LLM/工具。

---

## 执行约定

1. 严格按第一批 → 第二批 → 第三批顺序，不跳级
2. 每项开工前在该文档对应 checkbox 前标注 `进行中`，完成后改 `[x]` 并更新进度总览
3. 每项交付后跑一遍三条主链路（文档入库 / agent 对话 / PPT 生成）回归
4. 架构前置决策 A/B 在第一批启动前先评估，避免返工
