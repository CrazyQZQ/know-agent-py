# agent-chat-ui 后端 API 文档

agent-chat-ui 是 LangGraph 官方前端,后端需要实现 **LangGraph Server API**(即 LangGraph Protocol)。标准的实现方式是部署一个 LangGraph Server(`langgraph dev` / `langgraph up` / LangGraph Cloud),它会自动提供以下所有端点。

---

## 1. 连接架构

| 模式 | 前端请求路径 | 转发目标 | 环境变量 |
|---|---|---|---|
| **开发** | 直接访问 `NEXT_PUBLIC_API_URL`(默认 `http://localhost:2024`) | LangGraph Server | `NEXT_PUBLIC_API_URL` |
| **生产** | `/api/*`(Next.js 路由) | `LANGGRAPH_API_URL` | `LANGGRAPH_API_URL`、`LANGSMITH_API_KEY` |

生产模式下,`src/app/api/[..._path]/route.ts` 使用 `langgraph-nextjs-api-passthrough` 把所有 `/api/*` 请求透传到后端,浏览器侧只暴露 `NEXT_PUBLIC_API_URL`(指向网站自身 `/api`)。

---

## 2. 认证

所有请求通过 HTTP Header 认证:

| Header | 说明 | 必填 |
|---|---|---|
| `x-api-key`(不区分大小写) | LangSmith API Key,本地开发可不填,部署必填 | 视部署 |
| `X-Auth-Scheme` | Agent Builder 部署时设为 `langsmith-api-key` | 否 |

前端 `checkGraphStatus()` 用 `X-Api-Key`,SDK Client 内部统一用 `x-api-key`,两者等价。API Key 存储在浏览器 `localStorage`(`lg:chat:apiKey`)。

---

## 3. 核心端点(前端实际调用,必须实现)

### 3.1 健康检查 — `GET /info`

前端 `Stream.tsx:checkGraphStatus()` 在连接时调用,返回非 2xx 则弹出"Failed to connect to LangGraph server"。

**响应**:`200 OK`,Body 为 graph 元信息(JSON),前端只检查 `res.ok`。

---

### 3.2 线程 Threads

#### `POST /threads` — 创建线程
`useStream` 在首次发送消息且无 `threadId` 时调用(`client.threads.create()`)。

**请求 Body**:
```json
{
  "thread_id": "可选,自定义 ID",
  "metadata": { "graph_id": "agent" }
}
```
**响应**:`{ "thread_id": "uuid", "created_at": "...", "updated_at": "...", "metadata": {...}, "status": "idle" }`

#### `POST /threads/search` — 搜索线程
`Thread.tsx` 加载左侧线程列表时调用,按 `graph_id` 或 `assistant_id` 过滤。

**请求 Body**:
```json
{
  "metadata": { "graph_id": "agent" },
  "limit": 100
}
```
> 当 `assistantId` 是 UUID 时用 `assistant_id`,否则用 `graph_id`(见 `getThreadSearchMetadata`)。

**响应**:`Thread[]`,按 `updated_at` 倒序。

#### `GET /threads/{thread_id}/state` — 获取当前状态
`useStream`(开启 `fetchStateHistory`)加载会话时调用。

**响应**:
```json
{
  "values": { "messages": [...], "ui": [...] },
  "next": ["node_name"],
  "tasks": [...],
  "metadata": {...},
  "created_at": "...",
  "parent_config": { "checkpoint_id": "..." }
}
```

#### `POST /threads/{thread_id}/history` — 获取状态历史
`useStream` 开启 `fetchStateHistory: true` 时调用,用于支持"分支/回放/重新生成"。

**请求 Body**:
```json
{ "limit": 20 }
```
**响应**:检查点数组,每个含 `checkpoint`、`values`、`next`、`metadata` 等。

#### `GET /threads/{thread_id}/stream` — 加入线程流(SSE)
`client.threads.joinStream()`,用于重连已存在的流。支持 `Last-Event-ID` 头断点续传。

**查询参数**:`stream_mode`

---

### 3.3 运行 Runs

#### `POST /threads/{thread_id}/runs/stream` — 创建运行并流式返回(★核心)
这是最关键的端点。所有用户交互都走这里:发消息、恢复中断、跳转节点。

**请求 Body**:
```json
{
  "assistant_id": "agent",
  "input": { "messages": [...], "context": {...} },
  "command": { "resume": {...} } | { "goto": "node_name" } | null,
  "config": { "configurable": {...} },
  "context": {...},
  "metadata": {...},
  "stream_mode": ["values"],
  "stream_subgraphs": true,
  "stream_resumable": true,
  "interrupt_before": ["node"],
  "interrupt_after": ["node"],
  "multitask_strategy": "interrupt",
  "checkpoint": { "checkpoint_id": "..." }
}
```

**响应**:SSE 流(`text/event-stream`),按 `stream_mode` 推送事件。`values` 模式下每个事件携带完整 state 快照;`messages` 模式推送 token 增量;`updates` 模式推送节点更新。

