import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { ToolApproval } from "@/components/chat/ToolApproval";
import { useEnterAnimation } from "@/lib/gsap-animations";
import { useAuth } from "@/features/auth/AuthProvider";
import { createAssistantSession, getAssistantHistory, resumeAssistant, runAssistant, type AssistantMessage } from "./assistant-api";

export function AssistantPage() {
  const { auth } = useAuth();
  const sectionRef = useEnterAnimation<HTMLElement>();
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const user = auth?.user.name ?? "anonymous";
  const token = auth?.token ?? "";
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [approval, setApproval] = useState<{ id: string; title: string; description?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipHistoryThreadRef = useRef<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setApproval(null);
    if (!threadId) { setMessages([]); return; }
    if (skipHistoryThreadRef.current === threadId) { skipHistoryThreadRef.current = null; return; }
    void getAssistantHistory(user, threadId, token).then((rows) => setMessages(rows.map((row) => ({ ...row, createdAt: row.createdAt ?? Date.now() }))));
  }, [threadId, token, user]);

  useEffect(() => {
    if (messages.length > 0 || approval) {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [approval, messages]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((current) => current.filter((message) => message.content || message.role === "user"));
  };

  async function send(content: string) {
    if (streaming) return;
    const history = messages;
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const replyId = crypto.randomUUID();
    const createdAt = Date.now();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content, createdAt },
      { id: replyId, role: "assistant", content: "", createdAt },
    ]);
    let answer = "";
    try {
      let targetThreadId = threadId;
      if (!targetThreadId) {
        const created = await createAssistantSession(user, token);
        if (controller.signal.aborted) return;
        targetThreadId = created.thread_id;
        skipHistoryThreadRef.current = targetThreadId;
        navigate(`/assistant/${targetThreadId}`, { replace: true });
      }
      await runAssistant({
        user, token, threadId: targetThreadId, messages: history, content, signal: controller.signal,
        onEvent: (event) => {
          if (event.event === "message") {
            answer += event.data;
            setMessages((current) => current.map((message) =>
              message.id === replyId ? { ...message, content: answer } : message,
            ));
          } else if (event.event === "interrupt" || event.event === "tool") {
            try {
              const data = JSON.parse(event.data) as { id?: string; name?: string; description?: string };
              setApproval({ id: data.id ?? "tool", title: data.name ?? "工具审批", description: data.description });
            } catch {
              setApproval({ id: "tool", title: "工具审批", description: event.data });
            }
          }
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessages((current) => current.map((message) =>
          message.id === replyId ? { ...message, content: "请求失败" } : message,
        ));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setMessages((current) => current.filter((message) => message.content || message.role === "user"));
    }
  }

  async function decideApproval(result: "APPROVED" | "REJECTED") {
    if (!threadId || !approval) return;
    setApproval(null);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const replyId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: replyId, role: "assistant", content: "", createdAt: Date.now() },
    ]);
    let answer = "";
    try {
      await resumeAssistant({
        user, token, threadId, toolFeedbacks: [{ id: approval.id, result }], signal: controller.signal,
        onEvent: (event) => {
          if (event.event === "message") {
            answer += event.data;
            setMessages((current) => current.map((message) =>
              message.id === replyId ? { ...message, content: answer } : message,
            ));
          }
        },
      });
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setMessages((current) => current.filter((message) => message.content || message.role === "user"));
    }
  }

  return <section ref={sectionRef} className="flex h-full min-w-0 flex-1 flex-col">
    <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6 md:px-10">
      <div className="mx-auto max-w-[49.5rem]">
        {messages.map((message, index) => <ChatMessageRow key={message.id ?? `${index}-${message.role}`} {...message} createdAt={message.createdAt ?? 0} isStreaming={streaming && index === messages.length - 1 && message.role === "assistant"} />)}
        {approval ? <ToolApproval title={approval.title} description={approval.description} onApprove={() => void decideApproval("APPROVED")} onReject={() => void decideApproval("REJECTED")} /> : null}
        {!threadId ? <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">从左侧新建或选择一个对话</div> : null}
        <div ref={messageEndRef} aria-hidden />
      </div>
    </div>
    <div className="px-4 pb-4 md:px-8"><ChatComposer value={draft} onChange={setDraft} onSend={(value) => void send(value)} isStreaming={streaming} onStop={stop} /></div>
  </section>;
}
