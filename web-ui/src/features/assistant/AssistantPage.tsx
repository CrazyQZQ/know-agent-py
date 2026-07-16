import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Prompts, Sources, Think, ThoughtChain, Welcome } from "@ant-design/x";
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

const SUGGESTIONS = [
  { label: "总结周报", value: "帮我总结本周工作周报", icon: <FileText className="h-4 w-4" /> },
  { label: "解释概念", value: "请用通俗的语言解释一个概念", icon: <Lightbulb className="h-4 w-4" /> },
  { label: "制定计划", value: "帮我制定一份项目计划", icon: <Sparkles className="h-4 w-4" /> },
  { label: "起草邮件", value: "帮我起草一封商务邮件", icon: <PenLine className="h-4 w-4" /> },
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
  const [thinkingSteps, setThinkingSteps] = useState<Array<{ key: string; title: string; status: "success" | "loading" }>>([]);
  const [sources, setSources] = useState<Array<{ key: string; title: string; description?: string }>>([]);
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
    setThinkingSteps([]);
    setSources([]);
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
          } else if (event.event === "thinking") {
            try {
              const data = JSON.parse(event.data) as { name?: string };
              if (data.name) setThinkingSteps((prev) => [...prev, { key: `${data.name}-${prev.length}`, title: `调用工具：${data.name}`, status: "success" }]);
            } catch { /* ignore */ }
          } else if (event.event === "sources") {
            try {
              const data = JSON.parse(event.data) as Array<{ title?: string; segment_id?: number; score?: number }>;
              setSources(data.map((s, i) => ({ key: String(s.segment_id ?? i), title: s.title ?? "未知文档", description: s.score != null ? `相关度: ${s.score.toFixed(3)}` : undefined })));
            } catch { /* ignore */ }
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
        {messages.map((message, index) => {
          const isLastAssistant = index === messages.length - 1 && message.role === "assistant";
          return (
            <Fragment key={message.id ?? `${index}-${message.role}`}>
              {isLastAssistant && thinkingSteps.length > 0 ? <ThoughtChain items={thinkingSteps} className="mb-2" /> : null}
              {isLastAssistant && streaming && !message.content ? <Think loading title="正在思考" defaultExpanded className="mb-2" /> : null}
              <ChatMessageRow {...message} createdAt={message.createdAt ?? 0} isStreaming={streaming && isLastAssistant} />
              {isLastAssistant && sources.length > 0 ? <Sources title="知识库来源" items={sources} className="mt-2" /> : null}
            </Fragment>
          );
        })}
        {approval ? <ToolApproval title={approval.title} description={approval.description} onApprove={() => void decideApproval("APPROVED")} onReject={() => void decideApproval("REJECTED")} /> : null}
        {messages.length === 0 && !approval ? (
          <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6">
            <Welcome variant="borderless" icon={<Bot className="h-12 w-12 text-primary" />} title="你好，我是智能助理" description="我可以帮你总结文档、解释概念、制定计划。选择一个提示开始，或直接输入你的问题。" />
            <Prompts className="w-full max-w-2xl" items={QUICK_PROMPTS} onItemClick={({ data }) => void send(String(data.label))} wrap fadeIn />
          </div>
        ) : null}
        <div ref={messageEndRef} aria-hidden />
      </div>
    </div>
    <div className="px-4 pb-4 md:px-8"><ChatComposer value={draft} onChange={setDraft} onSend={(value) => void send(value)} isStreaming={streaming} onStop={stop} suggestions={SUGGESTIONS} /></div>
  </section>;
}
