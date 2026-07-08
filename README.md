# know-agent

基于 **LangChain（`create_agent` + middleware）/ LangGraph + FastAPI** 的智能体应用，迁移自 Java 项目 `know-agent-apring-ai`（Spring AI Alibaba）。

## 技术栈

| 层 | 选型 |
|---|---|
| Web | FastAPI + uvicorn + sse-starlette |
| LLM | DeepSeek（OpenAI 兼容，`langchain-openai`） |
| Embedding | 火山方舟 Doubao（OpenAI 兼容，2048 维） |
| Agent | `langchain.agents.create_agent` + middleware |
| Graph | `langgraph.StateGraph` |
| 关系型数据库 | PostgreSQL（统一：业务数据 + pgvector 向量 + pg_trgm 关键词 + langgraph checkpoint） |
| 向量检索 | pgvector（`langchain-postgres`） |
| 关键词检索 | pg_trgm（PG 内置扩展，`word_similarity`） |
| 混合检索 | pg_trgm + pgvector + RRF 融合 |
| RAG pipeline | Multi-Query + HyDE 改写 → 混合检索 → Jina Rerank 重排 → 引用注入 |
| 重排序 | Jina Rerank（cross-encoder，复用 `JINA_API_KEY`，无 KEY 自动降级） |
| 可观测性 | LangSmith tracing（langchain 内置，`LANGSMITH_*` 环境变量开启） |
| ORM | SQLAlchemy 2.0 + Alembic |
| 对象存储 | RustFS（S3 兼容，boto3） |
| MCP | Jina（`langchain-mcp-adapters`） |
| 文档解析 | PyMuPDF / python-docx / pandas |
| PPT 渲染 | python-pptx（`scripts/render_ppt.py`） |
| 包管理 | uv |

## 架构

```
FastAPI :8000
├─ /api/document  文档管理（上传→分块→向量化→混合检索）
│     ├─ upload / split / embedding
│     └─ search（keyword / vector / hybrid RRF）
├─ /api/segment   分块管理
├─ /list-apps /run_sse /chat/ask   common-agent（create_agent + middleware）
│     └─ tools: datetime / weather / knowledge_base_search / ppt_template
│           └─ knowledge_base_search = 生产级 RAG pipeline（改写→混合检索→重排→引用注入）
├─ /apps/{app}/users/{user}/threads   agent thread 管理
└─ /list-graphs /graph_run_sse /graph_resume_sse   PPT 生成 graph
      └─ requirement → search → template_select → outline → schema → render
```

**数据流：**
- 文档：上传 → RustFS → 解析(PyMuPDF/docx) → 分块 → PostgreSQL + pgvector(向量) + pg_trgm(关键词)
- 知识库检索（生产级 RAG pipeline）：
  - ① QueryTransformer：Multi-Query 多视角改写 + HyDE 假设性文档嵌入
  - ② MultiQueryRetriever：多查询并行 hybrid_search（pg_trgm + pgvector）+ 跨查询 RRF 融合去重
  - ③ Reranker：Jina cross-encoder 重排序（无 KEY 或失败自动降级为 RRF 排序）
  - ④ ContentInjector：带来源标注的结构化上下文（`来源:《文档名》 | 相关度:xxx`）
  - QueryRouter 由 agentic RAG 承担（`create_agent` 自主决定是否调用检索工具）
- Agent：`create_agent` + middleware（Logging / Summarization / ToolCallLimit）+ PostgresSaver checkpoint
- PPT graph：`StateGraph` 8 节点 + `interrupt_before` 人在回路 + `render_ppt.py` 渲染

## 目录结构

```
src/know_agent/
├─ main.py              # FastAPI 入口
├─ configuration.py     # 配置（.env）
├─ core/                # 日志 / 响应封装 / 依赖注入
├─ db/                  # PostgreSQL 引擎
├─ models/              # SQLAlchemy ORM + 领域枚举
├─ schemas/             # pydantic API 模型
├─ llm/                 # Chat / Embedding 工厂
├─ tools/               # langchain @tool
├─ agents/              # common-agent（create_agent + middleware + checkpoint）
├─ graphs/ppt/          # PPT 生成 graph（StateGraph）
├─ services/            # document / oss / mcp
└─ routers/             # FastAPI 路由
alembic/                # 数据库迁移
scripts/render_ppt.py   # PPT 渲染脚本
scripts/init_db.sql     # 建库 + 扩展
```

