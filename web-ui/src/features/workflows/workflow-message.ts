import type { SseEvent } from "@/lib/sse-client";

export type WorkflowPresentation = {
  kind: "message" | "progress" | "artifact" | "silent";
  headline: string;
  body: string;
  artifactUrl?: string;
  artifactLabel?: string;
};

export type StepUpdate = {
  node: string;
  values?: Record<string, unknown>;
  presentation?: unknown;
};

export type InterruptField = {
  id: string;
  type: "textarea" | "single_select" | "multi_select";
  label: string;
  options: Array<{ label: string; value: string }>;
  required: boolean;
  allow_custom: boolean;
};

export type InterruptForm = {
  type: "form";
  title: string;
  description: string;
  fields: InterruptField[];
  actions: Array<{ id: string; label: string; style?: string }>;
};

function parseJson(raw: string): unknown {
  const normalized = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

export function parsePresentation(value: unknown): WorkflowPresentation | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<WorkflowPresentation>;
  if (!data.kind || !["message", "progress", "artifact", "silent"].includes(data.kind)) return null;
  if (typeof data.headline !== "string" || typeof data.body !== "string") return null;
  return {
    kind: data.kind,
    headline: data.headline,
    body: data.body,
    ...(typeof data.artifactUrl === "string" ? { artifactUrl: data.artifactUrl } : {}),
    ...(typeof data.artifactLabel === "string" ? { artifactLabel: data.artifactLabel } : {}),
  };
}

export function upsertStepUpdate(steps: StepUpdate[], update: StepUpdate): StepUpdate[] {
  const index = steps.findIndex((step) => step.node === update.node);
  if (index === -1) return [...steps, update];
  return steps.map((step, currentIndex) => currentIndex === index ? update : step);
}

export function eventFingerprint(event: Pick<SseEvent, "event" | "data">): string {
  return `${event.event}:${event.data}`;
}

export function parseInterruptForm(raw: string): InterruptForm | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as Partial<InterruptForm>;
  if (data.type !== "form" || !Array.isArray(data.fields)) return null;
  const fields = data.fields
    .filter((field): field is InterruptField => Boolean(
      field
      && typeof field.id === "string"
      && typeof field.label === "string"
      && ["textarea", "single_select", "multi_select"].includes(field.type),
    ))
    .map((field) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      options: Array.isArray(field.options)
        ? field.options.filter((option) => option && typeof option.label === "string" && typeof option.value === "string")
        : [],
      required: field.required !== false,
      allow_custom: Boolean(field.allow_custom),
    }));
  return {
    type: "form",
    title: typeof data.title === "string" ? data.title : "补充信息",
    description: typeof data.description === "string" ? data.description : "",
    fields,
    actions: Array.isArray(data.actions)
      ? data.actions.filter((action) => action && typeof action.id === "string" && typeof action.label === "string")
      : [],
  };
}

export function extractClarificationOptions(raw: string): string[] {
  const options: string[] = [];
  const pattern = /^\s*[-*]\s*(?:\*\*)?([A-D])\.\s*(?:\*\*)?(.+?)(?:\*\*)?\s*$/gm;
  for (const match of raw.matchAll(pattern)) {
    const value = match[2].trim();
    if (value) options.push(value);
  }
  return options;
}
