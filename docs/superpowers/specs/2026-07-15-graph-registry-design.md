# Graph 注册机制设计

> 日期：2026-07-15
> 主题：拆掉路由层对 `ppt_graph` 的硬编码，引入 graph 注册表，为后续扩展新 graph 留干净口子。

## 背景与目标

当前 PPT 生成 graph 是系统唯一的 langgraph workflow，且被写死在路由层。`GraphRunRequest.graphName` 字段形同虚设，`list_graphs` 返回写死列表，`_stream` 透传的 state keys 和 interrupt 字段全是 ppt 专属。加第二个 graph 时必须改路由代码，扩展性差。

**目标**（B 路线）：暂不新增 graph，但把 ppt 硬编码拆成一个声明式注册机制，路由层通用化，使未来加新 graph 时只需在 `graphs/xxx/` 下自登记、不动路由。不引入插件式扫描（entry_points）等过重机制。

## 现状问题（两层硬编码）

1. **路由层选 graph**：`routers/graph.py` 直接 `from know_agent.graphs.ppt.graph import get_ppt_graph`，`graph_run_sse` / `graph_resume_sse` 调 `get_ppt_graph()`，忽略 `req.graphName`；`list_graphs` 返回 `[GRAPH_NAME]`。
2. **流式层透传 state**：`_stream` 里 `_STATE_KEYS`（含 `ppt_outline`/`ppt_schema`/`ppt_result`）、interrupt 透传的 `clarification`/`clarification_options`、done 事件的 `ppt_result`、resume 的 `clarification_response` 字段名与 `_compose_answers`，全是 ppt 特化逻辑。

第二层比第一层更隐蔽，是设计重点。

## 设计决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 扩展节奏 | B：拆硬编码留口子，暂不加新 graph | YAGNI，不做插件式 |
| `_stream` 泛化策略 | A：声明式 metadata（state_keys + interrupt_payload） | 不同 graph 输出契约不同，声明式让契约显式、`_stream` 通用 |
| 注册机制 | 装饰器/登记函数 + `pkgutil` 目录扫描 | 本仓库内 graph 开发期重启即生效，不用手动维护注册表 |
| `list_graphs` 粒度 | 返回 `[{name, title, description}]` | 前端契约自描述，不硬编码展示名 |
| 流程拓扑 | 从 compiled graph 派生，独立接口返回 | mermaid 较大按需加载，list_graphs 保持轻量 |

## §1 架构与注册层

### `graphs/registry.py`（新增）

```python
@dataclass
class GraphRegistration:
    name: str                                    # 路由分发 key，如 "ppt_build"
    title: str                                   # 前端展示名，如 "PPT 生成"
    description: str
    factory: Callable[[], CompiledGraph]         # 纯构建函数，无 cache
    state_keys: list[str]                        # 透传给前端的 state 子集
    interrupt_payload: Callable[[dict], dict]    # 构造 interrupt 事件 data
    compose_resume_response: Callable[[GraphResumeRequest], str]  # 请求->写入文本
    resume_state_key: str | None                 # 写进哪个 state 字段；None=只写 messages
    result_key: str                              # done 事件取值用的 state 字段，如 "ppt_result"
```

- **单例统一到 registry**：`_INSTANCES: dict[str, CompiledGraph]` 缓存编译实例，`get_compiled_graph(name)` 首次调 `factory()` 并缓存。`get_ppt_graph` 的 `@lru_cache` 去掉，退化为纯构建函数 `build_ppt_graph`。
- **查找失败**：`get_graph(name)` 找不到抛 `GraphNotFoundError`，路由层捕获转 HTTP 404。
- **topology 派生**：`get_graph_topology(name)` 复用编译缓存，从 `compiled.get_graph()` 提取节点与 mermaid（见 §4）。

公开 API：`register_graph(reg)`、`get_graph(name) -> GraphRegistration`、`get_compiled_graph(name) -> CompiledGraph`、`list_graphs() -> list[GraphRegistration]`、`get_graph_topology(name) -> dict`。