## 模块

1. **文档管理** — 上传 → RustFS → 解析 → 分块 → pgvector 向量化；混合检索（pg_trgm + pgvector RRF）
2. **知识库检索（RAG pipeline）** — Multi-Query+HyDE 改写 → 多查询混合检索+跨查询 RRF → Jina Rerank 重排 → 引用注入；`knowledge_base_search` 工具封装，agent 自主调用
3. **common-agent** — `create_agent` + middleware（Logging / Summarization / ToolCallLimit），4 工具，PostgresSaver checkpoint
4. **PPT 生成 graph** — `StateGraph`：requirement → search → template_select → template_info → outline → schema → render，`interrupt_before` 人在回路

## 快速开始

```bash
# 1. 安装依赖
uv sync

# 2. 配置环境变量
cp .env.example .env  # 填 DATABASE_URL / S3_* / DEEPSEEK_* / ARK_* / JINA_*

# 3. 建库 + 扩展（PostgreSQL）
psql -U postgres -c "CREATE DATABASE know_agent;"
psql -U postgres -d know_agent -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -U postgres -d know_agent -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 4. 建表（Alembic 迁移）
uv run alembic upgrade head

# 5. 启动
uv run uvicorn know_agent.main:app --reload --port 8000
```

访问 http://localhost:8000/docs 查看 API。

## API 总览

### 文档管理
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/document/upload` | 上传文档（multipart） |
| POST | `/api/document/split/{id}` | 分块 |
| POST | `/api/document/embedding/{id}` | 向量化 |
| GET | `/api/document/search?q=&mode=hybrid` | 混合检索（keyword/vector/hybrid） |
| GET | `/api/document/page` | 分页 |
| GET | `/api/document/{id}` | 获取 |
| DELETE | `/api/document/{id}` | 删除 |
| GET | `/api/segment/page` | 分块分页 |
| GET | `/api/segment/list-by-document` | 按文档查分块 |
| GET | `/api/segment/{id}` | 获取分块 |
| DELETE | `/api/segment/{id}` | 删除分块 |

### common-agent
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list-apps` | 列 agent |
| POST | `/run_sse` | SSE 流式运行 |
| GET | `/chat/ask?question=` | 简单对话 |
| GET/POST/DELETE | `/apps/{app}/users/{user}/threads[/{tid}]` | thread 管理 |

### PPT graph
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/list-graphs` | 列 graph |
| POST | `/graph_run_sse` | SSE 流式运行（含 interrupt 检测） |
| POST | `/graph_resume_sse` | 人在回路恢复 |

## 实施进度

- [x] 阶段 0 — 项目骨架
- [x] 阶段 1 — 基础设施（db / models / llm / oss / mcp）
- [x] 阶段 2 — 文档管理（含 pg_trgm 混合检索）
- [x] 阶段 3 — common-agent（create_agent + middleware）
- [x] 阶段 4 — PPT 生成 graph
- [x] 阶段 5 — 集成收尾

## 已知限制

- **HITL 工具审批**：`/resume_sse` 留接口（501），`HumanInTheLoopMiddleware` 可按需启用
- **PPT 模板**：仅 `ai` 模板（硬编码），需预先上传 `ppt-templates/ai.pptx` 到 RustFS；多模板支持待扩展
- **PPT schema 对齐**：LLM 生成 schema 的字段名需与 `ai.pptx` 的 shape name 匹配，否则部分 shape 不填充
- **render_ppt.py 编码**：Windows 下子进程某处 `open` 默认 gbk，非致命（PPT 正常生成），如需消除可显式指定 `encoding="utf-8"`
- **MCP/Jina 工具**：common-agent 未集成 web_search（Jina MCP 客户端已就绪，按需加载）
- **天气工具**：占位实现，可接真实天气 API
- **SummarizationMiddleware**：`messages_to_keep` 用默认值，如需对齐源项目（6 条）可加 `TriggerClause`
