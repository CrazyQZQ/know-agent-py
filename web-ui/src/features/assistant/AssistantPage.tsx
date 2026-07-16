import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Prompts, Think, Welcome } from "@ant-design/x";
import { Bot, FileText, Lightbulb, PenLine, Sparkles } from "lucide-react";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { ToolApproval } from "@/components/chat/ToolApproval";
import { useEnterAnimation } from "@/lib/gsap-animations";
import { useAuth } from "@/features/auth/AuthProvider";
import { createAssistantSession, getAssistantHistory, resumeAssistant, runAssistant, type AssistantMessage } from "./assistant-api";

const QUICK_PROMPTS = [
  { key: "summary", icon: <FileText className="h-4 w-4" />, label: "总结本周工作", description: "生成本周工作周报" },
  { key: "explain", icon: <Lightbulb className="h-4 w-4" />, label: "解释一个概念", description: "通俗易懂地解释复杂概念" },
  { key: "plan", icon: <Sparkles className="h-4 w-4" />, label: "制定计划", description: "规划项目里程碑与任务" },
  { key: "draft", icon: <PenLine className="h-4 w-4" />, label: "起草邮件", description: "撰写商务邮件初稿" },
];

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
        {!threadId && messages.length === 0 ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6">
            <Welcome variant="borderless" icon={<Bot className="h-12 w-12 text-primary" />} title="你好，我是智能助理" description="我可以帮你总结文档、解释概念、制定计划。选择一个提示开始，或直接输入你的问题。" />
            <Prompts className="w-full max-w-2xl" items={QUICK_PROMPTS} onItemClick={({ data }) => void send(String(data.label))} wrap fadeIn />
          </div>
        ) : null}
        {streaming ? <Think loading title="正在思考" defaultExpanded className="mb-2" /> : null}
        <div ref={messageEndRef} aria-hidden />
      </div>
    </div>
    <div className="px-4 pb-4 md:px-8"><ChatComposer value={draft} onChange={setDraft} onSend={(value) => void send(value)} isStreaming={streaming} onStop={stop} /></div>
  </section>;
}
