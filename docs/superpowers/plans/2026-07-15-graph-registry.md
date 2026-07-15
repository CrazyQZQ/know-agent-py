# Graph 注册机制改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆掉路由层对 `ppt_graph` 的硬编码，引入声明式 graph 注册表 + 目录扫描，路由层通用化，使未来加新 graph 时只需在 `graphs/xxx/` 自登记、不动路由。

**Architecture:** 新增 `graphs/registry.py` 作为注册中心（`GraphRegistration` dataclass + 注册/查找/编译缓存/topology 派生）。`graphs/__init__.py` 用 `pkgutil.walk_packages` 扫描子包触发各 graph 模块顶层 `register_graph(...)` 自登记。`routers/graph.py` 只依赖 registry，按 `graphName` 分发，`_stream` 读注册项的声明式 metadata（state_keys / interrupt_payload / result_key / compose_resume_response）。ppt graph 自登记到 registry，去掉 `@lru_cache`（单例统一由 registry 缓存）。

**Tech Stack:** Python 3.12+、langgraph（StateGraph / CompiledStateGraph）、FastAPI、pydantic、pytest

## Global Constraints

- Python 3.12+，中文 docstring，loguru 日志，`from __future__` 非必需。
- PostgresSaver 是同步 checkpointer，graph 用同步 `stream()`（不用 astream/ainvoke）。
- 代码风格匹配现有文件：工厂函数 `@lru_cache` 单例模式（本次 registry 替代该模式）。
- 测试用 `uv run pytest`，项目当前无测试，本计划新增 `tests/` 目录。
- 路由层 SSE 用同步 generator + `EventSourceResponse`（保持现状）。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/know_agent/graphs/registry.py` | 注册中心：`GraphRegistration`、注册/查找/编译缓存/topology 派生、`GraphNotFoundError` | Create |
| `src/know_agent/graphs/__init__.py` | 扫描入口：import 时遍历子包触发自登记 | Modify（当前为空） |
| `src/know_agent/graphs/ppt/graph.py` | PPT graph 构建 + 自登记 + resume 文本组装 | Modify |
| `src/know_agent/routers/graph.py` | 通用化路由：按 graphName 分发、`_stream` 读 metadata、topology 接口 | Modify |
| `tests/test_registry.py` | registry 核心 + topology 单测 | Create |
| `tests/test_scan.py` | 扫描自登记集成测试 | Create |
| `docs/api.md` | 更新 list-graphs / done / interrupt 契约 + 新增 graph_topology | Modify |

`src/know_agent/schemas/graph.py` 不变（`graphName` / `answers` / `clarificationResponse` 字段已存在，本计划开始真正被路由使用）。

---

### Task 1: registry.py 核心注册/查找/编译缓存/topology

**Files:**
- Create: `src/know_agent/graphs/registry.py`
- Test: `tests/test_registry.py`

**Interfaces:**
- Consumes: `know_agent.schemas.graph.GraphResumeRequest`（仅用于 `compose_resume_response` 类型注解）
- Produces:
  - `GraphRegistration`（dataclass，9 字段：name/title/description/factory/state_keys/interrupt_payload/compose_resume_response/resume_state_key/result_key）
  - `GraphNotFoundError(KeyError)`
  - `register_graph(reg) -> GraphRegistration`
  - `list_graphs() -> list[GraphRegistration]`
  - `get_graph(name) -> GraphRegistration`（未注册抛 `GraphNotFoundError`）
  - `get_compiled_graph(name) -> CompiledGraph`（首次调 `factory()` 并缓存）
  - `get_graph_topology(name) -> {"nodes": [{"id","name"}], "mermaid": str}`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_registry.py`:

```python
"""registry 核心功能单测：注册/查找/编译缓存/topology 派生."""

import pytest

from know_agent.graphs.registry import (
    GraphNotFoundError,
    GraphRegistration,
    get_compiled_graph,
    get_graph,
    get_graph_topology,
    list_graphs,
    register_graph,
)


def _make_reg(name="test_graph", factory=None):
    return GraphRegistration(
        name=name,
        title="Test",
        description="test graph",
        factory=factory or (lambda: "fake_compiled"),
        state_keys=["a", "b"],
        interrupt_payload=lambda v: {"x": v.get("x", "")},
        compose_resume_response=lambda req: "resp",
        resume_state_key="resp_key",
        result_key="result",
    )


@pytest.fixture(autouse=True)
def _clean_registry():
    """每个测试后恢复 _REGISTRY / _INSTANCES，避免假 graph 污染其他测试文件."""
    from know_agent.graphs import registry
    saved_reg = dict(registry._REGISTRY)
    saved_inst = dict(registry._INSTANCES)
    yield
    registry._REGISTRY.clear()
    registry._REGISTRY.update(saved_reg)
    registry._INSTANCES.clear()
    registry._INSTANCES.update(saved_inst)


def test_register_and_get():
    reg = _make_reg(name="g1")
    register_graph(reg)
    assert get_graph("g1") is reg


def test_get_unknown_raises():
    with pytest.raises(GraphNotFoundError):
        get_graph("definitely_not_registered")


def test_list_graphs_contains_registered():
    register_graph(_make_reg(name="g2"))
    names = [r.name for r in list_graphs()]
    assert "g2" in names


def test_get_compiled_graph_caches():
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return object()

    register_graph(_make_reg(name="g3", factory=factory))
    first = get_compiled_graph("g3")
    second = get_compiled_graph("g3")
    assert first is second
    assert calls["n"] == 1


def test_get_compiled_graph_unknown_raises():
    with pytest.raises(GraphNotFoundError):
        get_compiled_graph("definitely_not_registered")


class _FakeNode:
    def __init__(self, node_id, name):
        self.id = node_id
        self.name = name


class _FakeGraph:
    nodes = {
        "__start__": _FakeNode("__start__", "start"),
        "requirement": _FakeNode("requirement", "requirement"),
        "__end__": _FakeNode("__end__", "end"),
    }

    def draw_mermaid(self):
        return "graph TD; requirement"


class _FakeCompiled:
    def get_graph(self):
        return _FakeGraph()


def test_get_graph_topology_filters_start_end():
    register_graph(_make_reg(name="g_topo", factory=lambda: _FakeCompiled()))
    topo = get_graph_topology("g_topo")
    assert [n["id"] for n in topo["nodes"]] == ["requirement"]
    assert topo["nodes"][0]["name"] == "requirement"
    assert topo["mermaid"] == "graph TD; requirement"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_registry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'know_agent.graphs.registry'`

- [ ] **Step 3: Write registry.py**

Create `src/know_agent/graphs/registry.py`:

```python
"""Graph 注册表 - 声明式注册 + 编译缓存 + topology 派生.

各 graph 模块在顶层调用 register_graph(...) 自登记；graphs/__init__.py
通过 pkgutil.walk_packages 扫描子包触发注册。路由层只依赖本模块，
不 import 任何具体 graph。
"""

from dataclasses import dataclass
from typing import Any, Callable

from know_agent.schemas.graph import GraphResumeRequest


class GraphNotFoundError(KeyError):
    """请求的 graph 未注册."""


@dataclass
class GraphRegistration:
    """单个 graph 的声明式注册项."""

    name: str                                                # 路由分发 key，如 "ppt_build"
    title: str                                               # 前端展示名，如 "PPT 生成"
    description: str
    factory: Callable[[], Any]                               # 纯构建函数，返回 compiled graph
    state_keys: list[str]                                    # 透传给前端的 state 子集
    interrupt_payload: Callable[[dict], dict]                # 构造 interrupt 事件 data
    compose_resume_response: Callable[[GraphResumeRequest], str]  # resume 请求 -> 写入文本
    resume_state_key: str | None                             # 写进哪个 state 字段；None=只写 messages
    result_key: str                                          # done 事件取值用的 state 字段


_REGISTRY: dict[str, GraphRegistration] = {}
_INSTANCES: dict[str, Any] = {}


def register_graph(reg: GraphRegistration) -> GraphRegistration:
    """登记一个 graph（通常在 graph 模块顶层调用）."""
    _REGISTRY[reg.name] = reg
    return reg


def list_graphs() -> list[GraphRegistration]:
    """返回所有已注册 graph."""
    return list(_REGISTRY.values())


def get_graph(name: str) -> GraphRegistration:
    """按 name 查找注册项，未注册抛 GraphNotFoundError."""
    if name not in _REGISTRY:
        raise GraphNotFoundError(name)
    return _REGISTRY[name]


def get_compiled_graph(name: str) -> Any:
    """获取 compiled graph（首次调用 factory 并缓存，保证单例）."""
    if name not in _INSTANCES:
        reg = get_graph(name)  # 未注册时抛 GraphNotFoundError
        _INSTANCES[name] = reg.factory()
    return _INSTANCES[name]


def get_graph_topology(name: str) -> dict:
    """从 compiled graph 派生节点列表与 mermaid 流程图.

    过滤 langgraph 虚拟起止节点 __start__ / __end__。
    """
    compiled = get_compiled_graph(name)
    g = compiled.get_graph()
    nodes = [
        {"id": n.id, "name": n.name}
        for n in g.nodes.values()
        if n.id not in ("__start__", "__end__")
    ]
    return {"nodes": nodes, "mermaid": g.draw_mermaid()}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_registry.py -v`
