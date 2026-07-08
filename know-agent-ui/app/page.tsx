"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  Database,
  Eye,
  FileText,
  Filter,
  Loader2,
  LogOut,
  MessageSquare,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  Workflow,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  clearAuth,
  deleteDocument as deleteDocumentApi,
  embedDocument,
  listDocuments,
  listRoles,
  listSegmentsByDocument,
  login,
  logout,
  makeMessage,
  readAuth,
  splitDocument,
  streamSse,
  resumeSse,
  uploadDocument as uploadDocumentApi,
  getThreadHistory,
  listThreads,
  type AuthState,
  type RoleItem,
  type ToolFeedback
} from "@/lib/api";
import { documentLifecycle, type ChatMessage, type DocumentItem, type DocumentStatus, type SegmentItem } from "@/lib/mock-data";

type MainTab = "assistant" | "workflow" | "knowledge";

const navItems: Array<{ key: MainTab; label: string; icon: LucideIcon }> = [
  { key: "assistant", label: "智能助理", icon: MessageSquare },
  { key: "workflow", label: "工作流", icon: Workflow },
  { key: "knowledge", label: "知识库管理", icon: Database }
];

const initialAssistantMessage = makeMessage(
  "assistant",
  "已连接 Know-Agent 后端。你可以直接提问，我会通过 /run_sse 流式返回结果。",
  ["POST /run_sse"]
);

