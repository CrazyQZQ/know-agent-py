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
    messages_state_key: str | None                           # 完成时写 assistant 历史；None=不写
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