Expected: PASS（6 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add src/know_agent/graphs/registry.py tests/test_registry.py
git commit -m "feat(graphs): 新增 graph 注册表 registry（注册/查找/编译缓存/topology）"
```

---

### Task 2: PPT graph 自登记 + 扫描入口

**Files:**
- Modify: `src/know_agent/graphs/ppt/graph.py`
- Modify: `src/know_agent/graphs/__init__.py`（当前为空）
- Test: `tests/test_scan.py`

**Interfaces:**
- Consumes: Task 1 的 `register_graph` / `GraphRegistration`、`know_agent.schemas.graph.GraphResumeRequest` / `ResumeAnswer`
- Produces:
  - `build_ppt_graph() -> CompiledStateGraph`（纯构建函数，无 cache）
  - `get_ppt_graph() -> CompiledStateGraph`（兼容包装，去 `@lru_cache`；Task 3 改完路由后删除）
  - `GRAPH_NAME = "ppt_build"`
  - 模块顶层副作用：调用 `register_graph(...)` 自登记
  - `_compose_resume_response(req: GraphResumeRequest) -> str`（answers 优先、回退纯文本、都空抛 `ValueError`）

- [ ] **Step 1: Write the failing test**

Create `tests/test_scan.py`:

```python
"""验证 graphs 包扫描自动注册 ppt_build."""

def test_ppt_graph_auto_registered():
    import know_agent.graphs  # 触发 __init__.py 扫描
    from know_agent.graphs.registry import list_graphs

    names = [r.name for r in list_graphs()]
    assert "ppt_build" in names


def test_ppt_graph_has_title_and_description():
    import know_agent.graphs
    from know_agent.graphs.registry import get_graph

    reg = get_graph("ppt_build")
    assert reg.title == "PPT 生成"
    assert reg.description  # 非空
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_scan.py -v`
Expected: FAIL（`know_agent.graphs` 扫描未注册 ppt_build，或 `get_graph("ppt_build")` 抛 `GraphNotFoundError`）

- [ ] **Step 3: Modify `graphs/ppt/graph.py` - 自登记**

替换 `src/know_agent/graphs/ppt/graph.py` 全文为：

```python
"""PPT 生成 graph - StateGraph 组装 + 自登记到 registry.

工作流：
  START -> requirement -> (search | clarification)
          clarification -> requirement（interrupt_before，人在回路）
          search -> template_select -> template_info -> outline -> schema -> render -> END
"""

from langgraph.graph import END, START, StateGraph

from know_agent.agents.checkpoint import get_checkpointer
from know_agent.graphs.ppt.agent_nodes import (
    outline_node,
    schema_node,
    search_node,
    template_select_node,
)
from know_agent.graphs.ppt.nodes import (
    clarification_node,
    render_node,
    requirement_node,
    template_info_node,
)
from know_agent.graphs.ppt.state import PptState
from know_agent.graphs.registry import GraphRegistration, register_graph
from know_agent.schemas.graph import GraphResumeRequest, ResumeAnswer

GRAPH_NAME = "ppt_build"


def build_ppt_graph():
    workflow = StateGraph(PptState)
    workflow.add_node("requirement", requirement_node)
    workflow.add_node("clarification", clarification_node)
    workflow.add_node("search", search_node)
    workflow.add_node("template_select", template_select_node)
    workflow.add_node("template_info", template_info_node)
    workflow.add_node("outline", outline_node)
    workflow.add_node("schema", schema_node)
    workflow.add_node("render", render_node)

    workflow.add_edge(START, "requirement")
    workflow.add_conditional_edges(
        "requirement",
        lambda s: s.get("next_node", "search"),
        {"search": "search", "clarification": "clarification"},
    )
    workflow.add_edge("search", "template_select")
    workflow.add_edge("template_select", "template_info")
    workflow.add_edge("template_info", "outline")
    workflow.add_edge("outline", "schema")
    workflow.add_edge("schema", "render")
    workflow.add_edge("render", END)
    workflow.add_edge("clarification", "requirement")

    return workflow.compile(
        checkpointer=get_checkpointer(),
        interrupt_before=["clarification"],
    )


