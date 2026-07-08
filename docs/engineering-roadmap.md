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
| 第一批 · 落地及格线 | 5 | 5 | 完成 |
| 第二批 · 生产可用 | 6 | 2 | 进行中 |
| 第三批 · 持续优化 | 4 | 0 | 待开始 |
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

- [ ] **7.1 多知识库隔离**
  - 现状：`collection_name="know_agent"` 写死，单库
  - 目标：按 `knowledge_base_type` 或租户分 collection
  - 改动点：`vectorstore.py` 支持动态 collection；检索带 collection 过滤
  - 验收：不同知识库向量互不干扰

- [ ] **7.2 检索 metadata 过滤**
  - 现状：检索无过滤条件
  - 目标：支持按 `document_id` / `file_name` / 时间范围 / 自定义 metadata 过滤
  - 改动点：`SearchService` + `RagPipeline` 增 `filter` 参数；向量检索用 PGVector `filter`；关键词 SQL 加 where
  - 验收：指定 `document_id` 检索只返回该文档分块

### 8. HITL — 工具审批

- [ ] **8.1 HumanInTheLoopMiddleware 启用**
  - 现状：`/resume_sse` 501，工具审批空缺
  - 目标：agent 工具调用可配置为需审批，前端审批后恢复
  - 改动点：
    - `agents/react_agent.py` 加 `HumanInTheLoopMiddleware`（按工具名配置）
    - `/resume_sse` 实现：接收审批结果，`Command(resume=...)` 继续
    - SSE 流在 interrupt 时推送待审批工具信息
  - 验收：工具调用中断→前端审批→恢复执行，全链路通

### 9. SSE 断线重连

- [ ] **9.1 Last-Event-ID 续传**
  - 现状：SSE 断线丢流，前端只能重来
  - 目标：支持 `Last-Event-ID` 头续传
  - 改动点：SSE 事件带 id，服务端缓存事件流，重连时按 id 续发
  - 验收：流中断后带 `Last-Event-ID` 重连，从中断处续传

### 10. 向量检索性能

- [ ] **10.1 pgvector HNSW 索引调优**
  - 现状：默认 ivfflat，未调参
  - 目标：建 HNSW 索引，调 `ef_construction` / `ef_search`
  - 改动点：新 alembic 迁移建 HNSW 索引；`vectorstore.py` 检索参数调优
  - 验收：10万+向量时检索延迟 <100ms，召回率不降

### 11. API 版本化

- [ ] **11.1 /v1 前缀**
  - 现状：无版本前缀
  - 目标：所有业务接口挂 `/v1`，为破坏性变更留退路
  - 改动点：`main.py` router prefix 统一加 `/v1`
  - 验收：`/v1/api/document/...` 可用，旧路径可设兼容期

---

## 第三批 · 持续优化

> 量化和扩展。

### 12. RAG 评估体系
- [ ] 接入 RAGAS：检索 recall/precision、答案 faithfulness/relevance
- [ ] 构建评估数据集，CI 跑评估，量化 RAG 调参效果

### 13. 文档增量更新
- [ ] 重新上传走增量（仅重算变更分块），非全量重向量化
- [ ] 文档版本管理

### 14. 缓存
- [ ] embedding 缓存（相同 query 不重复算）
- [ ] 检索结果缓存（短期）

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

## 执行约定

1. 严格按第一批 → 第二批 → 第三批顺序，不跳级
2. 每项开工前在该文档对应 checkbox 前标注 `进行中`，完成后改 `[x]` 并更新进度总览
3. 每项交付后跑一遍三条主链路（文档入库 / agent 对话 / PPT 生成）回归
4. 架构前置决策 A/B 在第一批启动前先评估，避免返工
