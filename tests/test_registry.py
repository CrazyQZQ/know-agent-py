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
