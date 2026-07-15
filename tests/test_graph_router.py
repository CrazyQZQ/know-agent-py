"""Graph registry HTTP boundary contracts."""

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from know_agent.graphs.registry import GraphNotFoundError
from know_agent.routers import graph as graph_router


def test_list_graphs_returns_frontend_metadata(monkeypatch):
    registration = SimpleNamespace(
        name="ppt_build",
        title="PPT 生成",
        description="根据需求生成 PPT",
    )
    monkeypatch.setattr(graph_router.registry, "list_graphs", lambda: [registration])

    assert graph_router.list_graphs() == [
        {
            "name": "ppt_build",
            "title": "PPT 生成",
            "description": "根据需求生成 PPT",
        }
    ]


def test_graph_topology_returns_registry_payload(monkeypatch):
    payload = {
        "nodes": [{"id": "requirement", "name": "requirement"}],
        "mermaid": "graph TD; requirement",
    }
    monkeypatch.setattr(graph_router.registry, "get_graph_topology", lambda name: payload)

    assert graph_router.graph_topology("ppt_build") == payload


def test_graph_topology_maps_unknown_graph_to_404(monkeypatch):
    def missing(_name):
        raise GraphNotFoundError("missing")

    monkeypatch.setattr(graph_router.registry, "get_graph_topology", missing)

    with pytest.raises(HTTPException) as exc_info:
        graph_router.graph_topology("missing")

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "graph 'missing' not found"


def test_stream_done_event_uses_generic_result_field(monkeypatch):
    class FakeGraph:
        def stream(self, inputs, config, stream_mode):
            assert inputs == {"input": "make slides"}
            assert stream_mode == "updates"
            yield {"render": {"ppt_result": "/files/report.pptx"}}

        def get_state(self, config):
            return SimpleNamespace(next=(), values={"ppt_result": "/files/report.pptx"})

        def update_state(self, config, update):
            assert update["messages"][0].content == "/files/report.pptx"

    registration = SimpleNamespace(
        name="ppt_build",
        state_keys=["ppt_result"],
        interrupt_payload=lambda values: {},
        result_key="ppt_result",
        messages_state_key="messages",
    )
    monkeypatch.setattr(graph_router.registry, "get_compiled_graph", lambda name: FakeGraph())
    monkeypatch.setattr(graph_router.sse_store, "append", lambda thread_id, event: 1)
    monkeypatch.setattr(graph_router.sse_store, "mark_done", lambda thread_id: None)

    events = list(graph_router._stream(
        registration,
        {"input": "make slides"},
        {"configurable": {"thread_id": "thread-1"}},
    ))

    assert events[-1]["event"] == "done"
    assert json.loads(events[-1]["data"]) == {"result": "/files/report.pptx"}


def test_stream_done_does_not_require_a_messages_state(monkeypatch):
    class FakeGraph:
        def stream(self, inputs, config, stream_mode):
            return iter(())

        def get_state(self, config):
            return SimpleNamespace(next=(), values={"output": "complete"})

        def update_state(self, config, update):
            raise AssertionError("message-less graph must not receive a messages update")

    registration = SimpleNamespace(
        name="message_less",
        state_keys=["output"],
        interrupt_payload=lambda values: {},
        result_key="output",
        messages_state_key=None,
    )
    monkeypatch.setattr(graph_router.registry, "get_compiled_graph", lambda name: FakeGraph())
    monkeypatch.setattr(graph_router.sse_store, "append", lambda thread_id, event: 1)
    monkeypatch.setattr(graph_router.sse_store, "mark_done", lambda thread_id: None)

    events = list(graph_router._stream(
        registration,
        {},
        {"configurable": {"thread_id": "thread-2"}},
    ))

    assert json.loads(events[-1]["data"]) == {"result": "complete"}
