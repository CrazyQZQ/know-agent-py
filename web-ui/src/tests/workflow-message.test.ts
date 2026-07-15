import { describe, expect, it } from "vitest";

import {
  eventFingerprint,
  extractClarificationOptions,
  parseInterruptForm,
  parsePresentation,
  upsertStepUpdate,
  type StepUpdate,
} from "@/features/workflows/workflow-message";

describe("workflow message presentation", () => {
  it("keeps only the latest update for each node", () => {
    const first: StepUpdate = { node: "outline", values: { ppt_outline: "旧大纲" } };
    const next: StepUpdate = { node: "outline", values: { ppt_outline: "新大纲" } };

    expect(upsertStepUpdate([first, { node: "search", values: { search_info: "资料" } }], next)).toEqual([
      { node: "outline", values: { ppt_outline: "新大纲" } },
      { node: "search", values: { search_info: "资料" } },
    ]);
  });

  it("parses a graph-owned presentation without node-specific fields", () => {
    expect(parsePresentation({
      kind: "artifact",
      headline: "Report ready",
      body: "Download the report.",
      artifactUrl: "/files/report.csv",
      artifactLabel: "Download report",
    })).toEqual({
      kind: "artifact",
      headline: "Report ready",
      body: "Download the report.",
      artifactUrl: "/files/report.csv",
      artifactLabel: "Download report",
    });
    expect(parsePresentation({ headline: "Missing kind", body: "ignored" })).toBeNull();
  });

  it("creates a stable fingerprint for id-less duplicate events", () => {
    const event = { event: "update", data: JSON.stringify({ node: "search", values: { search_info: "资料" } }) };
    expect(eventFingerprint(event)).toBe(eventFingerprint({ ...event }));
  });

  it("recovers clarification choices when the backend omits structured options", () => {
    expect(extractClarificationOptions("请选择受众：\n- **选项：**\n  - A. 学校管理层/校长\n  - B. 一线教师/教研人员\n  - C. 学生/家长")).toEqual([
      "学校管理层/校长",
      "一线教师/教研人员",
      "学生/家长",
    ]);
  });

  it("parses form interrupt metadata without relying on a preceding update", () => {
    const form = parseInterruptForm(JSON.stringify({
      type: "form",
      title: "补充生成信息",
      description: "请选择风格",
      fields: [{ id: "style", type: "single_select", label: "风格", options: [{ label: "科技感", value: "tech" }], required: true }],
      actions: [{ id: "submit", label: "继续生成" }],
    }));
    expect(form?.fields[0]).toMatchObject({ id: "style", type: "single_select" });
  });
});