### `graphs/__init__.py`（当前为空，改为扫描入口）

```python
from . import registry                      # 先就绪 registry，避免子模块 import 时循环
import pkgutil, importlib
for _, modname, _ in pkgutil.walk_packages(__path__, prefix=__name__ + "."):
    importlib.import_module(modname)        # 触发各 graph 模块顶层的 register_graph(...)
```

循环 import 分析：`registry.py` 不 import `graphs.__init__`；`__init__` 先 import registry 再扫描子包；ppt 模块 import 时 `graphs.registry` 已可用，无环。

### `graphs/ppt/graph.py` 自登记

模块顶层调 `register_graph(GraphRegistration(...))`，各字段取值：

- `name="ppt_build"`，`title="PPT 生成"`，`description="根据需求生成 PPT"`
- `factory=build_ppt_graph`（去 `@lru_cache`）
- `state_keys`：搬当前 `_STATE_KEYS`：`["requirement","info_complete","next_node","clarification","clarification_options","search_info","template_code","template_info","ppt_outline","ppt_schema","ppt_result"]`
- `interrupt_payload=lambda v: {"clarification": v.get("clarification",""), "clarification_options": v.get("clarification_options",[])}`
- `compose_resume_response=_compose_resume_response`（answers 优先、回退 `clarificationResponse`、都空抛 `ValueError`）
- `resume_state_key="clarification_response"`
- `result_key="ppt_result"`

`_compose_answers` 从 `routers/graph.py` 搬入 `graphs/ppt/graph.py`，由 `_compose_resume_response` 包装。`build_ppt_graph` 里现有两行 `graph = workflow_compile.get_graph(); graph.draw_mermaid()`（调了但丢弃返回值）删除，mermaid 改由 registry 派生。

## §2 路由层与 `_stream` 通用化

### `routers/graph.py` 改造

- 去掉所有 ppt import，只依赖 `registry`。
- **`list_graphs`**：`return [{"name": r.name, "title": r.title, "description": r.description} for r in registry.list_graphs()]`
- **`graph_run_sse` / `graph_resume_sse`**：开头 `reg = registry.get_graph(req.graphName)`，捕获 `GraphNotFoundError` 转 HTTP 404；`graph = registry.get_compiled_graph(reg.name)`。
- **移除**：模块级 `_STATE_KEYS`、`_extract_state`、`_compose_answers`。
- **新增**：`GET /graph_topology/{name}` -> `registry.get_graph_topology(name)`（见 §4）。

### `_stream` 通用化（签名加 `reg`）

```python
def _stream(reg, inputs, config, last_event_id=None):
    graph = registry.get_compiled_graph(reg.name)
    ...
    for output in graph.stream(inputs, config, stream_mode="updates"):
        for node, update in output.items():
            values = {k: update[k] for k in reg.state_keys if k in update}   # 替代 _extract_state
            event = {"event": "update",
                     "data": json.dumps({"node": node, "values": values}, ensure_ascii=False)}
            ...
    state = graph.get_state(config)
    if state.next:
        payload = {"next": state.next, **reg.interrupt_payload(state.values)}  # next 通用 + payload 声明式
        event = {"event": "interrupt", "data": json.dumps(payload, ensure_ascii=False)}
    else:
        result = state.values.get(reg.result_key, "")
        graph.update_state(config, {"messages": [AIMessage(content=result or "工作流已完成")]})
        event = {"event": "done", "data": json.dumps({"result": result}, ensure_ascii=False)}
    ...
```

### resume 通用化

```python
resp = reg.compose_resume_response(req)        # ppt: answers->文本 or 回退 clarificationResponse
update = {"messages": [HumanMessage(content=resp)]}
if reg.resume_state_key:
    update[reg.resume_state_key] = resp        # ppt: "clarification_response"
graph.update_state(config, update)
```

## §3 前端契约、错误处理、测试

### 前端契约变更

