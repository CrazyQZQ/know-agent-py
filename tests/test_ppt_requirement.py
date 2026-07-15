import json

from know_agent.graphs.ppt import nodes


class _Response:
    def __init__(self, content: str):
        self.content = content


class _Chat:
    def with_structured_output(self, _schema):
        raise RuntimeError("structured output unavailable")

    def invoke(self, _messages):
        return _Response(json.dumps({
            "complete": True,
            "requirement": {"topic": "AI product report", "pages": 8, "style": "tech", "audience": "management"},
        }, ensure_ascii=False))


def test_requirement_node_parses_complete_json_from_text_fallback(monkeypatch):
    monkeypatch.setattr(nodes, "get_chat_model", lambda: _Chat())
    result = nodes.requirement_node({"input": "制作 PPT"})
    assert result["info_complete"] is True
    assert result["next_node"] == "search"
    assert "AI product report" in result["requirement"]


def test_requirement_node_normalizes_incomplete_json_for_clarification(monkeypatch):
    class IncompleteChat(_Chat):
        def invoke(self, _messages):
            return _Response(json.dumps({
                "complete": False,
                "items": [{"question": "请选择受众", "options": ["管理层", "研发人员"]}],
            }, ensure_ascii=False))

    monkeypatch.setattr(nodes, "get_chat_model", lambda: IncompleteChat())
    result = nodes.requirement_node({"input": "制作 PPT"})
    assert result["next_node"] == "clarification"
    assert result["clarification"] == "- 请选择受众"
    assert result["clarification_options"][0]["options"] == [
        {"label": "管理层", "value": "管理层"},
        {"label": "研发人员", "value": "研发人员"},
    ]
