"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  FileText,
  Filter,
  Layers3,
  Loader2,
  LogOut,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Play,
  Plus,
  Presentation,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserRound,
  Workflow,
  RefreshCw,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import {
  chatMessages,
  documentLifecycle,
  documents,
  graphSteps,
  searchResults,
  segments,
  streamingReply,
  threads,
  uploadDefaults,
  userProfile,
  type ChatMessage,
  type DocumentItem,
  type DocumentStatus
} from "@/lib/mock-data";

type MainTab = "assistant" | "workflow" | "knowledge";

const navItems: Array<{
  key: MainTab;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "assistant", label: "智能助理", icon: MessageSquare },
  { key: "workflow", label: "工作流", icon: Workflow },
  { key: "knowledge", label: "知识库管理", icon: Database }
];

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<MainTab>("assistant");
  const [messages, setMessages] = useState<ChatMessage[]>(chatMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeWorkflow, setActiveWorkflow] = useState("ppt_build");
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(2);
  const [workflowSession, setWorkflowSession] = useState(false);
  const [workflowMessages, setWorkflowMessages] = useState<ChatMessage[]>([]);
  const [workflowInput, setWorkflowInput] = useState("");
  const [knowledgeDocs, setKnowledgeDocs] = useState<DocumentItem[]>(documents);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | DocumentStatus>("ALL");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);

  const activeTitle = useMemo(
    () => navItems.find((item) => item.key === activeTab)?.label ?? "智能助理",
    [activeTab]
  );

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggedIn(true);
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || streaming) return;

    const time = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
    const assistantId = `assistant-${Date.now()}`;

    setInput("");
    setStreaming(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", content, time },
      {
        id: `tool-${Date.now()}`,
        role: "tool",
        content:
          "正在调用知识库检索工具：GET /api/document/search?mode=hybrid，随后通过 POST /run_sse 继续流式输出。",
        time,
        sources: ["tool", "hybrid search"]
      }
    ]);

    let index = 0;
    const timer = window.setInterval(() => {
      index += 5;
      setMessages((current) => {
        const withoutDraft = current.filter((message) => message.id !== assistantId);
        return [
          ...withoutDraft,
          {
            id: assistantId,
            role: "assistant",
            content: streamingReply.slice(0, index),
            time,
            sources: ["event: message", "event: done"]
          }
        ];
      });

      if (index >= streamingReply.length) {
        window.clearInterval(timer);
        setStreaming(false);
      }
    }, 34);
  }

  function runWorkflow() {
    setWorkflowSession(true);
    setWorkflowRunning(true);
    setWorkflowStep(0);
    const time = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
    const request =
      activeWorkflow === "ppt_build"
        ? "帮我做一份关于 AI 发展的 PPT，面向技术团队，约 10 页"
        : "上传产品手册.pdf，按 SMART 策略分块并写入向量库";
    setWorkflowMessages([
      {
        id: `workflow-user-${Date.now()}`,
        role: "user",
        time,
        content: request
      },
      {
        id: `workflow-assistant-${Date.now()}`,
        role: "assistant",
        time,
        content:
          activeWorkflow === "ppt_build"
            ? "已启动 ppt_build。接下来会按 requirement、search、template、outline、render 节点推送 update 事件。"
            : "已启动 document_ingest。接下来会模拟上传解析、智能分块、向量入库和检索验证。",
        sources: ["workflow started"]
      }
    ]);
    let next = 0;
    const timer = window.setInterval(() => {
      next += 1;
      setWorkflowStep(next);
      const step =
        activeWorkflow === "ppt_build"
          ? graphSteps[next]
          : [
              { label: "上传解析", detail: "POST /api/document/upload" },
              { label: "智能分块", detail: "POST /api/document/split/{id}" },
              { label: "向量入库", detail: "POST /api/document/embedding/{id}" },
              { label: "检索验证", detail: "GET /api/document/search" }
            ][next];
      if (step) {
        setWorkflowMessages((current) => [
          ...current,
          {
            id: `workflow-step-${Date.now()}-${next}`,
            role: "tool",
            time: new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            content: `${step.label} 完成：${step.detail}`,
            sources: ["event: update"]
          }
        ]);
      }
      if (next >= graphSteps.length - 1) {
        window.clearInterval(timer);
        setWorkflowRunning(false);
        setWorkflowMessages((current) => [
          ...current,
          {
            id: `workflow-done-${Date.now()}`,
            role: "assistant",
            time: new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            content:
              activeWorkflow === "ppt_build"
                ? "工作流已完成，mock 返回 ppt_result：https://oss.example/output.pptx"
                : "文档入库工作流已完成，mock 状态已到 VECTOR_STORED。",
            sources: ["event: done"]
          }
        ]);
      }
    }, 720);
  }

  function backToWorkflowHome() {
    setWorkflowSession(false);
    setWorkflowRunning(false);
    setWorkflowStep(2);
    setWorkflowInput("");
  }

  function sendWorkflowMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = workflowInput.trim();
    if (!content) return;
    const time = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit"
    });
    setWorkflowInput("");
    setWorkflowMessages((current) => [
      ...current,
      { id: `workflow-user-${Date.now()}`, role: "user", content, time },
      {
        id: `workflow-reply-${Date.now()}`,
        role: "assistant",
        content:
          "已收到补充信息。当前是 mock 运行态，真实接入时这里会调用 graph_resume_sse 或继续当前工作流上下文。",
        time,
        sources: ["graph_resume_sse"]
      }
    ]);
  }

  function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || uploadDefaults.title);
    const type = String(form.get("knowledgeBaseType") || "DOCUMENT_SEARCH") as
      | "DOCUMENT_SEARCH"
      | "DATA_QUERY";
    const now = new Date().toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
    setKnowledgeDocs((current) => [
      {
        docId: Math.max(...current.map((doc) => doc.docId)) + 1,
        docTitle: title,
        uploadUser: String(form.get("uploadUser") || uploadDefaults.uploadUser),
        description: String(form.get("description") || uploadDefaults.description),
        knowledgeBaseType: type,
        accessibleBy:
          form.getAll("accessibleBy").map(String).join(",") ||
          uploadDefaults.accessibleBy,
        status: "CONVERTED",
        chunks: 0,
        createdAt: now,
        updatedAt: now
      },
      ...current
    ]);
    setShowUpload(false);
  }

  function deleteDocument(docId: number) {
    setKnowledgeDocs((current) => current.filter((doc) => doc.docId !== docId));
    setSelectedDocId((current) => (current === docId ? null : current));
  }

  function refreshDocuments() {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 650);
  }

  function updateDocumentStatus(docId: number, status: DocumentStatus, chunks?: number) {
    setKnowledgeDocs((current) =>
      current.map((doc) =>
        doc.docId === docId
          ? {
              ...doc,
              status,
              chunks: chunks ?? doc.chunks,
              updatedAt: new Date().toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
              })
            }
          : doc
      )
    );
  }

  if (!loggedIn) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#0d0d0d]">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-screen flex-col border-r border-[#deded8] bg-[#fbfbf8]">
          <div className="flex h-16 items-center gap-3 border-b border-[#e7e7e1] px-4">
            <button
              className="grid h-9 w-9 place-items-center rounded-lg text-[#5f5f5a] transition hover:bg-[#eeeeea]"
              aria-label="折叠菜单"
              title="折叠菜单"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#0d0d0d] text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Know-Agent</h1>
              <p className="truncate text-xs text-[#7a7a73]">智能体控制台</p>
            </div>
          </div>

          <div className="p-3">
            <button className="flex h-10 w-full items-center gap-2 rounded-lg border border-[#deded8] bg-white px-3 text-sm font-medium transition hover:bg-[#f3f3ef]">
              <Plus className="h-4 w-4" />
              新建任务
            </button>
          </div>

          <nav className="grid gap-1 px-3">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={clsx(
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
                  activeTab === item.key
                    ? "bg-[#ecece7] text-[#0d0d0d]"
                    : "text-[#5f5f5a] hover:bg-[#f0f0eb] hover:text-[#0d0d0d]"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-5 px-3">
            <p className="px-3 text-xs font-medium text-[#8a8a82]">最近会话</p>
            <div className="mt-2 grid gap-1">
              {threads.slice(0, 3).map((thread) => (
                <button
                  key={thread.threadId}
                  onClick={() => setActiveTab(thread.appName === "ppt_build" ? "workflow" : "assistant")}
                  className="rounded-lg px-3 py-2 text-left text-sm text-[#5f5f5a] transition hover:bg-[#f0f0eb] hover:text-[#0d0d0d]"
                >
                  <span className="block truncate font-medium">{thread.title}</span>
                  <span className="block truncate text-xs text-[#9a9a91]">
                    {thread.updatedAt}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto border-t border-[#e7e7e1] p-3">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-[#ecece7]">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{userProfile.name}</p>
                <p className="truncate text-xs text-[#7a7a73]">
                  {userProfile.roles.join(", ")}
                </p>
              </div>
              <button
                onClick={() => setLoggedIn(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-[#77776f] hover:bg-[#eeeeea]"
                aria-label="退出登录"
                title="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-[#e7e7e1] bg-[#fbfbf8] px-5">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{activeTitle}</h2>
              <p className="truncate text-xs text-[#7a7a73]">
                {activeTab === "assistant" && "类似 Codex 的对话式智能助理页面"}
                {activeTab === "workflow" && "编排和运行后端 Graph / 工作流"}
                {activeTab === "knowledge" && "文档、分块、检索与向量化管理"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="grid h-9 w-9 place-items-center rounded-lg border border-[#deded8] bg-white text-[#5f5f5a] hover:bg-[#f3f3ef]">
                <Moon className="h-4 w-4" />
              </button>
              <button className="grid h-9 w-9 place-items-center rounded-lg border border-[#deded8] bg-white text-[#5f5f5a] hover:bg-[#f3f3ef]">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>
          </header>

          {activeTab === "assistant" && (
            <AssistantView
              input={input}
              messages={messages}
              streaming={streaming}
              setInput={setInput}
              sendMessage={sendMessage}
            />
          )}
          {activeTab === "workflow" && (
            <WorkflowView
              activeWorkflow={activeWorkflow}
              setActiveWorkflow={setActiveWorkflow}
              workflowSession={workflowSession}
              workflowMessages={workflowMessages}
              workflowInput={workflowInput}
              workflowRunning={workflowRunning}
              workflowStep={workflowStep}
              runWorkflow={runWorkflow}
              backToWorkflowHome={backToWorkflowHome}
              setWorkflowInput={setWorkflowInput}
              sendWorkflowMessage={sendWorkflowMessage}
            />
          )}
          {activeTab === "knowledge" && (
            <KnowledgeView
              documents={knowledgeDocs}
              selectedDocId={selectedDocId}
              showUpload={showUpload}
              docSearch={docSearch}
              statusFilter={statusFilter}
              page={page}
              refreshing={refreshing}
              setSelectedDocId={setSelectedDocId}
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

function LoginView({ onLogin }: { onLogin: (event: FormEvent<HTMLFormElement>) => void }) {
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
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-[#8b8b83]">
            Agent workspace
          </p>
          <h2 className="mt-5 max-w-2xl text-5xl font-semibold leading-tight tracking-[-0.02em]">
            面向知识库、工作流和对话智能体的统一入口
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#66665f]">
            风格靠近 Codex：安静、克制、以任务为中心。登录后进入智能助理、工作流和知识库管理三个核心页面。
          </p>
        </div>
        <div className="grid max-w-2xl gap-3 md:grid-cols-3">
          <LoginFeature icon={MessageSquare} title="智能助理" />
          <LoginFeature icon={Workflow} title="工作流" />
          <LoginFeature icon={Database} title="知识库管理" />
        </div>
      </section>

      <section className="flex items-center justify-center p-6">
        <form
          onSubmit={onLogin}
          className="w-full max-w-sm rounded-2xl border border-[#deded8] bg-white p-5 shadow-sm"
        >
          <div className="mb-6">
            <h2 className="text-xl font-semibold">登录</h2>
            <p className="mt-1 text-sm text-[#6f6f68]">
              对应 POST /api/auth/login，当前使用 mock token。
            </p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#5f5f5a]">用户名</span>
            <input
              defaultValue="lxqq"
              className="h-11 rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#0d0d0d]"
            />
          </label>
          <label className="mt-4 grid gap-1.5">
            <span className="text-sm font-medium text-[#5f5f5a]">密码</span>
            <input
              defaultValue="Lxqq0912!"
              type="password"
              className="h-11 rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#0d0d0d]"
            />
          </label>
          <button className="mt-5 h-11 w-full rounded-lg bg-[#0d0d0d] text-sm font-semibold text-white transition hover:bg-black">
            进入控制台
          </button>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#f2f7f4] px-3 py-2 text-xs font-medium text-[#31745b]">
            <ShieldCheck className="h-4 w-4" />
            Casdoor token / roles 已用 mock 数据模拟
          </div>
        </form>
      </section>
    </main>
  );
}

function AssistantView({
  input,
  messages,
  streaming,
  setInput,
  sendMessage
}: {
  input: string;
  messages: ChatMessage[];
  streaming: boolean;
  setInput: (value: string) => void;
  sendMessage: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, streaming]);

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-5 py-5">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-5">
          {messages.map((message) => (
            <ChatMessageRow key={message.id} message={message} />
          ))}
          {streaming ? (
            <div className="flex items-center gap-2 text-sm font-medium text-[#31745b]">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在接收 POST /run_sse 的 message 事件
            </div>
          ) : null}
        </div>

        <form
          onSubmit={sendMessage}
          className="rounded-2xl border border-[#d8d8d2] bg-white p-3 shadow-sm"
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={3}
            placeholder="询问知识库，或让智能助理调用工具..."
            className="max-h-36 min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-[#9a9a91]"
          />
          <div className="flex items-center justify-between border-t border-[#eeeeea] pt-3">
            <div className="flex gap-2">
              <ToolPill>common_agent</ToolPill>
              <ToolPill>hybrid search</ToolPill>
              <ToolPill>thread-uuid-001</ToolPill>
            </div>
            <button
              disabled={!input.trim() || streaming}
              className="grid h-9 w-9 place-items-center rounded-lg bg-[#0d0d0d] text-white transition hover:bg-black disabled:bg-[#c9c9c2]"
              aria-label="发送"
              title="发送"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkflowView({
  activeWorkflow,
  setActiveWorkflow,
  workflowSession,
  workflowMessages,
  workflowInput,
  workflowRunning,
  workflowStep,
  runWorkflow,
  backToWorkflowHome,
  setWorkflowInput,
  sendWorkflowMessage
}: {
  activeWorkflow: string;
  setActiveWorkflow: (value: string) => void;
  workflowSession: boolean;
  workflowMessages: ChatMessage[];
  workflowInput: string;
  workflowRunning: boolean;
  workflowStep: number;
  runWorkflow: () => void;
  backToWorkflowHome: () => void;
  setWorkflowInput: (value: string) => void;
  sendWorkflowMessage: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const workflowScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workflowScrollRef.current?.scrollTo({
      top: workflowScrollRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [workflowMessages, workflowRunning, workflowStep]);

  const workflows = [
    {
      id: "ppt_build",
      name: "PPT 生成",
      desc: "根据需求自动生成 PPT 文件",
      detail: "graph_run_sse / graph_resume_sse",
      icon: Presentation
    },
    {
      id: "document_ingest",
      name: "文档入库",
      desc: "上传、分块、向量化一键处理",
      detail: "upload → split → embedding",
      icon: FileText
    }
  ];

  if (!workflowSession) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-5">
          <h3 className="text-xl font-semibold">选择工作流</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">
            每个工作流卡片都可以直接启动，启动后进入类似对话页的运行态。
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {workflows.map((flow) => (
            <article
              key={flow.id}
              className="rounded-2xl border border-[#deded8] bg-white p-5 shadow-sm transition hover:border-[#c9c9c2]"
            >
              <div className="mb-5 flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#f0f0eb]">
                  <flow.icon className="h-5 w-5" />
                </div>
                <ToolPill>{flow.detail}</ToolPill>
              </div>
              <h4 className="text-lg font-semibold">{flow.name}</h4>
              <p className="mt-2 min-h-10 text-sm leading-6 text-[#66665f]">
                {flow.desc}
              </p>
              <button
                onClick={() => {
                  setActiveWorkflow(flow.id);
                  runWorkflow();
                }}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white hover:bg-black"
              >
                <Play className="h-4 w-4" />
                启动
              </button>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-5 py-5">
        <div className="mb-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-xl font-semibold">
              {activeWorkflow === "ppt_build" ? "PPT 生成工作流" : "文档入库工作流"}
            </h3>
            <p className="mt-1 text-sm text-[#6f6f68]">
              {activeWorkflow === "ppt_build"
                ? "提交需求后，模拟 graph_run_sse 返回 update / interrupt / done。"
                : "模拟文档上传、智能分块、向量化入库和检索验证。"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={backToWorkflowHome}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#deded8] bg-white px-4 text-sm font-semibold text-[#4f4f49] hover:bg-[#f3f3ef]"
            >
              返回列表
            </button>
          <button
            onClick={runWorkflow}
            disabled={workflowRunning}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white disabled:bg-[#c9c9c2]"
          >
            {workflowRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            重新运行
          </button>
          </div>
        </div>

        <div ref={workflowScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-2xl border border-[#deded8] bg-[#fbfbf8] p-5">
          {workflowMessages.map((message) => (
            <ChatMessageRow key={message.id} message={message} />
          ))}
          <WorkflowProgressMessage
            activeWorkflow={activeWorkflow}
            workflowRunning={workflowRunning}
            workflowStep={workflowStep}
          />
        </div>
        <form
          onSubmit={sendWorkflowMessage}
          className="mt-4 rounded-2xl border border-[#d8d8d2] bg-white p-3 shadow-sm"
        >
          <textarea
            value={workflowInput}
            onChange={(event) => setWorkflowInput(event.target.value)}
            rows={2}
            placeholder="补充工作流信息，或继续追问运行结果..."
            className="max-h-28 min-h-14 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-[#9a9a91]"
          />
          <div className="flex items-center justify-between border-t border-[#eeeeea] pt-3">
            <div className="flex gap-2">
              <ToolPill>{activeWorkflow}</ToolPill>
              <ToolPill>{workflowRunning ? "running" : "ready"}</ToolPill>
            </div>
            <button
              disabled={!workflowInput.trim()}
              className="grid h-9 w-9 place-items-center rounded-lg bg-[#0d0d0d] text-white transition hover:bg-black disabled:bg-[#c9c9c2]"
              aria-label="发送工作流消息"
              title="发送"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkflowProgressMessage({
  activeWorkflow,
  workflowRunning,
  workflowStep
}: {
  activeWorkflow: string;
  workflowRunning: boolean;
  workflowStep: number;
}) {
  const steps =
    activeWorkflow === "ppt_build"
      ? graphSteps
      : [
          { node: "upload", label: "上传解析", detail: "POST /api/document/upload" },
          { node: "split", label: "智能分块", detail: "POST /api/document/split/{id}" },
          { node: "embedding", label: "向量入库", detail: "POST /api/document/embedding/{id}" },
          { node: "search", label: "检索验证", detail: "GET /api/document/search" }
        ];

  return (
    <div className="flex gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#0d0d0d] text-white">
        <Workflow className="h-4 w-4" />
      </div>
      <div className="w-full rounded-2xl border border-[#deded8] bg-white px-4 py-3 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#8a8a82]">
          工作流运行状态
        </p>
        <div className="mt-4 grid gap-4">
          {steps.map((step, index) => {
            const done = index < workflowStep;
            const running = workflowRunning && index === workflowStep;
            return (
              <div key={step.node} className="flex gap-3">
                <div
                  className={clsx(
                    "grid h-9 w-9 place-items-center rounded-full border",
                    done
                      ? "border-[#95d5b2] bg-[#effaf4] text-[#26734d]"
                      : running
                        ? "border-[#e7c46b] bg-[#fff7df] text-[#8a6417]"
                        : "border-[#deded8] bg-white text-[#9a9a91]"
                  )}
                >
                  {running ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : done ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{step.label}</p>
                  <p className="text-sm text-[#6f6f68]">{step.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KnowledgeView({
  documents,
  selectedDocId,
  showUpload,
  docSearch,
  statusFilter,
  page,
  refreshing,
  setSelectedDocId,
  setShowUpload,
  setDocSearch,
  setStatusFilter,
  setPage,
  uploadDocument,
  deleteDocument,
  updateDocumentStatus,
  refreshDocuments
}: {
  documents: DocumentItem[];
  selectedDocId: number | null;
  showUpload: boolean;
  docSearch: string;
  statusFilter: "ALL" | DocumentStatus;
  page: number;
  refreshing: boolean;
  setSelectedDocId: (value: number | null) => void;
  setShowUpload: (value: boolean) => void;
  setDocSearch: (value: string) => void;
  setStatusFilter: (value: "ALL" | DocumentStatus) => void;
  setPage: (value: number) => void;
  uploadDocument: (event: FormEvent<HTMLFormElement>) => void;
  deleteDocument: (docId: number) => void;
  updateDocumentStatus: (docId: number, status: DocumentStatus, chunks?: number) => void;
  refreshDocuments: () => void;
}) {
  const selectedDoc = documents.find((doc) => doc.docId === selectedDocId) ?? null;
  const filteredDocs = documents.filter((doc) => {
    const keyword = docSearch.trim().toLowerCase();
    const matchesKeyword =
      !keyword ||
      doc.docTitle.toLowerCase().includes(keyword) ||
      doc.description.toLowerCase().includes(keyword) ||
      doc.uploadUser.toLowerCase().includes(keyword);
    const matchesStatus = statusFilter === "ALL" || doc.status === statusFilter;
    return matchesKeyword && matchesStatus;
  });
  const pageSize = 5;
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
        onBack={() => setSelectedDocId(null)}
        onDelete={() => deleteDocument(selectedDoc.docId)}
        onUpdateStatus={updateDocumentStatus}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold">文档管理</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">
            管理文档基本信息、状态、切片和入库操作。
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white"
        >
          <UploadCloud className="h-4 w-4" />
          上传文档
        </button>
      </div>

      <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#deded8] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e7e7e1] p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex h-10 min-w-[280px] items-center gap-2 rounded-lg border border-[#deded8] bg-[#fbfbf8] px-3">
              <Search className="h-4 w-4 text-[#8a8a82]" />
              <input
              value={docSearch}
              onChange={(event) => setDocSearch(event.target.value)}
              placeholder="按标题、描述、上传人模糊搜索"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          <div className="flex flex-wrap items-center gap-2">
            <SelectShell icon={Filter}>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "ALL" | DocumentStatus)
                }
                className="h-10 appearance-none bg-transparent pl-9 pr-9 text-sm font-medium outline-none"
              >
                {["ALL", "CONVERTED", "CHUNKED", "VECTOR_STORED", "STORED"].map((status) => (
                  <option key={status} value={status}>
                    {status === "ALL" ? "全部状态" : statusLabel(status as "ALL" | DocumentStatus)}
                  </option>
                ))}
              </select>
            </SelectShell>
            <button
              onClick={refreshDocuments}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#deded8] bg-white px-3 text-sm font-semibold text-[#4f4f49] hover:bg-[#f3f3ef]"
            >
              <RefreshCw className={clsx("h-4 w-4", refreshing && "animate-spin")} />
              刷新
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-[#fbfbf8] text-xs uppercase text-[#77776f]">
              <tr>
                {["ID", "标题", "类型", "上传人", "状态", "分块", "更新时间", "操作"].map((header) => (
                  <th key={header} className="whitespace-nowrap px-4 py-3 font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6e6df]">
              {pagedDocs.map((doc) => (
                <tr key={doc.docId}>
                  <td className="px-4 py-3 font-medium">{doc.docId}</td>
                  <td className="px-4 py-3 font-semibold">{doc.docTitle}</td>
                  <td className="px-4 py-3">{doc.knowledgeBaseType}</td>
                  <td className="px-4 py-3">{doc.uploadUser}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3">{doc.chunks}</td>
                  <td className="px-4 py-3 text-[#6f6f68]">{doc.updatedAt}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedDocId(doc.docId)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#deded8] px-2 text-xs font-semibold hover:bg-[#f3f3ef]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </button>
                      <button
                        onClick={() => deleteDocument(doc.docId)}
                        className="h-8 rounded-lg border border-[#f0c4c4] px-2 text-xs font-semibold text-[#a33a3a] hover:bg-[#fff1f1]"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredDocs.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#77776f]">
              没有匹配的文档
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 border-t border-[#e7e7e1] px-4 py-3 text-sm text-[#6f6f68] md:flex-row md:items-center md:justify-between">
          <span>
            共 {filteredDocs.length} 条，当前第 {safePage} / {pageCount} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
              className="h-8 rounded-lg border border-[#deded8] px-3 font-semibold disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => setPage(Math.min(pageCount, safePage + 1))}
              disabled={safePage >= pageCount}
              className="h-8 rounded-lg border border-[#deded8] px-3 font-semibold disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      {showUpload ? (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onSubmit={uploadDocument}
        />
      ) : null}
    </div>
  );
}

function DocumentDetail({
  doc,
  onBack,
  onDelete,
  onUpdateStatus
}: {
  doc: DocumentItem;
  onBack: () => void;
  onDelete: () => void;
  onUpdateStatus: (docId: number, status: DocumentStatus, chunks?: number) => void;
}) {
  const docSegments = segments.filter((segment) => segment.documentId === doc.docId);
  const visibleLifecycle = documentLifecycle.filter((item) =>
    doc.knowledgeBaseType === "DATA_QUERY"
      ? item.status !== "VECTOR_STORED"
      : item.status !== "STORED"
  );
  const lifecycleIndex = visibleLifecycle.findIndex((item) => item.status === doc.status);
  const nextActions =
    doc.status === "CONVERTED"
      ? [{ label: "执行分块", action: () => onUpdateStatus(doc.docId, "CHUNKED", 56) }]
      : doc.status === "CHUNKED"
        ? [{ label: "执行向量化", action: () => onUpdateStatus(doc.docId, "VECTOR_STORED") }]
        : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <button onClick={onBack} className="mb-2 text-sm font-semibold text-[#5f5f5a] hover:text-[#0d0d0d]">
            ← 返回文档列表
          </button>
          <h3 className="text-xl font-semibold">{doc.docTitle}</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">{doc.description}</p>
        </div>
        <div className="flex gap-2">
          {nextActions.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="h-10 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white"
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={onDelete}
            className="h-10 rounded-lg border border-[#f0c4c4] px-4 text-sm font-semibold text-[#a33a3a] hover:bg-[#fff1f1]"
          >
            删除
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-[#deded8] bg-white p-5">
          <h4 className="mb-4 font-semibold">基本信息</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <InfoItem label="文档 ID" value={String(doc.docId)} />
            <InfoItem label="上传人" value={doc.uploadUser} />
            <InfoItem label="知识库类型" value={doc.knowledgeBaseType} />
            <InfoItem label="可访问角色" value={doc.accessibleBy} />
            <InfoItem label="创建时间" value={doc.createdAt} />
            <InfoItem label="更新时间" value={doc.updatedAt} />
            <InfoItem label="当前状态" value={doc.status} />
            <InfoItem label="切片数量" value={String(doc.chunks)} />
          </div>
        </section>

        <section className="rounded-2xl border border-[#deded8] bg-white p-5">
          <h4 className="mb-4 font-semibold">状态时间线</h4>
          <div className="space-y-4">
            {visibleLifecycle.map((item, index) => {
                const isCurrent = item.status === doc.status;
                const done = lifecycleIndex >= index;
                return (
                  <div key={item.status} className="flex gap-3">
                    <div
                      className={clsx(
                        "mt-0.5 grid h-7 w-7 place-items-center rounded-full border",
                        isCurrent
                          ? "border-[#0d0d0d] bg-[#0d0d0d] text-white"
                          : done
                            ? "border-[#95d5b2] bg-[#effaf4] text-[#26734d]"
                            : "border-[#deded8] bg-white text-[#9a9a91]"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className="text-xs text-[#77776f]">{item.status}</p>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-[#deded8] bg-white p-5">
        <h4 className="mb-4 font-semibold">文档切片列表</h4>
        <div className="overflow-x-auto rounded-xl border border-[#e6e6df]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#fbfbf8] text-xs uppercase text-[#77776f]">
              <tr>
                {["ID", "chunk_id", "order", "status", "text"].map((header) => (
                  <th key={header} className="px-4 py-3 font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6e6df]">
              {docSegments.map((segment) => (
                <tr key={segment.id}>
                  <td className="px-4 py-3">{segment.id}</td>
                  <td className="px-4 py-3">{segment.chunkId}</td>
                  <td className="px-4 py-3">{segment.chunkOrder}</td>
                  <td className="px-4 py-3">{segment.status}</td>
                  <td className="max-w-[620px] px-4 py-3 text-[#5f5f5a]">
                    {segment.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {docSegments.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#77776f]">
              当前文档还没有切片，完成分块后会显示在这里。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function UploadDialog({
  onClose,
  onSubmit
}: {
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-2xl border border-[#deded8] bg-white p-5 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">上传文档</h3>
            <p className="mt-1 text-sm text-[#6f6f68]">
              mock POST /api/document/upload，提交后进入 CONVERTED 状态。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-[#6f6f68] hover:bg-[#f3f3ef]"
            aria-label="关闭"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-3">
          <FormField name="title" label="文档标题" defaultValue={uploadDefaults.title} />
          <FormField name="uploadUser" label="上传人" defaultValue={uploadDefaults.uploadUser} />
          <FormField name="description" label="描述" defaultValue={uploadDefaults.description} />
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#5f5f5a]">知识库类型</span>
            <SelectShell>
              <select
                name="knowledgeBaseType"
                defaultValue={uploadDefaults.knowledgeBaseType}
                className="h-10 w-full appearance-none bg-transparent pl-3 pr-9 text-sm font-medium outline-none"
              >
                <option value="DOCUMENT_SEARCH">文档检索</option>
                <option value="DATA_QUERY">数据查询</option>
              </select>
            </SelectShell>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#5f5f5a]">可访问角色</span>
            <SelectShell>
              <select
                name="accessibleBy"
                defaultValue={uploadDefaults.accessibleBy.split(",")}
                multiple
                className="min-h-24 w-full appearance-none bg-transparent px-3 py-2 text-sm font-medium outline-none"
              >
                <option value="admin">管理员</option>
                <option value="normal_user">普通用户</option>
                <option value="auditor">审计员</option>
              </select>
            </SelectShell>
            <span className="text-xs text-[#8a8a82]">按住 Ctrl 可多选</span>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#5f5f5a]">文件</span>
            <input
              type="file"
              className="rounded-lg border border-dashed border-[#d8d8d2] bg-[#fbfbf8] px-3 py-3 text-sm"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-[#deded8] px-4 text-sm font-semibold">
            取消
          </button>
          <button className="h-10 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white">
            上传
          </button>
        </div>
      </form>
    </div>
  );
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  return (
    <div className={clsx("flex gap-3", isUser && "justify-end")}>
      {!isUser ? (
        <div
          className={clsx(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full",
            isTool ? "bg-[#fff6df] text-[#8a6417]" : "bg-[#0d0d0d] text-white"
          )}
        >
          {isTool ? <Search className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      ) : null}
      <div
        className={clsx(
          "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
          isUser
            ? "bg-[#0d0d0d] text-white"
            : isTool
              ? "border border-[#ead49a] bg-[#fff9e8] text-[#5f4612]"
              : "border border-[#deded8] bg-white text-[#3f3f3a]"
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.sources?.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.sources.map((source) => (
              <ToolPill key={source}>{source}</ToolPill>
            ))}
          </div>
        ) : null}
      </div>
      {isUser ? (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ecece7]">
          <UserRound className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

function DataPanel({
  title,
  caption,
  headers,
  rows
}: {
  title: string;
  caption: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="min-h-0 flex-1 rounded-2xl border border-[#deded8] bg-white p-5">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-[#6f6f68]">{caption}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#e6e6df]">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-[#fbfbf8] text-xs uppercase text-[#77776f]">
            <tr>
              {headers.map((header) => (
                <th key={header} className="whitespace-nowrap px-4 py-3 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e6e6df]">
            {rows.map((row, rowIndex) => (
              <tr key={`${row[0]}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${cell}-${cellIndex}`}
                    className="max-w-[440px] whitespace-nowrap px-4 py-3 font-medium text-[#3f3f3a]"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const styles: Record<DocumentStatus, string> = {
    CONVERTED: "bg-[#eef0ff] text-[#4c5aac]",
    CHUNKED: "bg-[#fff6df] text-[#8a6417]",
    VECTOR_STORED: "bg-[#effaf4] text-[#26734d]",
    STORED: "bg-[#eef7ff] text-[#28628a]"
  };
  return (
    <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", styles[status])}>
      {status}
    </span>
  );
}

function statusLabel(status: "ALL" | DocumentStatus) {
  const labels: Record<"ALL" | DocumentStatus, string> = {
    ALL: "全部状态",
    CONVERTED: "解析完成",
    CHUNKED: "分块完成",
    VECTOR_STORED: "向量入库",
    STORED: "已入库"
  };
  return labels[status];
}

function SelectShell({
  children,
  icon: Icon
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-[#deded8] bg-white text-[#3f3f3a] shadow-sm">
      {Icon ? (
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a82]" />
      ) : null}
      {children}
      <ChevronDown className="pointer-events-none absolute right-3 top-5 h-4 w-4 -translate-y-1/2 text-[#8a8a82]" />
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#fbfbf8] p-3">
      <p className="text-xs font-medium text-[#77776f]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold">{value}</p>
    </div>
  );
}

function FormField({
  name,
  label,
  defaultValue
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-[#5f5f5a]">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="h-10 rounded-lg border border-[#d8d8d2] bg-[#fbfbf8] px-3 text-sm outline-none focus:border-[#0d0d0d]"
      />
    </label>
  );
}

function LoginFeature({
  icon: Icon,
  title
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#deded8] bg-white p-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-[#f0f0eb]">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
    </div>
  );
}

function ToolPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full bg-[#f0f0eb] px-2 text-xs font-medium text-[#5f5f5a]">
      {children}
    </span>
  );
}
