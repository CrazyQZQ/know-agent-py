# Graph 注册机制改造 - 前端改动清单

> 日期：2026-07-15
> 配套设计：`2026-07-15-graph-registry-design.md`
> 后端改造完成后，前端需同步修改以下点。本文件独立列出，供前端单独修改时对照。

## 1. `GET /list-graphs` 响应结构变更 ✅破坏性

**变更前**：
```json
["ppt_build"]
```

**变更后**：
```json
[
  {
    "name": "ppt_build",
    "title": "PPT 生成",
    "description": "根据需求生成 PPT"
  }
]
```

**前端改动**：
- 解析逻辑从"字符串数组"改为"对象数组"。
- 用 `name` 作为 graph 标识（传给 `graph_run_sse` / `graph_resume_sse` 的 `graphName`）。
- 用 `title` 渲染展示名（不再前端硬编码 `"PPT 生成"`）。
- 用 `description` 渲染副标题/说明（可选）。

## 2. `done` 事件 data 字段名变更 ✅破坏性

**变更前**：
```json
{"event": "done", "data": "{\"ppt_result\": \"https://...\"}"}
```

**变更后**：
```json
{"event": "done", "data": "{\"result\": \"https://...\"}"}
```

**前端改动**：SSE `done` 事件处理里，把读 `data.ppt_result` 改为读 `data.result`。

## 3. `graphName` 现在被校验 ✅行为变更

**变更前**：`graphName` 字段被路由忽略，传任意值都跑 ppt graph。

**变更后**：`graphName` 必须命中已注册 graph（当前仅 `"ppt_build"`），否则返回 HTTP 404：
```json
{"detail": "graph 'xxx' not found"}
```

**前端改动**：
- `POST /graph_run_sse` 和 `POST /graph_resume_sse` 请求体里 `graphName` 必须传 `"ppt_build"`（或从 `list_graphs` 拿到的 `name`）。
- 增加 404 错误处理（graph 不存在时的提示）。

## 4. 新增 `GET /graph_topology/{name}` 接口 🆕

**用途**：获取指定 graph 的流程节点列表与 mermaid 流程图，用于前端渲染流程可视化。

**请求**：
```
GET /v1/graph_topology/ppt_build
```

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

说明：
- `nodes`：业务节点列表，已过滤 langgraph 虚拟起止节点（`__start__`/`__end__`）。
- `mermaid`：可直接喂给 mermaid 渲染库的流程图字符串。
- 节点 `name` 当前等于 `id`（langgraph 默认），未来 graph 可自定义。

**前端改动**：
- 进入 graph 工作区时调用此接口拉取拓扑。
- 用 `mermaid` 字符串渲染流程图。
- 用 `nodes` 渲染节点列表/进度条（可结合 SSE `update` 事件的 `node` 字段高亮当前执行节点）。

## 5. 未变更项（确认不用改）

| 项 | 说明 |
|---|---|
| `update` 事件 | `{node, values}` 结构不变，`values` 字段不变 |
| `interrupt` 事件 | `{next, clarification, clarification_options}` 不变 |
| resume 请求体 | `{graphName, threadId, answers?, clarificationResponse?}` 不变 |
| `POST /graph_run_sse` 请求体 | `{graphName, threadId, newMessage?, inputs?}` 不变（但 graphName 现在被校验，见第 3 点） |

## 改动优先级建议

1. **必须改**（否则功能不可用）：第 1 点（list_graphs 解析）、第 3 点（graphName 传值）。
2. **必须改**（否则拿不到结果）：第 2 点（done 事件 result）。
3. **新增功能**（按需）：第 4 点（流程拓扑渲染）。
