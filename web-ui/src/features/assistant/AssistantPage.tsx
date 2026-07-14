import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { ToolApproval } from "@/components/chat/ToolApproval";
import { useAuth } from "@/features/auth/AuthProvider";
import { createAssistantSession, deleteAssistantSession, getAssistantHistory, listAssistantSessions, resumeAssistant, runAssistant, type AssistantMessage, type AssistantSession } from "./assistant-api";

export function AssistantPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const params = useParams<{ threadId?: string }>();
  const user = auth?.user.name ?? "anonymous";
  const token = auth?.token ?? "";
  const [sessions, setSessions] = useState<AssistantSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(params.threadId ?? null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [approval, setApproval] = useState<{ id: string; title: string; description?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSessions = useCallback(async () => { const rows = await listAssistantSessions(user, token); setSessions(rows); if (!activeId && rows[0]) setActiveId(rows[0].thread_id); }, [activeId, token, user]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => { if (activeId) { navigate(`/assistant/${activeId}`, { replace: true }); void getAssistantHistory(user, activeId, token).then((rows) => setMessages(rows.map((row) => ({ ...row, createdAt: row.createdAt ?? Date.now() })))); } }, [activeId, navigate, token, user]);

  const newSession = async () => { const created = await createAssistantSession(user, token); setSessions((prev) => [{ thread_id: created.thread_id, name: "New conversation" }, ...prev]); setActiveId(created.thread_id); setMessages([]); };
  const removeSession = async (id: string) => { await deleteAssistantSession(user, id, token); setSessions((prev) => prev.filter((s) => s.thread_id !== id)); if (activeId === id) { setActiveId(null); setMessages([]); } };
  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setStreaming(false); setMessages((prev) => prev.filter((message) => message.content || message.role === "user")); };
  const send = async (content: string) => {
    if (!activeId || streaming) return;
    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content, createdAt: Date.now() }]); setDraft(""); setStreaming(true);
    const controller = new AbortController(); abortRef.current = controller;
    let answer = "";
    try {
      await runAssistant({ user, token, threadId: activeId, messages: history, content, signal: controller.signal, onEvent: (event) => { if (event.event === "message") { answer += event.data; setMessages((prev) => { const next = [...prev.filter((m) => m.content || m.role === "user")]; next.push({ role: "assistant", content: answer, createdAt: Date.now() }); return next; }); } else if (event.event === "interrupt" || event.event === "tool") { try { const data = JSON.parse(event.data) as { id?: string; name?: string; description?: string }; setApproval({ id: data.id ?? "tool", title: data.name ?? "Tool approval", description: data.description }); } catch { setApproval({ id: "tool", title: "Tool approval", description: event.data }); } } } });
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setMessages((prev) => [...prev, { role: "assistant", content: "Request failed", createdAt: Date.now() }]); }
    finally { abortRef.current = null; setStreaming(false); setMessages((prev) => prev.filter((message) => message.content || message.role === "user")); }
  };

  const decideApproval = async (result: "APPROVED" | "REJECTED") => { if (!activeId || !approval) return; setApproval(null); setStreaming(true); const controller = new AbortController(); abortRef.current = controller; let answer = ""; try { await resumeAssistant({ user, token, threadId: activeId, toolFeedbacks: [{ id: approval.id, result }], signal: controller.signal, onEvent: (event) => { if (event.event === "message") { answer += event.data; setMessages((prev) => [...prev.filter((m) => m.content || m.role === "user"), { role: "assistant", content: answer, createdAt: Date.now() }]); } } }); } finally { abortRef.current = null; setStreaming(false); } };

  return <div className="flex h-full min-h-0">
    <aside className="hidden w-64 shrink-0 border-r border-border p-3 md:block">
      <button type="button" onClick={() => void newSession()} className="mb-3 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm"><MessageSquarePlus className="h-4 w-4" /> New conversation</button>
      <div className="space-y-1">{sessions.map((session) => <div key={session.thread_id} className={`group flex items-center gap-1 rounded-md px-2 py-2 text-sm ${session.thread_id === activeId ? "bg-muted" : ""}`}><button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setActiveId(session.thread_id)}>{session.name || session.thread_id}</button><button type="button" aria-label={`Delete ${session.name || session.thread_id}`} className="hidden p-1 group-hover:block" onClick={() => void removeSession(session.thread_id)}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col"><div className="flex-1 space-y-4 overflow-y-auto p-4">{messages.map((message, index) => <ChatMessageRow key={`${index}-${message.role}`} {...message} createdAt={message.createdAt ?? 0} isStreaming={streaming && index === messages.length - 1 && message.role === "assistant"} />)}{approval ? <ToolApproval title={approval.title} description={approval.description} onApprove={() => void decideApproval("APPROVED")} onReject={() => void decideApproval("REJECTED")} /> : null}{!activeId ? <p className="text-sm text-muted-foreground">Create a conversation to start.</p> : null}</div><div className="border-t border-border p-4"><ChatComposer value={draft} onChange={setDraft} onSend={(value) => void send(value)} isStreaming={streaming} onStop={stop} disabled={!activeId} /></div></section>
  </div>;
}