def get_ppt_graph():
    """兼容包装：Task 3 改完路由后删除（改用 registry.get_compiled_graph('ppt_build')）."""
    return build_ppt_graph()


def _compose_answers(answers: list[ResumeAnswer]) -> str:
    """把结构化回答组装成自然语言文本，供 clarification_node 拼回 input."""
    parts = []
    for a in answers:
        text = (a.label or a.value).strip()
        if text:
            parts.append(f"{a.id}：{text}")
    return "\n".join(parts)


def _compose_resume_response(req: GraphResumeRequest) -> str:
    """resume 请求 -> 要写入 state 的文本：优先 answers，回退纯文本，都空抛错."""
    if req.answers:
        return _compose_answers(req.answers)
    resp = req.clarificationResponse or ""
    if not resp:
        raise ValueError("answers 或 clarificationResponse 至少需提供一个非空值")
    return resp


register_graph(GraphRegistration(
    name=GRAPH_NAME,
    title="PPT 生成",
    description="根据需求生成 PPT",
    factory=build_ppt_graph,
    state_keys=[
        "requirement", "info_complete", "next_node", "clarification",
        "clarification_options",
        "search_info", "template_code", "template_info",
        "ppt_outline", "ppt_schema", "ppt_result",
    ],
    interrupt_payload=lambda v: {
        "clarification": v.get("clarification", ""),
        "clarification_options": v.get("clarification_options", []),
    },
    compose_resume_response=_compose_resume_response,
    resume_state_key="clarification_response",
    result_key="ppt_result",
))
```

注意相对原文件的变更：
- 删 `from functools import lru_cache`
- `get_ppt_graph` 去 `@lru_cache`，改为兼容包装（Task 3 删除）
- 删 `build_ppt_graph` 末尾的 `graph = workflow_compile.get_graph(); graph.draw_mermaid()` 两行（mermaid 改由 registry 派生）
- 新增 `_compose_answers` / `_compose_resume_response`（从 `routers/graph.py` 搬来）
- 新增顶层 `register_graph(...)` 调用

- [ ] **Step 4: Modify `graphs/__init__.py` - 扫描入口**

替换 `src/know_agent/graphs/__init__.py`（当前为空）全文为：

```python
"""graphs 包入口 - 扫描子包触发各 graph 模块的 register_graph 自登记.

类似 Java @ComponentScan：import 本包即自动发现并注册所有 graph。
循环 import 分析：先 import registry 再扫描，子模块 import 时 registry 已就绪。
"""

from know_agent.graphs import registry  # noqa: F401  先就绪 registry

import importlib
import pkgutil

for _finder, _modname, _ispkg in pkgutil.walk_packages(__path__, prefix=__name__ + "."):
    importlib.import_module(_modname)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_scan.py tests/test_registry.py -v`
Expected: PASS（扫描注册 ppt_build，registry 测试不受污染）

- [ ] **Step 6: Verify import has no circular dependency**

Run: `uv run python -c "import know_agent.graphs; from know_agent.graphs.registry import list_graphs; print([r.name for r in list_graphs()])"`
Expected: 输出包含 `ppt_build`，无 `ImportError` / `CircularImport`

- [ ] **Step 7: Commit**

```bash
git add src/know_agent/graphs/ppt/graph.py src/know_agent/graphs/__init__.py tests/test_scan.py
git commit -m "feat(graphs): ppt graph 自登记 + __init__ 扫描入口"
```

---

### Task 3: 路由层通用化 + 删除 get_ppt_graph

**Files:**
- Modify: `src/know_agent/routers/graph.py`
- Modify: `src/know_agent/graphs/ppt/graph.py`（删除 `get_ppt_graph`）

**Interfaces:**
- Consumes: Task 1 的 `registry.get_graph` / `get_compiled_graph` / `list_graphs` / `get_graph_topology` / `GraphNotFoundError`、Task 2 的 ppt 自登记
- Produces:
  - `list_graphs()` 路由：返回 `[{"name","title","description"}]`
  - `graph_run_sse` / `graph_resume_sse`：按 `req.graphName` 分发，未知 name 返回 404
  - `_stream(reg, inputs, config, last_event_id)`：通用化，读 `reg.state_keys` / `reg.interrupt_payload` / `reg.result_key`
  - `GET /graph_topology/{name}`：返回 `{"nodes": [{"id","name"}], "mermaid": str}`

**测试说明**：路由层依赖 PostgresSaver checkpointer + LLM，无法纯单测。本 task 验证靠 import 检查 + 手动 SSE 冒烟（Step 5）。

- [ ] **Step 1: Replace `routers/graph.py` 全文**

替换 `src/know_agent/routers/graph.py` 全文为：

```python
"""graph 路由 - 对应源项目 GraphExecutionController.

POST /graph_run_sse      首次运行（按 graphName 分发），检测 interrupt_before clarification
POST /graph_resume_sse   用户补充信息后恢复（支持结构化 answers 或纯文本）
GET  /list-graphs        列出已注册 graph（name/title/description）
GET  /graph_topology/{name}  返回 graph 流程节点 + mermaid 图
"""

