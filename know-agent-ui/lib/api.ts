"use client";

import type { ChatMessage, DocumentItem, DocumentStatus, SegmentItem } from "@/lib/mock-data";

export type UserProfile = {
  name: string;
  sub?: string;
  roles: string[];
  email?: string;
};

export type AuthState = {
  token: string | null;
  user: UserProfile;
};

export type RoleItem = {
  name: string;
  displayName?: string;
};

export type SseEvent = {
  event: string;
  data: string;
};

type ApiDocument = {
  doc_id: number;
  doc_title: string;
  upload_user?: string | null;
  status: string;
  accessible_by?: string | null;
  description?: string | null;
  knowledge_base_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ApiSegment = {
  id: number;
  text: string;
  chunk_id?: string | null;
  document_id: number;
  chunk_order: number;
  embedding_id?: string | null;
  status?: string | null;
};

type PageResponse<T> = {
  records: T[];
  total: number;
  current: number;
  size: number;
};

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const TOKEN_KEY = "know-agent-token";
const USER_KEY = "know-agent-user";

export function readAuth(): AuthState | null {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem(TOKEN_KEY);
  const rawUser = window.localStorage.getItem(USER_KEY);
  if (!token || !rawUser) return null;
  try {
    return { token, user: JSON.parse(rawUser) as UserProfile };
  } catch {
    return null;
  }
}

export function saveAuth(auth: AuthState) {
  window.localStorage.setItem(TOKEN_KEY, auth.token ?? "");
  window.localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

export function clearAuth() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

function headers(token?: string | null, contentType = "application/json") {
  const result: Record<string, string> = {};
  if (contentType) result["Content-Type"] = contentType;
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function parseError(resp: Response) {
  try {
    const data = await resp.json();
    return data?.detail ?? `${resp.status} ${resp.statusText}`;
  } catch {
    return `${resp.status} ${resp.statusText}`;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const resp = await fetch(`${API_BASE}/v1${path}`, {
    ...options,
    headers: {
      ...headers(token, options.body instanceof FormData ? "" : "application/json"),
      ...(options.headers ?? {})
    }
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  return resp.json() as Promise<T>;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function mapDocument(doc: ApiDocument): DocumentItem {
  return {
    docId: doc.doc_id,
    docTitle: doc.doc_title,
    uploadUser: doc.upload_user ?? "-",
    description: doc.description ?? "",
    knowledgeBaseType:
      doc.knowledge_base_type === "DATA_QUERY" ? "DATA_QUERY" : "DOCUMENT_SEARCH",
    accessibleBy: doc.accessible_by?.trim() || "公开",
    status: doc.status as DocumentStatus,
    chunks: 0,
    createdAt: formatDate(doc.created_at),
    updatedAt: formatDate(doc.updated_at)
  };
}

export function mapSegment(segment: ApiSegment): SegmentItem {
  return {
    id: segment.id,
    text: segment.text,
    chunkId: segment.chunk_id ?? "-",
    documentId: segment.document_id,
    chunkOrder: segment.chunk_order,
    embeddingId: segment.embedding_id ?? "-",
    status: segment.status === "STORED" ? "STORED" : "VECTOR_STORED"
  };
}

export async function login(username: string, password: string): Promise<AuthState> {
  const data = await request<{
    access_token: string;
    user: UserProfile;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  const auth = {
    token: data.access_token,
    user: {
      name: data.user.name ?? data.user.sub ?? username,
      sub: data.user.sub,
      roles: data.user.roles ?? [],
      email: data.user.email
    }
  };
  saveAuth(auth);
  return auth;
}

export async function logout(token: string | null) {
  if (!token) return;
  await request("/api/auth/logout", { method: "POST" }, token).catch(() => undefined);
  clearAuth();
}

export async function listDocuments(token: string | null, current = 1, size = 100) {
  const data = await request<PageResponse<ApiDocument>>(
    `/api/document/page?current=${current}&size=${size}`,
    {},
    token
  );
  return data.records.map(mapDocument);
}

export async function listSegmentsByDocument(token: string | null, documentId: number) {
  const data = await request<ApiSegment[]>(
    `/api/segment/list-by-document?document_id=${documentId}`,
    {},
    token
  );
  return data.map(mapSegment);
}

export async function listRoles(token: string | null): Promise<RoleItem[]> {
  return request<RoleItem[]>("/api/document/roles", {}, token).catch(() => [
    { name: "admin", displayName: "管理员" },
    { name: "normal_user", displayName: "普通用户" }
  ]);
}

export async function uploadDocument(token: string | null, form: FormData) {
  const payload = new FormData();
  payload.set("file", form.get("file") as Blob);
  payload.set("upload_user", String(form.get("uploadUser") || "web"));
  payload.set("title", String(form.get("title") || "未命名文档"));
  payload.set("description", String(form.get("description") || ""));
  payload.set("knowledge_base_type", String(form.get("knowledgeBaseType") || "DOCUMENT_SEARCH"));
  payload.set("accessible_by", form.getAll("accessibleBy").map(String).join(","));
  const tableName = String(form.get("tableName") || "").trim();
  if (tableName) payload.set("table_name", tableName);
  const doc = await request<ApiDocument>(
    "/api/document/upload",
    { method: "POST", body: payload },
    token
  );
  return mapDocument(doc);
}

export async function deleteDocument(token: string | null, docId: number) {
  return request<boolean>(`/api/document/${docId}`, { method: "DELETE" }, token);
}

export async function splitDocument(token: string | null, docId: number) {
  const form = new URLSearchParams();
  form.set("split_type", "SMART");
  form.set("chunk_size", "500");
  form.set("overlap", "0");
  return request<number>(
    `/api/document/split/${docId}`,
    {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    },
    token
  );
}

export async function embedDocument(token: string | null, docId: number) {
  return request<string>(`/api/document/embedding/${docId}`, { method: "POST" }, token);
}

export async function streamSse(
  path: string,
  body: unknown,
  token: string | null,
  onEvent: (event: SseEvent) => void
) {
  const resp = await fetch(`${API_BASE}/v1${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  if (!resp.body) throw new Error("浏览器不支持流式响应");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/);
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      onEvent({ event, data });
    }
  }
}

export function makeMessage(role: ChatMessage["role"], content: string, sources?: string[]) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    sources,
    time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  } satisfies ChatMessage;
}

// 会话历史（进入旧会话拉取）
export async function getThreadHistory(
  token: string | null,
  appName: string,
  userId: string,
  threadId: string
) {
  return request<{ role: string; content: string }[]>(
    `/apps/${appName}/users/${userId}/threads/${threadId}/history`,
    {},
    token
  );
}

export async function listThreads(token: string | null, appName: string, userId: string) {
  return request<{ thread_id: string }[]>(
    `/apps/${appName}/users/${userId}/threads`,
    {},
    token
  );
}

// HITL 工具审批恢复
export type ToolFeedback = {
  id: string;
  name?: string;
  result: "APPROVED" | "REJECTED" | "EDITED";
  arguments?: Record<string, unknown>;
  description?: string;
};

export async function resumeSse(
  threadId: string,
  toolFeedbacks: ToolFeedback[],
  token: string | null,
  onEvent: (event: SseEvent) => void
) {
  return streamSse(
    "/resume_sse",
    { appName: "common_agent", threadId, toolFeedbacks },
    token,
    onEvent
  );
}