前端的三种调用场景(`thread/index.tsx`、`use-interrupted-actions.tsx`):
| 场景 | `input` | `command` |
|---|---|---|
| 发送新消息 | `{ messages: [...], context }` | 无 |
| 恢复中断(HITL) | `{}` | `{ "resume": { "decisions": [...] } }` |
| 标记完成 | `{}` | `{ "goto": "__end__" }` |
| 重新生成 | 不传 | 不传,但带 `checkpoint` |

> 无 `threadId` 时端点为 `POST /runs/stream`(stateless 运行),本前端不使用。

#### `POST /threads/{thread_id}/runs/{run_id}/cancel` — 取消运行
点击停止按钮时调用(`stream.stop()` → `client.runs.cancel()`)。

**请求 Body**:
```json
{ "wait": false, "action": "interrupt" }
```
**响应**:`{ "ok": true }` 或 404(运行已结束)。

#### `GET /threads/{thread_id}/runs/{run_id}/stream` — 加入运行流(SSE)
`client.runs.joinStream()`,断线重连用。支持 `Last-Event-ID` 头。

**查询参数**:`stream_mode`、`cancel_on_disconnect`

---

## 4. 可选端点(SDK 支持,本前端未直接调用)

标准 LangGraph Server 会提供,前端代码未直接使用,但部署时建议保留:

### Assistants
| 方法 | 路径 |
|---|---|
| GET | `/assistants/{assistant_id}` |
| GET | `/assistants/{assistant_id}/graph` |
| GET | `/assistants/{assistant_id}/schemas` |
| GET | `/assistants/{assistant_id}/subgraphs` |
| POST | `/assistants/search` |
| POST | `/assistants` |
| PATCH | `/assistants/{assistant_id}` |
| DELETE | `/assistants/{assistant_id}` |

### Threads(扩展)
| 方法 | 路径 |
|---|---|
| GET | `/threads/{thread_id}` |
| PATCH | `/threads/{thread_id}` |
| DELETE | `/threads/{thread_id}` |
| POST | `/threads/{thread_id}/copy` |
| POST | `/threads/prune` |
| POST | `/threads/count` |
| POST | `/threads/{thread_id}/state` (更新状态) |
| PATCH | `/threads/{thread_id}/state` |

### Runs(扩展)
| 方法 | 路径 |
|---|---|
| POST | `/threads/{thread_id}/runs` (创建非流式) |
| POST | `/runs/batch` |
| POST | `/threads/{thread_id}/runs/wait` |
| GET | `/threads/{thread_id}/runs` |
| GET | `/threads/{thread_id}/runs/{run_id}` |
| DELETE | `/threads/{thread_id}/runs/{run_id}` |
| GET | `/threads/{thread_id}/runs/{run_id}/join` |

### Store(长期记忆)
| 方法 | 路径 |
|---|---|
| PUT | `/store/items` |
| POST | `/store/items`(GET 语义) |
| DELETE | `/store/items` |
| POST | `/store/items/search` |
| POST | `/store/namespaces` |

### Crons(定时任务)
| 方法 | 路径 |
|---|---|
| POST | `/threads/{thread_id}/runs/crons` |
| POST | `/runs/crons` |
| PATCH | `/runs/crons/{cron_id}` |
| DELETE | `/runs/crons/{cron_id}` |
| POST | `/runs/crons/search` |
| POST | `/runs/crons/count` |

### UI 组件
| 方法 | 路径 |
|---|---|
| POST | `/ui/{assistant_id}` — 获取自定义 UI 组件(HTML) |

---

## 5. SSE 流事件格式

`runs/stream` 与 `*/stream` 端点返回 Server-Sent Events,每条事件形如:

```
event: values
data: { "messages": [...], "ui": [...] }

event: metadata
data: { "run_id": "..." }
```

前端 `useStream` 关注的事件类型:
- `values` — 完整 state 快照(本前端默认模式)
- `messages` — 消息 token 增量(流式打字效果)
- `updates` — 节点状态更新
- `messages/custom` — 自定义 UI 事件(用于 agent-inbox)
- `error` — 错误
- `metadata` — run 元信息(含 `run_id`,用于后续 cancel)

---

## 6. 最小后端实现建议

如果你不部署标准 LangGraph Server 而是自实现,至少需要这 7 个端点:

| # | 端点 | 用途 |
|---|---|---|
| 1 | `GET /info` | 健康检查 |
| 2 | `POST /threads` | 创建会话 |
| 3 | `POST /threads/search` | 会话列表 |
| 4 | `GET /threads/{id}/state` | 恢复会话状态 |
| 5 | `POST /threads/{id}/history` | 历史记录/重新生成 |
| 6 | `POST /threads/{id}/runs/stream` | **核心**:发消息/恢复/跳转(SSE) |
| 7 | `POST /threads/{id}/runs/{run_id}/cancel` | 停止生成 |

**推荐做法**:直接用 `langgraph dev` 启动标准 LangGraph Server,无需自实现。后端工作重心放在 **graph 定义**(state schema、nodes、edges、interrupts),而非 HTTP 层。
