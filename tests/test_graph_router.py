"""Graph registry HTTP boundary contracts."""

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from langgraph.types import Command

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
        present_update=lambda node, values: None,
        present_done=lambda result, values: None,
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
        present_update=lambda node, values: None,
        present_done=lambda result, values: None,
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


def test_stream_emits_native_interrupt_without_done_or_state_probe(monkeypatch):
    form = {
        "type": "form",
        "title": "Need input",
        "description": "Choose a style",
        "fields": [],
        "actions": [],
    }

    class FakeGraph:
        def stream(self, inputs, config, stream_mode):
            yield {"__interrupt__": (SimpleNamespace(id="interrupt-1", value=form),)}

        def get_state(self, config):
            raise AssertionError("native interrupt must terminate the SSE turn")

    registration = SimpleNamespace(
        name="native_interrupt",
        state_keys=[],
        present_update=lambda node, values: None,
        present_done=lambda result, values: None,
        result_key="output",
        messages_state_key=None,
    )
    monkeypatch.setattr(graph_router.registry, "get_compiled_graph", lambda name: FakeGraph())
    monkeypatch.setattr(graph_router.sse_store, "append", lambda thread_id, event: 8)
    monkeypatch.setattr(graph_router.sse_store, "mark_done", lambda thread_id: None)

    events = list(graph_router._stream(
        registration,
        {"input": "start"},
        {"configurable": {"thread_id": "thread-native"}},
    ))

    assert len(events) == 1
    assert events[0]["event"] == "interrupt"
    assert events[0]["id"] == "8"
    assert json.loads(events[0]["data"]) == {"id": "interrupt-1", **form}


def test_stream_adds_graph_owned_presentations(monkeypatch):
    class FakeGraph:
        def stream(self, inputs, config, stream_mode):
            yield {"collect": {"summary": "raw summary"}}

        def get_state(self, config):
            return SimpleNamespace(next=(), values={"output": "/files/report.csv"})

    registration = SimpleNamespace(
        name="report_builder",
        state_keys=["summary", "output"],
        present_update=lambda node, values: {
            "kind": "message",
            "headline": "Collection complete",
            "body": values["summary"],
        },
        present_done=lambda result, values: {
            "kind": "artifact",
            "headline": "Report ready",
            "body": "Download the generated report.",
            "artifactUrl": result,
            "artifactLabel": "Download report",
        },
        result_key="output",
        messages_state_key=None,
    )
    monkeypatch.setattr(graph_router.registry, "get_compiled_graph", lambda name: FakeGraph())
    monkeypatch.setattr(graph_router.sse_store, "append", lambda thread_id, event: 1)
    monkeypatch.setattr(graph_router.sse_store, "mark_done", lambda thread_id: None)

    events = list(graph_router._stream(
        registration,
        {},
        {"configurable": {"thread_id": "thread-report"}},
    ))

    update = json.loads(events[0]["data"])
    done = json.loads(events[-1]["data"])
    assert update["presentation"] == {
        "kind": "message",
        "headline": "Collection complete",
        "body": "raw summary",
    }
    assert done["presentation"]["artifactUrl"] == "/files/report.csv"


def test_resume_command_wraps_graph_specific_resume_value():
    registration = SimpleNamespace(
        compose_resume_value=lambda request: {"approved": True},
    )

    command = graph_router._resume_command(registration, SimpleNamespace())

    assert isinstance(command, Command)
    assert command.resume == {"approved": True}
