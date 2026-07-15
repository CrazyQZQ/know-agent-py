# Know-Agent 后端 API 接口文档

> 供前端对接使用。基于当前后端实际实现，共 **21 个业务接口** + 健康检查。

## 1. 概述

| 项 | 值 |
|---|---|
| Base URL | `http://localhost:8000` |
| 认证 | 无（本地开发） |
| CORS | 允许全部源（`*`） |
| 交互式文档 | `GET /docs`（Swagger UI） |
| OpenAPI Schema | `GET /openapi.json` |

### 1.1 通用约定

- **Content-Type**：JSON 接口为 `application/json`；上传接口为 `multipart/form-data`；分块接口为 `application/x-www-form-urlencoded`
- **时间格式**：ISO 8601（`2026-07-07T14:18:22.882`）
- **分页响应**：统一 `{ records, total, current, size }`
- **错误响应**：HTTP 状态码 + `{ "detail": "错误信息" }`
- **SSE 流**：`text/event-stream`，每个事件为 `event: <类型>\ndata: <内容>\n\n`

### 1.2 枚举值

前端下拉/校验需要用到以下合法值：

| 枚举 | 取值 | 说明 |
|---|---|---|
| 文档状态 `status` | `INIT` / `UPLOADED` / `CONVERTING` / `CONVERTED` / `CHUNKED` / `VECTOR_STORED` / `STORED` | 文档状态机 |
| 分块状态 `status` | `STORED` / `VECTOR_STORED` | 分块是否已向量化 |
| 知识库类型 `knowledge_base_type` | `DOCUMENT_SEARCH` / `DATA_QUERY` | 文档检索 / 数据查询 |
| 分块策略 `split_type` | `SMART` / `TITLE` / `LENGTH` / `REGEX` / `SEPARATOR` | 智能分块 / 按标题 / 按长度 / 正则 / 分隔符 |
| 检索模式 `mode` | `keyword` / `vector` / `hybrid` | 关键词 / 向量 / 混合(RRF) |

---

## 2. 健康检查

### `GET /health`

**响应**：
```json
{ "status": "ok", "app": "know-agent" }
```

---

## 认证

前端调受保护接口前需先登录获取 Casdoor token，后续请求带 `Authorization: Bearer <token>`。受保护接口未带 token 或 token 无效返回 401。

### `POST /api/auth/login`

用户名密码登录（后端代理 Casdoor password grant）。

**请求体**：
```json
{ "username": "lxqq", "password": "Lxqq0912!" }
```