| 接口/事件 | 变更前 | 变更后 | 破坏性 |
|---|---|---|---|
| `GET /list-graphs` | `["ppt_build"]` | `[{"name","title","description"}]` | ✅ 结构变 |
| `update` 事件 | `{node, values}` | 不变 | - |
| `interrupt` 事件 | `{next, clarification, clarification_options}` | 不变 | - |
| `done` 事件 | `{"ppt_result": ...}` | `{"result": ...}` | ✅ 字段名变 |
| `graph_run_sse` / `graph_resume_sse` | `graphName` 被忽略 | `graphName` 必须命中已注册 graph，否则 404 | ✅ 行为变 |
| resume 请求体 | `answers` + `clarificationResponse` | 不变 | - |

详细前端改动见 `2026-07-15-graph-registry-frontend-changes.md`。

### 错误处理

- 未知 `graphName` -> `GraphNotFoundError` -> HTTP 404 `{"detail": "graph '{name}' not found"}`
- resume 空 resp（answers 与 clarificationResponse 都空）-> 400，逻辑在 ppt 的 `compose_resume_response` 内抛 `ValueError`，路由捕获转 400
- graph 内部异常维持现状（stream 抛错、SSE 断开）

### 测试（项目当前无测试，加最小单测，不强制端到端）

- `tests/test_registry.py`：注册 / 查找 / `list_graphs` / 未知 name 抛 `GraphNotFoundError`
- `tests/test_scan.py`：`import know_agent.graphs` 后 `list_graphs()` 含 `ppt_build`，验证自登记扫描生效

## §4 流程拓扑

节点信息（id+名称）与 mermaid 都从 compiled graph 派生，不进 `GraphRegistration` 声明字段，由 registry 统一提取。

```python
def get_graph_topology(name: str) -> dict:
    compiled = get_compiled_graph(name)          # 复用单例缓存
    g = compiled.get_graph()
    nodes = [
        {"id": n.id, "name": n.name}
        for n in g.nodes.values()
        if n.id not in ("__start__", "__end__")  # 过滤 langgraph 虚拟起止节点
    ]
    return {"nodes": nodes, "mermaid": g.draw_mermaid()}
```

**接口**：`GET /graph_topology/{name}` -> `{nodes: [{id,name}], mermaid: "..."}`。

`list_graphs` 保持轻量（name/title/description），前端进入 graph 工作区时按需拉拓扑。

**interrupt 节点标注**：当前不返回。如后续要在流程图标出"会暂停"节点，再加 `interrupt_nodes: list[str]`（从 compile 时的 `interrupt_before` 提取），成本很低。先 YAGNI。

## 改动文件清单

| 文件 | 动作 |
|---|---|
| `src/know_agent/graphs/registry.py` | 新增：`GraphRegistration`、`register_graph`、`get_graph`、`get_compiled_graph`、`list_graphs`、`get_graph_topology`、`GraphNotFoundError` |
| `src/know_agent/graphs/__init__.py` | 改：扫描入口（当前为空） |
| `src/know_agent/graphs/ppt/graph.py` | 改：去 `@lru_cache`、顶层 `register_graph(...)`、`_compose_answers` 搬入、`_compose_resume_response`、删除废弃的 `draw_mermaid` 两行 |
| `src/know_agent/routers/graph.py` | 改：通用化，去 ppt import 与 `_STATE_KEYS`/`_extract_state`/`_compose_answers`，新增 `GET /graph_topology/{name}` |
| `src/know_agent/schemas/graph.py` | 不变（`graphName` 已存在，现在真正被用） |
| `docs/api.md` | 更新 `list-graphs`、`done` 事件、新增 `graph_topology` 契约 |
| `tests/test_registry.py`、`tests/test_scan.py` | 新增 |

## 非目标（YAGNI）

- 不做 entry_points 插件式扫描（第三方包注册）。
- 不新增第二个 graph（仅留口子）。
- 不返回 interrupt 节点标注（后续按需）。
- 不泛化 resume 请求体结构（`answers` + `clarificationResponse` 维持 ppt 澄清契约，未来 graph 有不同 resume 语义再扩展）。