import json

from langchain_core.messages import AIMessage, HumanMessage
from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from know_agent.configuration import get_settings
from know_agent.core.limiter import limiter
from know_agent.core.sse_store import parse_last_event_id, sse_store
from know_agent.graphs import registry
from know_agent.graphs.registry import GraphNotFoundError
from know_agent.schemas.graph import GraphResumeRequest, GraphRunRequest

router = APIRouter()


def _config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}


def _stream(reg, inputs, config, last_event_id: int | None = None):
    """通用流式：yield 节点更新 + interrupt/done，带 id + 缓存支持断线重连.

    读 reg 的声明式 metadata（state_keys / interrupt_payload / result_key），
    不认识任何具体 graph 字段。用同步 graph.stream（PostgresSaver 是同步 checkpointer）。
    """
    graph = registry.get_compiled_graph(reg.name)
    thread_id = config["configurable"]["thread_id"]
    # 断线重连：重放缓存事件
    if last_event_id is not None:
        for eid, ev in sse_store.get_since(thread_id, last_event_id):
            yield {**ev, "id": str(eid)}
        return
    # 新流：stream(inputs) 首次运行，stream(None) 从 interrupt 处继续
    for output in graph.stream(inputs, config, stream_mode="updates"):
        for node, update in output.items():
            values = {k: update[k] for k in reg.state_keys if k in update}
            event = {
                "event": "update",
                "data": json.dumps({"node": node, "values": values}, ensure_ascii=False),
            }
            eid = sse_store.append(thread_id, event)
            yield {**event, "id": str(eid)}
    state = graph.get_state(config)
    if state.next:
        payload = {"next": state.next, **reg.interrupt_payload(state.values)}
        event = {
            "event": "interrupt",
            "data": json.dumps(payload, ensure_ascii=False),
        }
    else:
        result = state.values.get(reg.result_key, "")
        # 记录 assistant 回复到 messages，供会话历史拉取
        graph.update_state(config, {"messages": [AIMessage(content=result or "工作流已完成")]})
        event = {
            "event": "done",
            "data": json.dumps({"result": result}, ensure_ascii=False),
        }
    eid = sse_store.append(thread_id, event)
    yield {**event, "id": str(eid)}
    sse_store.mark_done(thread_id)


@router.get("/list-graphs", tags=["graph"])
def list_graphs() -> list[dict]:
    return [
        {"name": r.name, "title": r.title, "description": r.description}
        for r in registry.list_graphs()
    ]


@router.get("/graph_topology/{name}", tags=["graph"])
def graph_topology(name: str) -> dict:
    """返回指定 graph 的流程节点列表与 mermaid 流程图，供前端渲染流程可视化."""
    try:
        return registry.get_graph_topology(name)
    except GraphNotFoundError:
        raise HTTPException(status_code=404, detail=f"graph '{name}' not found")


@router.post("/graph_run_sse", tags=["graph"])
@limiter.limit(lambda: get_settings().rate_limit)
async def graph_run_sse(request: Request, req: GraphRunRequest):
    try:
        reg = registry.get_graph(req.graphName)
    except GraphNotFoundError:
        raise HTTPException(status_code=404, detail=f"graph '{req.graphName}' not found")
    config = _config(req.threadId)
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream(reg, None, config, last_event_id=last_id))
    if req.inputs:
        inputs = req.inputs
    else:
        content = req.newMessage.content if req.newMessage else ""
        inputs = {"input": content, "messages": [HumanMessage(content=content)]}
    return EventSourceResponse(_stream(reg, inputs, config))