**响应**：
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "Bearer",
  "expires_in": 604800,
  "user": {
    "name": "qq",
    "sub": "a41b9db1-...",
    "roles": ["admin"],
    "email": "xxx@qq.com"
  }
}
```

用户名或密码错误返回 401。

### `POST /api/auth/logout`

注销当前 token。需带 `Authorization: Bearer <token>` 头。

**响应**：`{ "ok": true }`

注销后 token 加入后端黑名单，立即失效（即使 JWT 未过期）。

### `GET /api/auth/me`

获取当前登录用户信息（验证 token 有效性）。需带 token。

**响应**：
```json
{ "user": "a41b9db1-...", "roles": ["admin"] }
```

> **前端集成**：登录后存 `access_token`（localStorage），每次请求带 `Authorization: Bearer <token>`；注销时调 `/api/auth/logout` 后清除本地 token。token 过期（7天）后需重新登录。

---

## 3. 文档管理

前缀：`/api/document`

### 3.1 上传文档 `POST /api/document/upload`

`multipart/form-data`，同步完成：上传到 RustFS → 解析（PDF/Word 转 markdown）→ 入库（状态 `CONVERTED`）。

**表单字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | File | 是 | 文件（pdf/doc/docx/txt/md/csv/xlsx） |
| `upload_user` | string | 是 | 上传人 |
| `title` | string | 是 | 文档标题 |
| `description` | string | 是 | 描述 |
| `knowledge_base_type` | string | 是 | `DOCUMENT_SEARCH` / `DATA_QUERY` |
| `accessible_by` | string | 否 | 可访问范围 |
| `table_name` | string | 否 | 数据查询场景的表名 |

**响应**：`DocumentOut`
```json
{
  "doc_id": 1,
  "doc_title": "产品手册",
  "upload_user": "alice",
  "doc_url": "https://oss.../产品手册.pdf",
  "converted_doc_url": "https://oss.../converted/产品手册.md",
  "status": "CONVERTED",
  "accessible_by": null,
  "description": "产品说明文档",
  "knowledge_base_type": "DOCUMENT_SEARCH",
  "extension": null,
  "created_at": "2026-07-07T14:00:00",
  "updated_at": "2026-07-07T14:00:00"
}
```

### 3.2 分块 `POST /api/document/split/{document_id}`

`application/x-www-form-urlencoded`。将已解析文档按策略切分为分块，状态转为 `CHUNKED`。

**路径参数**：`document_id` (int)

**表单字段**：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `split_type` | string | `SMART` | 分块策略（见枚举） |
| `chunk_size` | int | 500 | 每块最大字符数 |
| `overlap` | int | 0 | 块间重叠字符数 |
| `regex` | string | - | REGEX 策略的正则 |
| `separator` | string | - | SEPARATOR 策略的分隔符 |

**响应**：`int`（分块数量）

### 3.3 向量化 `POST /api/document/embedding/{doc_id}`

将分块批量写入 pgvector 向量库，状态转为 `VECTOR_STORED`。

**响应**：`"success"` / `"failed"`

### 3.4 分页查询 `GET /api/document/page`

**Query**：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `current` | int | 1 | 页码（≥1） |
| `size` | int | 10 | 每页（1-100） |

**响应**：`PageResponse<DocumentOut>`
```json
{
  "records": [ /* DocumentOut[] */ ],
  "total": 42,
  "current": 1,
  "size": 10
}
```

### 3.5 按状态查询 `GET /api/document/list-by-status`

**Query**：`status` (string，见枚举)

**响应**：`DocumentOut[]`

### 3.6 检索 `GET /api/document/search`

混合检索知识库。

**Query**：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `q` | string | 必填 | 检索关键词或问句 |
| `top_k` | int | 10 | 返回数量（1-50） |
| `mode` | string | `hybrid` | `keyword` / `vector` / `hybrid` |

**响应**：`SearchResultOut[]`
```json
[
  {
    "segment_id": 12,
    "text": "分块文本内容...",
    "score": 0.0328,
    "source": "hybrid",
    "metadata": {
      "fileName": "产品手册",
      "docId": 1,
      "chunkId": "abc123",
      "url": "https://oss.../产品手册.pdf"
    }
  }
]
```

> `source` 取值：`keyword` / `vector` / `hybrid`；`score` 含义随模式不同（hybrid 为 RRF 分数，越小越相关）。

### 3.7 查询单个文档 `GET /api/document/{doc_id}`

**响应**：`DocumentOut`，不存在返回 404。

### 3.8 删除文档 `DELETE /api/document/{doc_id}`

级联删除分块 + 向量。**响应**：`true` / `false`

### 3.9 角色列表 `GET /api/document/roles`

列出 Casdoor 可选角色，供上传文档时绑定可见角色（`accessible_by` 字段）。需带 Casdoor token 认证。

**响应**：
```json
[
  { "name": "normal_user", "displayName": "普通用户" },
  { "name": "admin", "displayName": "管理员" }
]
```

> 上传时 `accessible_by` 传角色 `name` 的逗号分隔列表（如 `"admin,normal_user"`），空=公开。检索/文档查询按当前用户角色（from Casdoor token）与 `accessible_by` 求交集过滤。

---

## 4. 分块管理

前缀：`/api/segment`

### 4.1 分页 `GET /api/segment/page`

**Query**：`current` (int, 默认1)、`size` (int, 默认10)

**响应**：`PageResponse<SegmentOut>`

### 4.2 按文档查询 `GET /api/segment/list-by-document`

**Query**：`document_id` (int)

**响应**：`SegmentOut[]`（按 `chunk_order` 排序）

### 4.3 按状态查询 `GET /api/segment/list-by-status`

**Query**：`status` (string，`STORED` / `VECTOR_STORED`)

**响应**：`SegmentOut[]`

### 4.4 查询单个分块 `GET /api/segment/{seg_id}`

**响应**：`SegmentOut`，不存在返回 404。

```json
{
  "id": 12,
  "text": "分块文本内容...",
  "chunk_id": "abc123",
  "metadata": { "fileName": "产品手册", "docId": 1 },
  "document_id": 1,
  "chunk_order": 0,
  "embedding_id": "doc-1-segment-12",
  "status": "VECTOR_STORED",
  "skip_embedding": 0,
  "created_at": "2026-07-07T14:00:00",
  "updated_at": "2026-07-07T14:00:00"
}
```

### 4.5 删除分块 `DELETE /api/segment/{seg_id}`

**响应**：`true` / `false`

---

## 5. Agent 对话

### 5.1 列出可用 Agent `GET /list-apps`

**响应**：`["common_agent"]`

### 5.2 流式对话（SSE）`POST /run_sse`

发送消息并流式返回 AI 回复。**这是前端聊天主接口。**

**请求体**：`AgentRunRequest`
```json
{
  "appName": "common_agent",
  "userId": "alice",
  "threadId": "thread-uuid-001",
  "newMessage": { "content": "知识库里第一段讲了什么？", "role": "user" },
  "streaming": true,
  "stateDelta": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `appName` | string | 是 | 固定 `common_agent` |
| `userId` | string | 否 | 用户标识 |
| `threadId` | string | 是 | 会话 ID（首次可前端生成 UUID，同一会话复用） |
| `newMessage.content` | string | 是 | 用户消息 |
| `newMessage.role` | string | 否 | 默认 `user` |
| `streaming` | bool | 否 | 是否流式（接口始终返回 SSE） |

**响应**：SSE 流（`text/event-stream`），事件格式见 [7. SSE 事件格式](#7-sse-事件格式)。

| event | data | 说明 |
|---|---|---|
| `message` | AI 文本片段（字符串） | 逐 token 推送，前端拼接渲染打字效果 |
| `tool` | 工具返回内容（字符串） | 工具调用结果 |
| `done` | `[DONE]` | 流结束 |

**前端示例（EventSource 不可用 POST，需用 fetch + ReadableStream）**：
```js
const resp = await fetch("/run_sse", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ appName: "common_agent", threadId, newMessage: { content } })
});
const reader = resp.body.getReader();
const decoder = new TextDecoder();
let aiText = "";
// 按 "event: xxx\ndata: yyy\n\n" 分帧解析
```

### 5.3 单轮问答 `GET /chat/ask`

非流式，独立 thread（不持久化历史）。

**Query**：`question` (string)

**响应**：`string`（AI 回复全文）

### 5.4 恢复中断 `POST /resume_sse`

> ⚠️ **未实现**（返回 501）。HITL 工具审批待完善。

---

## 6. Thread 会话管理

前缀：`/apps/{appName}/users/{userId}/threads`

> 路径中 `appName` / `userId` 为占位符（服务端未强校验），实际会话以 `threadId` 标识。会话历史存储于 langgraph checkpoint（PostgreSQL）。

### 6.1 列出会话 `GET /apps/{appName}/users/{userId}/threads`

**响应**：`ThreadOut[]`
```json
[ { "thread_id": "thread-uuid-001", "values": { "messages": [...] } } ]
```

### 6.2 创建会话 `POST /apps/{appName}/users/{userId}/threads`

**响应**：`{ "thread_id": "新生成的 UUID" }`

### 6.3 创建指定 ID 会话 `POST /apps/{appName}/users/{userId}/threads/{threadId}`

用前端指定的 `threadId` 创建。**响应**：`{ "thread_id": "threadId" }`

### 6.4 查询会话 `GET /apps/{appName}/users/{userId}/threads/{threadId}`

**响应**：`ThreadOut`，不存在返回 404。

### 6.5 删除会话 `DELETE /apps/{appName}/users/{userId}/threads/{threadId}`

**响应**：`{ "deleted": "threadId" }` 或 `{ "deleted": null }`

---

## 7. PPT 生成 Graph

### 7.1 列出可用 Graph `GET /list-graphs`

**响应**：
```json
[
  {"name": "ppt_build", "title": "PPT 生成", "description": "根据需求生成 PPT"}
]
```

| 字段 | 说明 |
|---|---|
| `name` | graph 标识，传给 `graph_run_sse` / `graph_resume_sse` 的 `graphName` |
| `title` | 前端展示名 |
| `description` | graph 说明 |

### 7.2 启动 PPT 生成（SSE）`POST /graph_run_sse`

提交 PPT 生成需求，流式返回各节点执行进度。若需求不完整会触发 `interrupt` 等待补充。

**请求体**：`GraphRunRequest`
```json
{
  "graphName": "ppt_build",
  "userId": "alice",
  "threadId": "thread-uuid-002",
  "newMessage": { "content": "帮我做一份关于 AI 发展的 PPT", "role": "user" },
  "inputs": null
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `graphName` | string | 是 | 已注册 graph 的 `name`（当前 `ppt_build`），不存在返回 404 |
| `threadId` | string | 是 | 会话 ID |
| `newMessage.content` | string | 否 | PPT 需求描述（`inputs` 为空时用） |
| `inputs` | object | 否 | 直接传入 graph 输入（优先于 newMessage） |

**响应**：SSE 流，事件：

| event | data（JSON 字符串） | 说明 |
|---|---|---|
| `update` | `{ "node": "requirement", "values": { ... } }` | 节点执行完成，`values` 为 state 子集 |
| `interrupt` | `{ "next": ["clarification"], "clarification": "请补充...", "clarification_options": [...] }` | 需求不完整，等待用户补充；`clarification_options` 为结构化建议选项 |
| `done` | `{ "result": "https://oss.../output.pptx" }` | 生成完成，返回结果地址 |

`values` 可能包含的字段：`requirement` / `info_complete` / `next_node` / `clarification` / `clarification_options` / `search_info` / `template_code` / `template_info` / `ppt_outline` / `ppt_schema` / `ppt_result`

### 7.3 恢复 PPT 生成（SSE）`POST /graph_resume_sse`

用户补充澄清信息后，从 `interrupt` 处继续执行。

**请求体**：`GraphResumeRequest`
```json
{
  "graphName": "ppt_build",
  "threadId": "thread-uuid-002",
  "clarificationResponse": "面向技术团队，约 10 页"
}
```

**响应**：SSE 流，事件同 7.2（`update` / `interrupt` / `done`）。

### 7.4 查询 Graph 流程拓扑 `GET /graph_topology/{name}`

返回指定 graph 的流程节点列表与 mermaid 流程图，供前端渲染流程可视化。`name` 不存在返回 404。

**响应**：
```json
{
  "nodes": [
    {"id": "requirement", "name": "requirement"},
    {"id": "clarification", "name": "clarification"},
    {"id": "search", "name": "search"},
    {"id": "template_select", "name": "template_select"},
    {"id": "template_info", "name": "template_info"},
    {"id": "outline", "name": "outline"},
    {"id": "schema", "name": "schema"},
    {"id": "render", "name": "render"}
  ],
  "mermaid": "graph TD; ..."
}
```

| 字段 | 说明 |
|---|---|
| `nodes` | 业务节点列表（已过滤 `__start__`/`__end__` 虚拟节点），每项含 `id` 与 `name` |
| `mermaid` | 可直接渲染的 mermaid 流程图字符串 |

---

## 8. SSE 事件格式总览

所有 SSE 接口返回 `text/event-stream`，每帧格式：
```
event: <事件类型>
data: <数据>

```
（`data` 后有空行分隔；`data` 内容对 agent 是纯文本，对 graph 是 JSON 字符串）

### 8.1 `/run_sse`（Agent 对话）
```
event: message
data: 根据知识库

event: message
data: 第一段讲了

event: tool
data: 共检索到 3 条相关知识：...

event: message
data: 第一段内容是...

event: done
data: [DONE]
```

### 8.2 `/graph_run_sse` 与 `/graph_resume_sse`（PPT 生成）
```
event: update
data: {"node":"requirement","values":{"requirement":"...","info_complete":true}}

event: update
data: {"node":"search","values":{"search_info":"..."}}

event: update
data: {"node":"render","values":{"ppt_result":"https://oss.../output.pptx"}}

event: done
data: {"ppt_result":"https://oss.../output.pptx"}
```

需求不完整时：
```
event: update
data: {"node":"requirement","values":{"info_complete":false,"clarification":"请说明受众和页数"}}

event: interrupt
data: {"next":["clarification"],"clarification":"请说明受众和页数"}
```

---

## 9. 典型业务流程

### 9.1 文档入库全流程
```
1. POST /api/document/upload          → status=CONVERTED, 返回 doc_id
2. POST /api/document/split/{doc_id}  → 返回分块数, status=CHUNKED
3. POST /api/document/embedding/{id}  → "success", status=VECTOR_STORED
4. GET  /api/document/search?q=...    → 检索验证
```

### 9.2 Agent 多轮对话
```
1. 前端生成 threadId（UUID）
2. POST /run_sse { threadId, newMessage: {content:"问题1"} }  → SSE 流式回复
3. POST /run_sse { threadId, newMessage: {content:"追问"} }   → 同一 threadId，历史自动延续
4. GET  /apps/{app}/users/{user}/threads                     → 会话列表
5. DELETE /apps/{app}/users/{user}/threads/{threadId}        → 清除会话
```

### 9.3 PPT 生成（含人机交互）
```
1. 前端生成 threadId
2. POST /graph_run_sse { threadId, newMessage:{content:"做一份AI的PPT"} }
   → 收到 event:interrupt（需求不完整）
3. POST /graph_resume_sse { threadId, clarificationResponse:"技术团队,10页" }
   → event:update × N → event:done（返回 pptx URL）
```

---

## 10. 类型定义速查

### `DocumentOut`
| 字段 | 类型 | 说明 |
|---|---|---|
| `doc_id` | int | 文档 ID |
| `doc_title` | string | 标题 |
| `upload_user` | string? | 上传人 |
| `doc_url` | string? | 原始文件 URL |
| `converted_doc_url` | string? | 解析后 markdown URL |
| `status` | string | 文档状态（见枚举） |
| `accessible_by` | string? | 可访问范围 |
| `description` | string? | 描述 |
| `knowledge_base_type` | string? | 知识库类型 |
| `extension` | object? | 扩展字段 |
| `created_at` / `updated_at` | datetime? | 时间戳 |

### `SegmentOut`
| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | int | 分块 ID |
| `text` | string | 分块文本 |
| `chunk_id` | string? | 分块唯一标识 |
| `metadata` | object? | 元数据（fileName/docId/url 等） |
| `document_id` | int | 所属文档 ID |
| `chunk_order` | int | 块序号 |
| `embedding_id` | string? | 向量库 ID |
| `status` | string? | 分块状态 |
| `skip_embedding` | int? | 是否跳过向量化（0/1） |

### `SearchResultOut`
| 字段 | 类型 | 说明 |
|---|---|---|
| `segment_id` | int? | 分块 ID |
| `text` | string | 文本 |
| `score` | float | 相关度分数 |
| `source` | string | `keyword` / `vector` / `hybrid` |
| `metadata` | object | 元数据 |

### `PageResponse<T>`
| 字段 | 类型 | 说明 |
|---|---|---|
| `records` | T[] | 当前页数据 |
| `total` | int | 总数 |
| `current` | int | 当前页码 |
| `size` | int | 每页大小 |