export default function Home() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("assistant");
  const [messages, setMessages] = useState<ChatMessage[]>([initialAssistantMessage]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return crypto.randomUUID();
    return window.localStorage.getItem("know-agent-thread") || crypto.randomUUID();
  });
  const [threads, setThreads] = useState<{ thread_id: string }[]>([]);
  const [workflowSession, setWorkflowSession] = useState(false);
  const [workflowMessages, setWorkflowMessages] = useState<ChatMessage[]>([]);
  const [workflowInput, setWorkflowInput] = useState("帮我做一份关于 AI 发展的 PPT，面向技术团队，约 10 页");
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(0);
  const [workflowThreadId] = useState(() => crypto.randomUUID());
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | DocumentStatus>("ALL");
  const [page, setPage] = useState(1);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [busyDocId, setBusyDocId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ action_requests: { name: string; args: Record<string, unknown> }[] } | null>(null);

  const token = auth?.token ?? null;
  const user = auth?.user;
  const activeTitle = useMemo(
    () => navItems.find((item) => item.key === activeTab)?.label ?? "智能助理",
    [activeTab]
  );

  useEffect(() => {
    const stored = readAuth();
    if (stored) setAuth(stored);
  }, []);

  useEffect(() => {
    if (!auth) return;
    refreshDocuments();
    listRoles(token).then(setRoles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  async function refreshDocuments() {
    setLoadingDocs(true);
    setError(null);
    try {
      setDocuments(await listDocuments(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "文档列表加载失败");
    } finally {
      setLoadingDocs(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      setAuth(await login(String(form.get("username")), String(form.get("password"))));
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  async function handleLogout() {
    await logout(token);
    clearAuth();
    setAuth(null);
    setDocuments([]);
    setSegments([]);
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;

    const assistantId = `assistant-${Date.now()}`;
    setInput("");
    setStreaming(true);
    setMessages((current) => [
      ...current,
      makeMessage("user", content),
      { ...makeMessage("assistant", "", ["event: message"]), id: assistantId }
    ]);

    try {
      await streamSse(
        "/run_sse",
        {
          appName: "common_agent",
          userId: user?.name ?? "web",
          threadId,
          newMessage: { content, role: "user" },
          streaming: true,
          stateDelta: null
        },
        token,
        ({ event, data }) => {
          if (event === "done") return;
          if (event === "tool") {
            setMessages((current) => [...current, makeMessage("tool", data, ["event: tool"])]);
            return;
          }
          if (event === "interrupt") {
            // HITL 工具审批：解析待审批工具，展示审批 UI
            try {
              const hitl = JSON.parse(data) as { action_requests: { name: string; args: Record<string, unknown> }[] };
              setPendingApproval(hitl);
              setMessages((current) => [
                ...current,
                makeMessage("assistant", `⚠️ 工具 ${hitl.action_requests.map((r) => r.name).join(", ")} 需要审批`, ["event: interrupt"])
              ]);
            } catch {
              setMessages((current) => [...current, makeMessage("assistant", "收到审批请求", ["event: interrupt"])]);
            }
            return;
          }
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${data}` }
                : message
            )
          );
        }
      );
    } catch (err) {
      setMessages((current) => [
        ...current.filter((message) => message.id !== assistantId || message.content),
        makeMessage("assistant", err instanceof Error ? err.message : "对话请求失败", ["error"])
      ]);
    } finally {
      setStreaming(false);
    }
  }

  async function approveTool(result: "APPROVED" | "REJECTED") {
    if (!pendingApproval || !token) return;
    const feedbacks: ToolFeedback[] = pendingApproval.action_requests.map((r) => ({
      id: r.name,
      name: r.name,
      result
    }));
    setPendingApproval(null);
    const assistantId = `assistant-${Date.now()}`;
    setMessages((current) => [...current, { ...makeMessage("assistant", "", ["event: resume"]), id: assistantId }]);
    setStreaming(true);
    try {
      await resumeSse(threadId, feedbacks, token, ({ event, data }) => {
        if (event === "done") return;
        if (event === "tool") {
          setMessages((current) => [...current, makeMessage("tool", data, ["event: tool"])]);
          return;
        }
        if (event === "interrupt") {
          try {
            const hitl = JSON.parse(data) as { action_requests: { name: string; args: Record<string, unknown> }[] };
            setPendingApproval(hitl);
          } catch { /* ignore */ }
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: `${message.content}${data}` } : message
          )
        );
      });
    } catch (err) {
      setMessages((current) => [
        ...current,
        makeMessage("assistant", err instanceof Error ? err.message : "恢复失败", ["error"])
      ]);
    } finally {
      setStreaming(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("know-agent-thread", threadId);
  }, [threadId]);

  async function loadThreads() {
    if (!token || !user) return;
    try {
      const data = await listThreads(token, "common_agent", user.name);
      setThreads(data);
    } catch { /* ignore */ }
  }

  async function loadHistory(tid: string) {
    if (!token || !user) return;
    try {
      const history = await getThreadHistory(token, "common_agent", user.name, tid);
      setMessages([
        initialAssistantMessage,
        ...history.map((h) => makeMessage(h.role === "user" ? "user" : "assistant", h.content))
      ]);
    } catch {
      setMessages([initialAssistantMessage]);
    }
  }

  function createNewThread() {
    setThreadId(crypto.randomUUID());
    setMessages([initialAssistantMessage]);
    setPendingApproval(null);
  }

  function switchThread(tid: string) {
    setThreadId(tid);
    setPendingApproval(null);
    loadHistory(tid);
  }

  useEffect(() => {
    if (activeTab === "assistant" && token) loadThreads();
  }, [activeTab, token]);

  async function runWorkflow() {
    const content = workflowInput.trim();
    if (!content || workflowRunning) return;
    setWorkflowSession(true);
    setWorkflowRunning(true);
    setWorkflowStep(0);
    setWorkflowMessages([makeMessage("user", content)]);

    try {
      await streamSse(
        "/graph_run_sse",
        {
          graphName: "ppt_build",
          userId: user?.name ?? "web",
          threadId: workflowThreadId,
          newMessage: { content, role: "user" },
          inputs: null
        },
        token,
        ({ event, data }) => {
          if (event === "update") {
            const update = JSON.parse(data) as { node: string; values: Record<string, unknown> };
            setWorkflowStep((current) => current + 1);
            setWorkflowMessages((current) => [
              ...current,
              makeMessage("tool", `${update.node} 完成\n${JSON.stringify(update.values, null, 2)}`, ["event: update"])
            ]);
          } else if (event === "interrupt") {
            const interrupt = JSON.parse(data) as { clarification?: string };
            setWorkflowMessages((current) => [
              ...current,
              makeMessage("assistant", interrupt.clarification || "需要补充需求信息。", ["event: interrupt"])
            ]);
          } else if (event === "done") {
            const done = JSON.parse(data) as { ppt_result?: string };
            setWorkflowMessages((current) => [
              ...current,
              makeMessage("assistant", done.ppt_result ? `PPT 已生成：${done.ppt_result}` : "工作流已完成。", ["event: done"])
            ]);
          }
        }
      );
    } catch (err) {
      setWorkflowMessages((current) => [
        ...current,
        makeMessage("assistant", err instanceof Error ? err.message : "工作流启动失败", ["error"])
      ]);
    } finally {
      setWorkflowRunning(false);
    }
  }

  async function resumeWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = workflowInput.trim();
    if (!content || workflowRunning) return;
    setWorkflowRunning(true);
    setWorkflowMessages((current) => [...current, makeMessage("user", content)]);
    setWorkflowInput("");
    try {
      await streamSse(
        "/graph_resume_sse",
        { graphName: "ppt_build", userId: user?.name ?? "web", threadId: workflowThreadId, clarificationResponse: content },
        token,
        ({ event, data }) => {
          if (event === "done") {
            const done = JSON.parse(data) as { ppt_result?: string };
            setWorkflowMessages((current) => [
              ...current,
              makeMessage("assistant", done.ppt_result ? `PPT 已生成：${done.ppt_result}` : "工作流已完成。", ["event: done"])
            ]);
          } else if (event !== "message") {
            setWorkflowMessages((current) => [...current, makeMessage("tool", data, [`event: ${event}`])]);
          }
        }
      );
    } catch (err) {
      setWorkflowMessages((current) => [...current, makeMessage("assistant", err instanceof Error ? err.message : "恢复工作流失败", ["error"])]);
    } finally {
      setWorkflowRunning(false);
    }
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    if (!(form.get("file") instanceof File) || (form.get("file") as File).size === 0) {
      setError("请先选择要上传的文件");
      return;
    }
    try {
      const doc = await uploadDocumentApi(token, form);
      setDocuments((current) => [doc, ...current]);
      setShowUpload(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    }
  }

  async function deleteDocument(docId: number) {
    if (!window.confirm("确定删除这个文档及其切片吗？")) return;
    setBusyDocId(docId);
    try {
      await deleteDocumentApi(token, docId);
      setDocuments((current) => current.filter((doc) => doc.docId !== docId));
      setSelectedDocId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyDocId(null);
    }
  }

  async function updateDocumentStatus(docId: number, status: DocumentStatus) {
    setBusyDocId(docId);
    try {
      if (status === "CHUNKED") await splitDocument(token, docId);
      if (status === "VECTOR_STORED") await embedDocument(token, docId);
      await refreshDocuments();
      if (selectedDocId === docId) setSegments(await listSegmentsByDocument(token, docId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "状态更新失败");
    } finally {
      setBusyDocId(null);
    }
  }

  async function selectDocument(docId: number) {
    setSelectedDocId(docId);
    setSegments([]);
    try {
      setSegments(await listSegmentsByDocument(token, docId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切片加载失败");
    }
  }

  if (!auth) return <LoginView onLogin={handleLogin} error={error} />;

  return (
    <main className="h-screen overflow-hidden bg-[#f7f7f4] text-[#0d0d0d]">
      <div className="grid h-screen min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex h-screen min-h-0 flex-col border-r border-[#deded8] bg-[#fbfbf8]">
          <div className="flex h-16 items-center gap-3 border-b border-[#e7e7e1] px-4">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#0d0d0d] text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Know-Agent</h1>
              <p className="truncate text-xs text-[#7a7a73]">智能体控制台</p>
            </div>
          </div>
          <nav className="grid gap-1 p-3">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={clsx(
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
                  activeTab === item.key ? "bg-[#ecece7]" : "text-[#5f5f5a] hover:bg-[#f0f0eb]"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>
          {activeTab === "assistant" ? (
            <div className="px-3 pb-2">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold text-[#7a7a73]">会话</span>
                <button onClick={createNewThread} className="text-xs text-[#5f5f5a] hover:text-[#0d0d0d]">+ 新建</button>
              </div>
              <div className="grid max-h-48 gap-1 overflow-y-auto">
                {threads.map((t) => (
                  <button key={t.thread_id} onClick={() => switchThread(t.thread_id)} className={clsx("truncate rounded-lg px-3 py-2 text-left text-xs", t.thread_id === threadId ? "bg-[#ecece7] font-medium" : "text-[#5f5f5a] hover:bg-[#f0f0eb]")}>
                    {t.thread_id.slice(0, 8)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-auto border-t border-[#e7e7e1] p-3">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[#ecece7]">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user?.name}</p>
                <p className="truncate text-xs text-[#7a7a73]">{user?.roles.join(", ") || "无角色"}</p>
              </div>
              <button onClick={handleLogout} className="grid h-8 w-8 place-items-center rounded-lg text-[#77776f] hover:bg-[#eeeeea]" aria-label="退出登录" title="退出登录">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <section className="flex h-screen min-h-0 min-w-0 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-[#e7e7e1] bg-[#fbfbf8] px-5">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{activeTitle}</h2>
              <p className="truncate text-xs text-[#7a7a73]">
                {activeTab === "assistant" && "流式智能体对话"}
                {activeTab === "workflow" && "运行后端 PPT Graph"}
                {activeTab === "knowledge" && "文档、切片和向量化管理"}
              </p>
            </div>
            {error ? <div className="rounded-lg bg-[#fff1f1] px-3 py-2 text-sm text-[#a33a3a]">{error}</div> : null}
          </header>

          {activeTab === "assistant" && (
            <AssistantView input={input} messages={messages} streaming={streaming} setInput={setInput} sendMessage={sendMessage} pendingApproval={pendingApproval} onApprove={() => approveTool("APPROVED")} onReject={() => approveTool("REJECTED")} />
          )}
          {activeTab === "workflow" && (
            <WorkflowView
              workflowSession={workflowSession}
              workflowMessages={workflowMessages}
              workflowInput={workflowInput}
              workflowRunning={workflowRunning}
              workflowStep={workflowStep}
              setWorkflowInput={setWorkflowInput}
              runWorkflow={runWorkflow}
              resumeWorkflow={resumeWorkflow}
              backToWorkflowHome={() => setWorkflowSession(false)}
            />
          )}
          {activeTab === "knowledge" && (
            <KnowledgeView
              documents={documents}
              segments={segments}
              roles={roles}
              selectedDocId={selectedDocId}
              showUpload={showUpload}
              docSearch={docSearch}
              statusFilter={statusFilter}
              page={page}
              loadingDocs={loadingDocs}
              busyDocId={busyDocId}
              setSelectedDocId={setSelectedDocId}
              selectDocument={selectDocument}
              setShowUpload={setShowUpload}
              setDocSearch={setDocSearch}
              setStatusFilter={setStatusFilter}
              setPage={setPage}
              uploadDocument={uploadDocument}
              deleteDocument={deleteDocument}
              updateDocumentStatus={updateDocumentStatus}
              refreshDocuments={refreshDocuments}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function LoginView({ onLogin, error }: { onLogin: (event: FormEvent<HTMLFormElement>) => void; error: string | null }) {
  return (
    <main className="grid min-h-screen bg-[#f7f7f4] text-[#0d0d0d] lg:grid-cols-[minmax(0,1fr)_440px]">
      <section className="flex min-h-[420px] flex-col justify-between border-r border-[#deded8] bg-[#fbfbf8] p-8">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#0d0d0d] text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Know-Agent</h1>
            <p className="text-sm text-[#6f6f68]">Web 智能体控制台</p>
          </div>
        </div>
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase text-[#8b8b83]">Agent workspace</p>
          <h2 className="mt-5 max-w-2xl text-5xl font-semibold leading-tight">知识库、工作流和对话智能体的统一入口</h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#66665f]">登录后可直接调用后端 API，进行智能体对话、PPT Graph 运行和知识库管理。</p>
        </div>
        <div className="grid max-w-2xl gap-3 md:grid-cols-3">
          <LoginFeature icon={MessageSquare} title="智能助理" />
          <LoginFeature icon={Workflow} title="工作流" />
          <LoginFeature icon={Database} title="知识库管理" />
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={onLogin} className="w-full max-w-sm rounded-xl border border-[#deded8] bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">登录</h2>
          <p className="mt-1 text-sm text-[#6f6f68]">调用 POST /api/auth/login 获取 Casdoor token。</p>
          <FormField name="username" label="用户名" defaultValue="lxqq" className="mt-5" />
          <FormField name="password" label="密码" defaultValue="Lxqq0912!" type="password" className="mt-4" />
          {error ? <p className="mt-4 rounded-lg bg-[#fff1f1] px-3 py-2 text-sm text-[#a33a3a]">{error}</p> : null}
          <button className="mt-5 h-11 w-full rounded-lg bg-[#0d0d0d] text-sm font-semibold text-white transition hover:bg-black">进入控制台</button>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#f2f7f4] px-3 py-2 text-xs font-medium text-[#31745b]">
            <ShieldCheck className="h-4 w-4" />
            认证关闭时后端可能不需要 token，但登录接口仍依赖 Casdoor 配置。
          </div>
        </form>
      </section>
    </main>
  );
}

function AssistantView({ input, messages, streaming, setInput, sendMessage, pendingApproval, onApprove, onReject }: { input: string; messages: ChatMessage[]; streaming: boolean; setInput: (value: string) => void; sendMessage: (event: FormEvent<HTMLFormElement>) => void; pendingApproval: { action_requests: { name: string; args: Record<string, unknown> }[] } | null; onApprove: () => void; onReject: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, pendingApproval]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f4]">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        <div className="mx-auto grid max-w-3xl gap-5 pb-4">
          {messages.map((message) => <ChatMessageRow key={message.id} message={message} />)}
          {streaming ? <div className="flex items-center gap-2 pl-11 text-sm text-[#77776f]"><Loader2 className="h-4 w-4 animate-spin" /> 正在生成</div> : null}
          {pendingApproval ? (
            <div className="mx-auto max-w-3xl rounded-2xl border border-[#e6c969] bg-[#fffbeb] p-4">
              <div className="text-sm font-semibold text-[#7a5c00]">工具审批</div>
              <div className="mt-2 space-y-1">
                {pendingApproval.action_requests.map((r, i) => (
                  <div key={i} className="text-sm text-[#5c4400]">
                    <span className="font-mono font-semibold">{r.name}</span>
                    <span className="ml-2 text-[#8a8a82]">{JSON.stringify(r.args)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={onApprove} disabled={streaming} className="h-9 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white disabled:opacity-40">批准执行</button>
                <button onClick={onReject} disabled={streaming} className="h-9 rounded-lg border border-[#f0c4c4] px-4 text-sm font-semibold text-[#a33a3a] hover:bg-[#fff1f1] disabled:opacity-40">拒绝</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <form onSubmit={sendMessage} className="shrink-0 bg-[#f7f7f4] px-4 pb-5 pt-2">
        <div className="mx-auto max-w-3xl rounded-[22px] border border-[#d9d9d2] bg-white p-2 shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Message Know-Agent"
            rows={1}
            className="max-h-40 min-h-12 w-full resize-none bg-transparent px-3 py-3 text-[15px] leading-6 text-[#20201d] outline-none placeholder:text-[#8a8a82]"
          />
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="rounded-full border border-[#e6e6df] px-2 py-1 text-xs text-[#8a8a82]">Shift + Enter 换行</span>
            <button disabled={!input.trim() || streaming} className="grid h-9 w-9 place-items-center rounded-full bg-[#0d0d0d] text-white transition hover:bg-black disabled:bg-[#d7d7d0] disabled:text-[#8a8a82]" aria-label="发送">
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function WorkflowView({ workflowSession, workflowMessages, workflowInput, workflowRunning, workflowStep, setWorkflowInput, runWorkflow, resumeWorkflow, backToWorkflowHome }: { workflowSession: boolean; workflowMessages: ChatMessage[]; workflowInput: string; workflowRunning: boolean; workflowStep: number; setWorkflowInput: (value: string) => void; runWorkflow: () => void; resumeWorkflow: (event: FormEvent<HTMLFormElement>) => void; backToWorkflowHome: () => void }) {
  const workflowScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workflowScrollRef.current?.scrollTo({ top: workflowScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [workflowMessages, workflowRunning]);

  if (!workflowSession) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-5">
          <h3 className="text-xl font-semibold">PPT 生成工作流</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">提交需求后调用 /graph_run_sse，后端会推送节点 update、interrupt 和 done。</p>
        </div>
        <article className="max-w-2xl rounded-xl border border-[#deded8] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#f0f0eb]">
              <Presentation className="h-5 w-5" />
            </div>
            <ToolPill>graph_run_sse</ToolPill>
          </div>
          <label className="grid gap-2 text-sm font-medium text-[#5f5f5a]">
            PPT 需求
            <textarea value={workflowInput} onChange={(event) => setWorkflowInput(event.target.value)} rows={5} className="resize-none rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] p-3 text-sm text-[#0d0d0d] outline-none focus:border-[#0d0d0d]" />
          </label>
          <button onClick={runWorkflow} disabled={!workflowInput.trim() || workflowRunning} className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white disabled:opacity-40">
            <Play className="h-4 w-4" /> 启动工作流
          </button>
        </article>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-[#e7e7e1] p-4">
        <button onClick={backToWorkflowHome} className="text-sm font-semibold text-[#5f5f5a] hover:text-[#0d0d0d]">返回工作流</button>
        <ToolPill>已完成节点 {workflowStep}</ToolPill>
      </div>
      <div ref={workflowScrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid max-w-4xl gap-4">
          {workflowMessages.map((message) => <ChatMessageRow key={message.id} message={message} />)}
          {workflowRunning ? <div className="flex items-center gap-2 text-sm text-[#77776f]"><Loader2 className="h-4 w-4 animate-spin" /> 工作流运行中</div> : null}
        </div>
      </div>
      <form onSubmit={resumeWorkflow} className="border-t border-[#e7e7e1] bg-[#fbfbf8] p-4">
        <div className="mx-auto flex max-w-4xl items-center gap-2 rounded-xl border border-[#deded8] bg-white p-2">
          <input value={workflowInput} onChange={(event) => setWorkflowInput(event.target.value)} placeholder="如收到 interrupt，在这里补充说明" className="h-10 flex-1 bg-transparent px-3 text-sm outline-none" />
          <button disabled={!workflowInput.trim() || workflowRunning} className="h-10 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white disabled:opacity-40">继续</button>
        </div>
      </form>
    </div>
  );
}

function KnowledgeView({ documents, segments, roles, selectedDocId, showUpload, docSearch, statusFilter, page, loadingDocs, busyDocId, setSelectedDocId, selectDocument, setShowUpload, setDocSearch, setStatusFilter, setPage, uploadDocument, deleteDocument, updateDocumentStatus, refreshDocuments }: { documents: DocumentItem[]; segments: SegmentItem[]; roles: RoleItem[]; selectedDocId: number | null; showUpload: boolean; docSearch: string; statusFilter: "ALL" | DocumentStatus; page: number; loadingDocs: boolean; busyDocId: number | null; setSelectedDocId: (value: number | null) => void; selectDocument: (docId: number) => void; setShowUpload: (value: boolean) => void; setDocSearch: (value: string) => void; setStatusFilter: (value: "ALL" | DocumentStatus) => void; setPage: (value: number) => void; uploadDocument: (event: FormEvent<HTMLFormElement>) => void; deleteDocument: (docId: number) => void; updateDocumentStatus: (docId: number, status: DocumentStatus) => void; refreshDocuments: () => void }) {
  const selectedDoc = documents.find((doc) => doc.docId === selectedDocId) ?? null;
  const filteredDocs = documents.filter((doc) => {
    const keyword = docSearch.trim().toLowerCase();
    const matchesKeyword = !keyword || doc.docTitle.toLowerCase().includes(keyword) || doc.description.toLowerCase().includes(keyword) || doc.uploadUser.toLowerCase().includes(keyword);
    const matchesStatus = statusFilter === "ALL" || doc.status === statusFilter;
    return matchesKeyword && matchesStatus;
  });
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(filteredDocs.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedDocs = filteredDocs.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [docSearch, statusFilter, setPage]);

  if (selectedDoc) {
    return (
      <DocumentDetail
        doc={selectedDoc}
        segments={segments}
        busy={busyDocId === selectedDoc.docId}
        onBack={() => setSelectedDocId(null)}
        onDelete={() => deleteDocument(selectedDoc.docId)}
        onUpdateStatus={(status) => updateDocumentStatus(selectedDoc.docId, status)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold">文档管理</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">数据来自 /api/document/page，可执行上传、删除、分块和向量化。</p>
        </div>
        <button onClick={() => setShowUpload(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white">
          <UploadCloud className="h-4 w-4" /> 上传文档
        </button>
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#deded8] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e7e7e1] p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex h-10 min-w-[280px] items-center gap-2 rounded-lg border border-[#deded8] bg-[#fbfbf8] px-3">
            <Search className="h-4 w-4 text-[#8a8a82]" />
            <input value={docSearch} onChange={(event) => setDocSearch(event.target.value)} placeholder="按标题、描述、上传人搜索" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a82]" />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | DocumentStatus)} className="h-10 rounded-lg border border-[#deded8] bg-white pl-9 pr-3 text-sm font-medium outline-none">
                {["ALL", "CONVERTED", "CHUNKED", "VECTOR_STORED", "STORED"].map((status) => <option key={status} value={status}>{status === "ALL" ? "全部状态" : statusLabel(status as DocumentStatus)}</option>)}
              </select>
            </div>
            <button onClick={refreshDocuments} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#deded8] bg-white px-3 text-sm font-semibold text-[#4f4f49] hover:bg-[#f3f3ef]">
              <RefreshCw className={clsx("h-4 w-4", loadingDocs && "animate-spin")} /> 刷新
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-[#fbfbf8] text-xs uppercase text-[#77776f]">
              <tr>{["ID", "标题", "类型", "上传人", "状态", "更新时间", "操作"].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 font-semibold">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#e6e6df]">
              {pagedDocs.map((doc) => (
                <tr key={doc.docId}>
                  <td className="px-4 py-3 font-medium">{doc.docId}</td>
                  <td className="px-4 py-3 font-semibold">{doc.docTitle}</td>
                  <td className="px-4 py-3">{doc.knowledgeBaseType}</td>
                  <td className="px-4 py-3">{doc.uploadUser}</td>
                  <td className="px-4 py-3"><StatusBadge status={doc.status} /></td>
                  <td className="px-4 py-3 text-[#6f6f68]">{doc.updatedAt}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => selectDocument(doc.docId)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#deded8] px-2 text-xs font-semibold hover:bg-[#f3f3ef]"><Eye className="h-3.5 w-3.5" /> 查看</button>
                      <button onClick={() => deleteDocument(doc.docId)} disabled={busyDocId === doc.docId} className="h-8 rounded-lg border border-[#f0c4c4] px-2 text-xs font-semibold text-[#a33a3a] hover:bg-[#fff1f1] disabled:opacity-40">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loadingDocs ? <div className="p-10 text-center text-sm text-[#77776f]">正在加载文档...</div> : null}
          {!loadingDocs && filteredDocs.length === 0 ? <div className="p-10 text-center text-sm text-[#77776f]">没有匹配的文档</div> : null}
        </div>
        <div className="flex flex-col gap-3 border-t border-[#e7e7e1] px-4 py-3 text-sm text-[#6f6f68] md:flex-row md:items-center md:justify-between">
          <span>共 {filteredDocs.length} 条，当前第 {safePage} / {pageCount} 页</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="h-8 rounded-lg border border-[#deded8] px-3 font-semibold disabled:opacity-40">上一页</button>
            <button onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount} className="h-8 rounded-lg border border-[#deded8] px-3 font-semibold disabled:opacity-40">下一页</button>
          </div>
        </div>
      </section>
      {showUpload ? <UploadDialog roles={roles} onClose={() => setShowUpload(false)} onSubmit={uploadDocument} /> : null}
    </div>
  );
}

function DocumentDetail({ doc, segments, busy, onBack, onDelete, onUpdateStatus }: { doc: DocumentItem; segments: SegmentItem[]; busy: boolean; onBack: () => void; onDelete: () => void; onUpdateStatus: (status: DocumentStatus) => void }) {
  const visibleLifecycle = documentLifecycle.filter((item) => doc.knowledgeBaseType === "DATA_QUERY" ? item.status !== "VECTOR_STORED" : item.status !== "STORED");
  const lifecycleIndex = visibleLifecycle.findIndex((item) => item.status === doc.status);
  const nextActions = doc.status === "CONVERTED" ? [{ label: "执行分块", status: "CHUNKED" as const }] : doc.status === "CHUNKED" ? [{ label: "执行向量化", status: "VECTOR_STORED" as const }] : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <button onClick={onBack} className="mb-2 text-sm font-semibold text-[#5f5f5a] hover:text-[#0d0d0d]">返回文档列表</button>
          <h3 className="text-xl font-semibold">{doc.docTitle}</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">{doc.description || "无描述"}</p>
        </div>
        <div className="flex gap-2">
          {nextActions.map((item) => <button key={item.label} onClick={() => onUpdateStatus(item.status)} disabled={busy} className="h-10 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white disabled:opacity-40">{busy ? "处理中..." : item.label}</button>)}
          <button onClick={onDelete} disabled={busy} className="h-10 rounded-lg border border-[#f0c4c4] px-4 text-sm font-semibold text-[#a33a3a] hover:bg-[#fff1f1] disabled:opacity-40">删除</button>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-xl border border-[#deded8] bg-white p-5">
          <h4 className="mb-4 font-semibold">基本信息</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <InfoItem label="文档 ID" value={String(doc.docId)} />
            <InfoItem label="上传人" value={doc.uploadUser} />
            <InfoItem label="知识库类型" value={doc.knowledgeBaseType} />
            <InfoItem label="可访问角色" value={doc.accessibleBy} />
            <InfoItem label="创建时间" value={doc.createdAt} />
            <InfoItem label="更新时间" value={doc.updatedAt} />
            <InfoItem label="当前状态" value={doc.status} />
            <InfoItem label="切片数量" value={String(segments.length)} />
          </div>
        </section>
        <section className="rounded-xl border border-[#deded8] bg-white p-5">
          <h4 className="mb-4 font-semibold">状态时间线</h4>
          <div className="space-y-4">
            {visibleLifecycle.map((item, index) => {
              const done = lifecycleIndex >= index;
              const isCurrent = item.status === doc.status;
              return (
                <div key={item.status} className="flex gap-3">
                  <div className={clsx("mt-0.5 grid h-7 w-7 place-items-center rounded-full border", isCurrent ? "border-[#0d0d0d] bg-[#0d0d0d] text-white" : done ? "border-[#95d5b2] bg-[#effaf4] text-[#26734d]" : "border-[#deded8] bg-white text-[#9a9a91]")}><Check className="h-3.5 w-3.5" /></div>
                  <div><p className="text-sm font-semibold">{item.label}</p><p className="text-xs text-[#77776f]">{item.status}</p></div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <section className="mt-5 rounded-xl border border-[#deded8] bg-white p-5">
        <h4 className="mb-4 font-semibold">文档切片列表</h4>
        <div className="overflow-x-auto rounded-xl border border-[#e6e6df]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#fbfbf8] text-xs uppercase text-[#77776f]"><tr>{["ID", "chunk_id", "order", "status", "text"].map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#e6e6df]">
              {segments.map((segment) => <tr key={segment.id}><td className="px-4 py-3">{segment.id}</td><td className="px-4 py-3">{segment.chunkId}</td><td className="px-4 py-3">{segment.chunkOrder}</td><td className="px-4 py-3">{segment.status}</td><td className="max-w-[620px] px-4 py-3 text-[#5f5f5a]">{segment.text}</td></tr>)}
            </tbody>
          </table>
          {segments.length === 0 ? <div className="p-8 text-center text-sm text-[#77776f]">当前文档还没有切片。</div> : null}
        </div>
      </section>
    </div>
  );
}

function UploadDialog({ roles, onClose, onSubmit }: { roles: RoleItem[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-lg rounded-xl border border-[#deded8] bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><h3 className="text-lg font-semibold">上传文档</h3><p className="mt-1 text-sm text-[#6f6f68]">调用 /api/document/upload，同步完成解析后进入 CONVERTED。</p></div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-[#6f6f68] hover:bg-[#f3f3ef]" aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3">
          <FormField name="title" label="文档标题" defaultValue="新文档" />
          <FormField name="uploadUser" label="上传人" defaultValue="web" />
          <FormField name="description" label="描述" defaultValue="" />
          <label className="grid gap-1.5"><span className="text-sm font-medium text-[#5f5f5a]">知识库类型</span><select name="knowledgeBaseType" defaultValue="DOCUMENT_SEARCH" className="h-10 rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] px-3 text-sm outline-none"><option value="DOCUMENT_SEARCH">文档检索</option><option value="DATA_QUERY">数据查询</option></select></label>
          <FormField name="tableName" label="表名（DATA_QUERY 可选）" defaultValue="" />
          <label className="grid gap-1.5"><span className="text-sm font-medium text-[#5f5f5a]">可访问角色</span><select name="accessibleBy" multiple className="min-h-24 rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] px-3 py-2 text-sm outline-none">{roles.map((role) => <option key={role.name} value={role.name}>{role.displayName || role.name}</option>)}</select><span className="text-xs text-[#8a8a82]">不选则按公开文档处理。</span></label>
          <label className="grid gap-1.5"><span className="text-sm font-medium text-[#5f5f5a]">文件</span><input name="file" type="file" required className="rounded-lg border border-dashed border-[#d8d8d2] bg-[#fbfbf8] px-3 py-3 text-sm" /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-lg border border-[#deded8] px-4 text-sm font-semibold">取消</button><button className="h-10 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white">上传</button></div>
      </form>
    </div>
  );
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  return (
    <div className={clsx("flex gap-3", isUser && "justify-end")}>
      {!isUser ? <div className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full", isTool ? "bg-[#fff6df] text-[#8a6417]" : "bg-[#0d0d0d] text-white")}>{isTool ? <Search className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div> : null}
      <div className={clsx("max-w-[min(78%,720px)] rounded-2xl px-4 py-3 text-sm leading-6", isUser ? "bg-[#0d0d0d] text-white shadow-sm" : isTool ? "border border-[#ead49a] bg-[#fff9e8] text-[#5f4612]" : "text-[#2f2f2b]")}>
        {isUser || isTool ? (
          <p className="whitespace-pre-wrap">{message.content || "..."}</p>
        ) : (
          <MarkdownMessage content={message.content || "..."} />
        )}
      </div>
      {isUser ? <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ecece7]"><UserRound className="h-4 w-4" /></div> : null}
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ className, ...props }) => (
            <a className={clsx("font-medium text-[#2563eb] underline underline-offset-2", className)} target="_blank" rel="noreferrer" {...props} />
          ),
          code: ({ className, children, ...props }) => {
            const inline = !className;
            return inline ? (
              <code className="rounded-md bg-[#eeeeea] px-1.5 py-0.5 font-mono text-[0.9em]" {...props}>{children}</code>
            ) : (
              <code className={className} {...props}>{children}</code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const styles: Record<DocumentStatus, string> = {
    CONVERTED: "bg-[#eef0ff] text-[#4c5aac]",
    CHUNKED: "bg-[#fff6df] text-[#8a6417]",
    VECTOR_STORED: "bg-[#effaf4] text-[#26734d]",
    STORED: "bg-[#eef7ff] text-[#28628a]"
  };
  return <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", styles[status])}>{statusLabel(status)}</span>;
}

function statusLabel(status: DocumentStatus) {
  const labels: Record<DocumentStatus, string> = {
    CONVERTED: "解析完成",
    CHUNKED: "分块完成",
    VECTOR_STORED: "向量入库",
    STORED: "已入库"
  };
  return labels[status] ?? status;
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[#fbfbf8] p-3"><p className="text-xs font-medium text-[#77776f]">{label}</p><p className="mt-1 break-words text-sm font-semibold">{value}</p></div>;
}

function FormField({ name, label, defaultValue, type = "text", className }: { name: string; label: string; defaultValue: string; type?: string; className?: string }) {
  return <label className={clsx("grid gap-1.5", className)}><span className="text-sm font-medium text-[#5f5f5a]">{label}</span><input name={name} defaultValue={defaultValue} type={type} className="h-10 rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#0d0d0d]" /></label>;
}

function LoginFeature({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-[#deded8] bg-white p-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#f0f0eb]"><Icon className="h-4 w-4" /></div><p className="text-sm font-semibold">{title}</p></div>;
}

function ToolPill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full bg-[#f0f0eb] px-2 text-xs font-medium text-[#5f5f5a]">{children}</span>;
}
