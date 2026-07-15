import { apiRequest } from "@/lib/api-client";
import { streamSse, type SseEvent } from "@/lib/sse-client";

export type AssistantSession = { thread_id: string; name?: string; created_at?: string; updated_at?: string };
export type AssistantMessage = { role: "user" | "assistant"; content: string; createdAt?: number };
const app = "common_agent";
const base = (user: string) => `/v1/apps/${encodeURIComponent(app)}/users/${encodeURIComponent(user)}/threads`;

export function listAssistantSessions(user: string, token: string) { return apiRequest<AssistantSession[]>(base(user), { token }); }
export function createAssistantSession(user: string, token: string) { return apiRequest<{ thread_id: string }>(base(user), { method: "POST", token }); }
export function deleteAssistantSession(user: string, threadId: string, token: string) { return apiRequest<{ deleted: string | null }>(`${base(user)}/${encodeURIComponent(threadId)}`, { method: "DELETE", token }); }
export function getAssistantHistory(user: string, threadId: string, token: string) { return apiRequest<AssistantMessage[]>(`${base(user)}/${encodeURIComponent(threadId)}/history`, { token }); }
export function runAssistant(input: { user: string; token: string; threadId: string; messages: AssistantMessage[]; content: string; signal: AbortSignal; onEvent: (event: SseEvent) => void }) {
  return streamSse({ path: "/v1/run_sse", token: input.token, signal: input.signal, body: { appName: app, userId: input.user, threadId: input.threadId, messages: input.messages, newMessage: { role: "user", content: input.content }, streaming: true }, onEvent: input.onEvent });
}

export function resumeAssistant(input: { user: string; token: string; threadId: string; toolFeedbacks: Array<{ id: string; result: "APPROVED" | "REJECTED"; description?: string }>; signal: AbortSignal; onEvent: (event: SseEvent) => void }) {
  return streamSse({ path: "/v1/resume_sse", token: input.token, signal: input.signal, body: { appName: app, userId: input.user, threadId: input.threadId, toolFeedbacks: input.toolFeedbacks }, onEvent: input.onEvent });
}