@router.post("/graph_resume_sse", tags=["graph"])
@limiter.limit(lambda: get_settings().rate_limit)
async def graph_resume_sse(request: Request, req: GraphResumeRequest):
    """用户补充澄清信息后恢复 graph。支持结构化 answers 或纯文本 clarificationResponse."""
    try:
        reg = registry.get_graph(req.graphName)
    except GraphNotFoundError:
        raise HTTPException(status_code=404, detail=f"graph '{req.graphName}' not found")
    config = _config(req.threadId)
    last_id = parse_last_event_id(request.headers)
    if last_id is not None:
        return EventSourceResponse(_stream(reg, None, config, last_event_id=last_id))
    try:
        resp = reg.compose_resume_response(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    graph = registry.get_compiled_graph(reg.name)
    update = {"messages": [HumanMessage(content=resp)]}
    if reg.resume_state_key:
        update[reg.resume_state_key] = resp
    graph.update_state(config, update)
    return EventSourceResponse(_stream(reg, None, config))
```

相对原文件变更：
- import：删 `from know_agent.graphs.ppt.graph import GRAPH_NAME, get_ppt_graph`、`ResumeAnswer`；加 `from know_agent.graphs import registry`、`from know_agent.graphs.registry import GraphNotFoundError`
- 删模块级 `_STATE_KEYS`、`_extract_state`、`_compose_answers`（后者已搬到 ppt）
- `_stream` 签名加 `reg`，内部改用 `reg.state_keys` / `reg.interrupt_payload` / `reg.result_key`，done 事件字段 `ppt_result` -> `result`
- `list_graphs` 返回新结构
- 新增 `graph_topology` 路由
- `graph_run_sse` / `graph_resume_sse` 按 `req.graphName` 分发 + 404
- resume 调 `reg.compose_resume_response`，404/400 分流

- [ ] **Step 2: Delete `get_ppt_graph` from `graphs/ppt/graph.py`**

在 `src/know_agent/graphs/ppt/graph.py` 中删除以下函数（Task 2 保留的兼容包装，现路由已不引用）：

```python
def get_ppt_graph():
    """兼容包装：Task 3 改完路由后删除（改用 registry.get_compiled_graph('ppt_build')）."""
    return build_ppt_graph()
```

删除后确认全文无 `get_ppt_graph` 残留。

- [ ] **Step 3: Verify imports resolve**

Run: `uv run python -c "from know_agent.routers.graph import router; print('OK')"`
Expected: 输出 `OK`，无 `ImportError`

- [ ] **Step 4: Verify no dangling references to get_ppt_graph**

Run: `uv run python -c "import know_agent.routers.graph; import know_agent.graphs.ppt.graph; print('no get_ppt_graph ref')"`
Expected: 输出 `no get_ppt_graph ref`，无 `AttributeError`

- [ ] **Step 5: Run full test suite**

Run: `uv run pytest tests/ -v`
Expected: PASS（test_registry + test_scan 全过）

- [ ] **Step 6: Manual SSE smoke test（需要 DB + LLM 配置）**

启动服务：`uv run uvicorn know_agent.main:app --reload --port 8000`

另开终端验证 list-graphs：
```bash
curl -s http://localhost:8000/v1/list-graphs
```
Expected: `[{"name":"ppt_build","title":"PPT 生成","description":"根据需求生成 PPT"}]`

验证 topology：
```bash
curl -s http://localhost:8000/v1/graph_topology/ppt_build
```
Expected: `{"nodes":[{"id":"requirement","name":"requirement"},...],"mermaid":"graph TD; ..."}`，节点列表不含 `__start__`/`__end__`

验证未知 graph 404：
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/v1/graph_topology/nope
```
Expected: `404`

> 注：SSE 端到端（graph_run_sse 跑通 PPT 生成）需要 DB + RustFS + LLM 全部就绪，可选验证；若环境不全，前述 curl 验证足够确认路由通用化正确。

- [ ] **Step 7: Commit**

```bash
git add src/know_agent/routers/graph.py src/know_agent/graphs/ppt/graph.py
git commit -m "feat(graphs): 路由层通用化，按 graphName 分发 + topology 接口"
```

---

### Task 4: 更新 docs/api.md 契约

**Files:**
- Modify: `docs/api.md`（第 7 章 PPT 生成 Graph，约 387-438 行）

**Interfaces:**
- Consumes: Task 3 定型的新契约
- Produces: 与代码一致的 API 文档

- [ ] **Step 1: Update 7.1 list-graphs 响应**

在 `docs/api.md` 中找到第 7.1 节（约 389-391 行）：

```markdown
### 7.1 列出可用 Graph `GET /list-graphs`

**响应**：`["ppt_build"]`
```

替换为：

```markdown
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
```

- [ ] **Step 2: Update 7.2 graphName 说明 + SSE 事件表**

在 7.2 节的字段表（约 410 行）：

```markdown
| `graphName` | string | 是 | 固定 `ppt_build` |
```

替换为：

```markdown
| `graphName` | string | 是 | 已注册 graph 的 `name`（当前 `ppt_build`），不存在返回 404 |
```

SSE 事件表（约 417-421 行）：

```markdown
| `interrupt` | `{ "next": ["clarification"], "clarification": "请补充..." }` | 需求不完整，等待用户补充 |
| `done` | `{ "ppt_result": "https://oss.../output.pptx" }` | 生成完成，返回 pptx 下载地址 |
```

替换为：

```markdown
| `interrupt` | `{ "next": ["clarification"], "clarification": "请补充...", "clarification_options": [...] }` | 需求不完整，等待用户补充；`clarification_options` 为结构化建议选项 |
| `done` | `{ "result": "https://oss.../output.pptx" }` | 生成完成，返回结果地址 |
```

`values` 字段列表（约 423 行）：

```markdown
`values` 可能包含的字段：`requirement` / `info_complete` / `next_node` / `clarification` / `search_info` / `template_code` / `template_info` / `ppt_outline` / `ppt_schema` / `ppt_result`
```

替换为：

```markdown
`values` 可能包含的字段：`requirement` / `info_complete` / `next_node` / `clarification` / `clarification_options` / `search_info` / `template_code` / `template_info` / `ppt_outline` / `ppt_schema` / `ppt_result`
```

- [ ] **Step 3: Update 7.3 graphName 说明**

在 7.3 节的请求体说明中（若有 `graphName` 说明为"固定 ppt_build"），同 Step 2 改为"已注册 graph 的 `name`，不存在返回 404"。若 7.3 无独立 graphName 说明，跳过此步。

- [ ] **Step 4: Add 7.4 graph_topology 节**

在 7.3 节之后、`---` 分隔线之前（约 438 行前）插入：

```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add docs/api.md
git commit -m "docs: 更新 graph API 契约（list-graphs 结构 / done result / topology 接口）"
```

---

## Self-Review 记录

**Spec coverage**：
- §1 registry 结构 + 单例统一 + 扫描入口 → Task 1 + Task 2 ✅
- §2 路由通用化 + _stream 声明式 + resume 声明式 → Task 3 ✅
- §3 前端契约变更 + 错误处理（404/400）+ 测试 → Task 1/3 测试 + Task 4 文档 ✅
- §4 topology 派生 + 独立接口 + 过滤 __start__/__end__ → Task 1 get_graph_topology + Task 3 路由 + Task 4 文档 ✅
- 改动文件清单全部覆盖 ✅

**Placeholder scan**：无 TBD/TODO；每个代码步骤含完整代码；路由层无法单测处已显式说明并给手动验证命令。✅

**Type consistency**：
- `GraphRegistration` 9 字段在 Task 1 定义，Task 2 ppt 自登记一一对应（name/title/description/factory/state_keys/interrupt_payload/compose_resume_response/resume_state_key/result_key）✅
- `_stream(reg, ...)` 签名 Task 3 定义，`graph_run_sse`/`graph_resume_sse` 调用一致 ✅
- `get_graph_topology` Task 1 定义返回 `{nodes, mermaid}`，Task 3 路由原样返回，Task 4 文档一致 ✅
- `compose_resume_response` 抛 `ValueError` -> 路由 400；`get_graph` 抛 `GraphNotFoundError` -> 路由 404，一致 ✅

**任务独立性**：Task 1 无依赖；Task 2 依赖 Task 1；Task 3 依赖 Task 1+2；Task 4 依赖 Task 3。每个 task 后代码可运行（Task 2 保留 `get_ppt_graph` 兼容包装直到 Task 3 删除，避免中间态 import 断裂）。✅
