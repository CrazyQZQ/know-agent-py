from know_agent.graphs.ppt import nodes as ppt_nodes
from know_agent.graphs.ppt.graph import _compose_resume_value, _interrupt_payload
from know_agent.schemas.graph import GraphResumeRequest, ResumeAnswer


def test_ppt_interrupt_payload_describes_form_controls():
    payload = _interrupt_payload({
        "clarification": "请补充 PPT 信息",
        "clarification_options": [
            {
                "id": "style",
                "question": "请选择风格",
                "options": [
                    {"label": "商务专业", "value": "business"},
                    {"label": "科技感", "value": "tech"},
                ],
                "required": True,
            },
            {
                "id": "topics",
                "question": "请选择重点方向",
                "options": [
                    {"label": "增长", "value": "growth"},
                    {"label": "商业化", "value": "monetization"},
                ],
                "multiple": True,
                "required": True,
            },
            {
                "id": "notes",
                "question": "补充说明",
                "options": [],
                "required": False,
            },
        ],
    })

    assert payload["type"] == "form"
    assert payload["fields"] == [
        {
            "id": "style",
            "type": "single_select",
            "label": "请选择风格",
            "options": [
                {"label": "商务专业", "value": "business"},
                {"label": "科技感", "value": "tech"},
            ],
            "required": True,
            "allow_custom": False,
        },
        {
            "id": "topics",
            "type": "multi_select",
            "label": "请选择重点方向",
            "options": [
                {"label": "增长", "value": "growth"},
                {"label": "商业化", "value": "monetization"},
            ],
            "required": True,
            "allow_custom": False,
        },
        {
            "id": "notes",
            "type": "textarea",
            "label": "补充说明",
            "options": [],
            "required": False,
            "allow_custom": True,
        },
    ]


def test_structured_resume_composes_multi_select_answers():
    response = _compose_resume_value(GraphResumeRequest(
        graphName="ppt_build",
        threadId="thread-1",
        answers=[ResumeAnswer(id="topics", value=["growth", "monetization"])],
    ))

    assert response == "topics：growth、monetization"


def test_clarification_node_uses_native_interrupt_and_merges_response(monkeypatch):
    captured = {}

    def fake_interrupt(payload):
        captured["payload"] = payload
        return "audience: executives"

    monkeypatch.setattr(ppt_nodes, "interrupt", fake_interrupt, raising=False)

    update = ppt_nodes.clarification_node({
        "input": "Create a quarterly report",
        "clarification": "Choose an audience",
        "clarification_options": [],
    })

    assert captured["payload"]["type"] == "form"
    assert update["input"] == (
        "Create a quarterly report\n\n"
        "【用户补充信息】\naudience: executives"
    )
