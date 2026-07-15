"""PPT graph 的结构化交互与用户可见展示适配器。"""

import json
from typing import Any


def build_interrupt_form(values: dict) -> dict:
    """把需求澄清状态转换为前端可直接渲染的表单协议。"""
    raw_items = values.get("clarification_options") or []
    fields = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        options = [
            {
                "label": str(option.get("label", option.get("value", ""))),
                "value": str(option.get("value", option.get("label", ""))),
            }
            for option in item.get("options", [])
            if isinstance(option, dict) and (option.get("label") or option.get("value"))
        ]
        field_id = str(item.get("id") or f"field_{index + 1}")
        fields.append({
            "id": field_id,
            "type": (
                "multi_select"
                if options and bool(item.get("multiple", item.get("allow_multiple", False)))
                else "single_select" if options else "textarea"
            ),
            "label": str(item.get("question") or field_id),
            "options": options,
            "required": bool(item.get("required", True)),
            "allow_custom": bool(item.get("allow_custom", not options)),
        })
    if not fields:
        fields.append({
            "id": "response",
            "type": "textarea",
            "label": "补充说明",
            "options": [],
            "required": True,
            "allow_custom": True,
        })
    return {
        "type": "form",
        "title": "补充生成信息",
        "description": values.get("clarification", ""),
        "fields": fields,
        "actions": [
            {"id": "submit", "label": "继续生成", "style": "primary"},
            {"id": "cancel", "label": "终止流程", "style": "ghost"},
        ],
        "clarification": values.get("clarification", ""),
        "clarification_options": raw_items,
    }


def _message(headline: str, body: str) -> dict:
    return {"kind": "message", "headline": headline, "body": body}


def _template_summary(raw: str) -> str:
    try:
        template = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw or "已完成模板准备。"
    name = template.get("template_name") or "演示文稿模板"
    count = f"，包含 {template['slide_count']} 种基础版式" if template.get("slide_count") else ""
    description = f"\n{template['template_desc']}" if template.get("template_desc") else ""
    return f"{name}{count}{description}"


def _schema_summary(raw: str) -> str:
    normalized = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        schema = json.loads(normalized)
    except (TypeError, json.JSONDecodeError):
        return "已生成逐页内容与版式结构，完整结构可在右侧输出中查看。"
    slides = schema if isinstance(schema, list) else schema.get("slides", []) if isinstance(schema, dict) else []
    page_names = [
        str(slide.get("pageDesc", "")).strip()
        for slide in slides
        if isinstance(slide, dict) and slide.get("pageDesc")
    ]
    summary = f"已生成 {len(slides)} 页演示文稿内容与版式结构。"
    return f"{summary}\n页面：{'、'.join(page_names)}" if page_names else summary


def present_update(node: str, values: dict[str, Any]) -> dict | None:
    """把 PPT 节点私有 state 转换为通用 presentation。"""
    if node == "requirement":
        if values.get("info_complete") is not True:
            return None
        requirement = str(values.get("requirement") or "").strip()
        return _message("需求已确认", requirement) if requirement else None
    if node == "search":
        return _message("资料检索完成", str(values.get("search_info") or "已完成相关资料检索。"))
    if node == "template_select":
        return _message("模板已选择", str(values.get("template_code") or "已完成模板选择。"))
    if node == "template_info":
        return _message("模板已准备", _template_summary(str(values.get("template_info") or "")))
    if node == "outline":
        return _message("内容大纲已生成", str(values.get("ppt_outline") or "已完成内容大纲生成。"))
    if node == "schema":
        return _message("页面结构已生成", _schema_summary(str(values.get("ppt_schema") or "")))
    return None


def present_done(result: Any, values: dict[str, Any]) -> dict:
    """生成 PPT graph 的统一完成展示。"""
    url = str(result or "").strip()
    return {
        "kind": "artifact" if url else "message",
        "headline": "PPT 已生成" if url else "工作流已完成",
        "body": "可以下载生成的演示文稿。" if url else "演示文稿工作流已完成。",
        **({"artifactUrl": url, "artifactLabel": "下载演示文稿"} if url else {}),
    }
