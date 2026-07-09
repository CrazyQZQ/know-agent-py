"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  theme as antdTheme
} from "antd";
import type { MenuProps } from "antd";
import {
  ArrowUp,
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
  { key: "knowledge", label: "知识库", icon: Database }
];


export default function Home() {
  const { Sider, Header, Content } = Layout;
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("assistant");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return crypto.randomUUID();
    return window.localStorage.getItem("know-agent-thread") || crypto.randomUUID();
  });
  const [threads, setThreads] = useState<{ thread_id: string }[]>([]);
  const [workflowSession, setWorkflowSession] = useState(false);
  const [workflowMessages, setWorkflowMessages] = useState<ChatMessage[]>([]);
  const [workflowInput, setWorkflowInput] = useState("");
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
  const menuItems = useMemo<MenuProps["items"]>(
    () =>
      navItems.map((item) => ({
        key: item.key,
        icon: <item.icon className="h-4 w-4" />,
        label: item.label
      })),
    []
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
      setMessages(history.map((h) => makeMessage(h.role === "user" ? "user" : "assistant", h.content)));
    } catch {
      setMessages([]);
    }
  }

  function createNewThread() {
    setThreadId(crypto.randomUUID());
    setMessages([]);
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

  function startWorkflowSession() {
    setWorkflowSession(true);
    setWorkflowMessages([]);
    setWorkflowInput("");
    setWorkflowStep(0);
  }

  async function runWorkflow(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
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
              makeMessage("assistant", `${workflowNodeLabel(update.node)}已完成`)
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
            setWorkflowMessages((current) => [...current, makeMessage("assistant", "已收到补充信息，正在继续处理。")]);
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
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#111827",
          borderRadius: 8,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        },
        components: {
          Layout: { bodyBg: "#f5f5f3", headerBg: "#ffffff", siderBg: "#ffffff" },
          Menu: { itemBorderRadius: 8, itemHeight: 42 }
        }
      }}
    >
      <Layout className="h-screen overflow-hidden bg-[#f5f5f3]">
        <Sider width={264} className="border-r border-[#e8e8e4]" theme="light">
          <div className="flex h-full flex-col">
          <div className="flex h-16 items-center gap-3 border-b border-[#ececea] px-4">
            <Avatar shape="square" size={36} className="bg-[#111827]" icon={<Sparkles className="h-4 w-4" />} />
            <div className="min-w-0">
              <Typography.Text strong className="block leading-5">Know-Agent</Typography.Text>
              <Typography.Text type="secondary" className="block text-xs">智能体工作台</Typography.Text>
            </div>
          </div>
          <Menu
            className="border-none px-2 py-3"
            mode="inline"
            selectedKeys={[activeTab]}
            items={menuItems}
            onClick={({ key }) => setActiveTab(key as MainTab)}
          />
          {activeTab === "assistant" ? (
            <div className="min-h-0 flex-1 px-3 pb-2">
              <div className="mb-1 flex items-center justify-between px-2">
                <Typography.Text type="secondary" className="text-xs">会话</Typography.Text>
                <Button type="text" size="small" icon={<Plus className="h-3.5 w-3.5" />} onClick={createNewThread}>新建</Button>
              </div>
              <div className="grid max-h-[calc(100vh-310px)] gap-1 overflow-y-auto pr-1">
                {threads.map((t) => (
                  <Button
                    key={t.thread_id}
                    type={t.thread_id === threadId ? "default" : "text"}
                    className="justify-start truncate text-left text-xs"
                    onClick={() => switchThread(t.thread_id)}
                  >
                    {t.thread_id.slice(0, 8)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-auto border-t border-[#ececea] p-3">
            <div className="flex items-center gap-3 rounded-lg px-2 py-2">
              <Avatar icon={<UserRound className="h-4 w-4" />} />
              <div className="min-w-0 flex-1">
                <Typography.Text strong className="block truncate text-sm">{user?.name}</Typography.Text>
                <Typography.Text type="secondary" className="block truncate text-xs">{user?.roles.join(", ") || "无角色"}</Typography.Text>
              </div>
              <Button type="text" size="small" icon={<LogOut className="h-4 w-4" />} onClick={handleLogout} aria-label="退出登录" />
            </div>
          </div>
          </div>
        </Sider>
        <Layout className="min-w-0">
          <Header className="flex h-16 items-center justify-between border-b border-[#ececea] px-5">
            <div className="min-w-0">
              <Typography.Title level={5} className="!mb-0 truncate">{activeTitle}</Typography.Title>
              <Typography.Text type="secondary" className="block truncate text-xs">
                {activeTab === "assistant" && "智能体对话"}
                {activeTab === "workflow" && "PPT 生成"}
                {activeTab === "knowledge" && "文档、切片和向量化管理"}
              </Typography.Text>
            </div>
            {error ? <Alert type="error" showIcon message={error} className="max-w-xl" /> : null}
          </Header>
          <Content className="min-h-0 overflow-hidden">
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
                startWorkflowSession={startWorkflowSession}
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
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
function LoginView({ onLogin, error }: { onLogin: (event: FormEvent<HTMLFormElement>) => void; error: string | null }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#111827",
          borderRadius: 8,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      }}
    >
      <main className="grid min-h-screen bg-[#f5f5f3] text-[#111827] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-[420px] flex-col justify-between border-r border-[#e5e7eb] bg-white p-8">
          <div className="flex items-center gap-3">
            <Avatar shape="square" size={44} className="bg-[#111827]" icon={<Sparkles className="h-5 w-5" />} />
            <div>
              <Typography.Title level={4} className="!mb-0">Know-Agent</Typography.Title>
              <Typography.Text type="secondary">智能体工作台</Typography.Text>
            </div>
          </div>
          <div className="max-w-3xl">
            <Typography.Text type="secondary" className="text-xs font-semibold uppercase tracking-wide">Agent workspace</Typography.Text>
            <Typography.Title className="!mt-5 max-w-2xl !text-5xl !leading-tight">知识库、工作流和对话智能体的统一入口</Typography.Title>
            <Typography.Paragraph className="max-w-xl text-base leading-7 text-[#4b5563]">登录后可以使用智能体对话、PPT 生成和知识库管理。</Typography.Paragraph>
          </div>
          <div className="grid max-w-2xl gap-3 md:grid-cols-3">
            <LoginFeature icon={MessageSquare} title="智能助理" />
            <LoginFeature icon={Workflow} title="工作流" />
            <LoginFeature icon={Database} title="知识库" />
          </div>
        </section>
        <section className="flex items-center justify-center p-6">
          <Card className="w-full max-w-sm shadow-sm">
            <Typography.Title level={3} className="!mb-1">登录</Typography.Title>
            <Typography.Text type="secondary">使用你的账号进入工作台。</Typography.Text>
            <form onSubmit={onLogin} className="mt-6">
              <div className="grid gap-4">
                <FormField name="username" label="用户名" defaultValue="lxqq" />
                <FormField name="password" label="密码" defaultValue="Lxqq0912!" type="password" />
              </div>
              {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}
              <Button htmlType="submit" type="primary" block size="large" className="mt-5">进入工作台</Button>
              <Alert className="mt-4" type="success" showIcon message="登录后将保留你的会话和访问权限。" />
            </form>
          </Card>
        </section>
      </main>
    </ConfigProvider>
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
          {!messages.length && !streaming ? (
            <div className="grid min-h-[45vh] place-items-center text-center">
              <div>
                <Typography.Title level={3} className="!mb-2">可以开始提问了</Typography.Title>
                <Typography.Text type="secondary">输入问题后，助手会在这里显示回答。</Typography.Text>
              </div>
            </div>
          ) : null}
          {messages.map((message) => <ChatMessageRow key={message.id} message={message} />)}
          {streaming ? <div className="flex items-center gap-2 text-sm text-[#77776f]"><Loader2 className="h-4 w-4 animate-spin" /> 正在生成</div> : null}
          {pendingApproval ? (
            <Card size="small" className="mx-auto max-w-3xl border-[#f0d98c] bg-[#fffbe6]">
              <Typography.Text strong className="text-[#7a5c00]">工具审批</Typography.Text>
              <div className="mt-2 space-y-1">
                {pendingApproval.action_requests.map((r, i) => (
                  <Tag key={i} color="gold">{r.name}</Tag>
                ))}
              </div>
              <Space className="mt-3">
                <Button type="primary" size="small" onClick={onApprove} disabled={streaming}>批准执行</Button>
                <Button danger size="small" onClick={onReject} disabled={streaming}>拒绝</Button>
              </Space>
            </Card>
          ) : null}
        </div>
      </div>
      <form onSubmit={sendMessage} className="shrink-0 bg-[#f7f7f4] px-4 pb-5 pt-2">
        <div className="mx-auto max-w-3xl rounded-[22px] border border-[#d9d9d2] bg-white p-2 shadow-[0_12px_40px_rgba(15,23,42,0.10)] transition focus-within:border-[#b8b8b0] focus-within:shadow-[0_12px_40px_rgba(15,23,42,0.12)]">
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

function WorkflowView({ workflowSession, workflowMessages, workflowInput, workflowRunning, workflowStep, setWorkflowInput, startWorkflowSession, runWorkflow, resumeWorkflow, backToWorkflowHome }: { workflowSession: boolean; workflowMessages: ChatMessage[]; workflowInput: string; workflowRunning: boolean; workflowStep: number; setWorkflowInput: (value: string) => void; startWorkflowSession: () => void; runWorkflow: (event?: FormEvent<HTMLFormElement>) => void; resumeWorkflow: (event: FormEvent<HTMLFormElement>) => void; backToWorkflowHome: () => void }) {
  const workflowScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workflowScrollRef.current?.scrollTo({ top: workflowScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [workflowMessages, workflowRunning]);

  if (!workflowSession) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-5">
          <h3 className="text-xl font-semibold">PPT 生成工作流</h3>
          <p className="mt-1 text-sm text-[#6f6f68]">输入主题、受众和页数，系统会整理材料并生成 PPT。</p>
        </div>
        <article className="max-w-lg rounded-lg border border-[#deded8] bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#f0f0eb]">
              <Presentation className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-[#20201d]">PPT 生成</h4>
                <ToolPill>演示文稿</ToolPill>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#66665f]">根据主题、受众和页数生成 PPT：需求澄清、资料检索、模板选择、提纲、Schema 和渲染。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-[#f0f0eb] px-2 py-1 text-xs text-[#6f6f68]">8 个节点</span>
                <span className="rounded-full bg-[#f0f0eb] px-2 py-1 text-xs text-[#6f6f68]">支持中断补充</span>
                <span className="rounded-full bg-[#f0f0eb] px-2 py-1 text-xs text-[#6f6f68]">实时进度</span>
              </div>
            </div>
          </div>
          <button onClick={startWorkflowSession} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#0d0d0d] px-3 text-sm font-semibold text-white transition hover:bg-black">
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
          {!workflowMessages.length && !workflowRunning ? (
            <div className="grid min-h-[45vh] place-items-center text-center">
              <div>
                <Typography.Title level={3} className="!mb-2">描述你要生成的 PPT</Typography.Title>
                <Typography.Text type="secondary">例如主题、受众、页数、风格和需要强调的内容。</Typography.Text>
              </div>
            </div>
          ) : null}
          {workflowMessages.map((message) => <ChatMessageRow key={message.id} message={message} />)}
          {workflowRunning ? <div className="flex items-center gap-2 text-sm text-[#77776f]"><Loader2 className="h-4 w-4 animate-spin" /> 工作流运行中</div> : null}
        </div>
      </div>
      <form onSubmit={workflowMessages.length ? resumeWorkflow : runWorkflow} className="border-t border-[#e7e7e1] bg-[#fbfbf8] p-4">
        <div className="mx-auto flex max-w-4xl items-center gap-2 rounded-xl border border-[#deded8] bg-white p-2">
          <input value={workflowInput} onChange={(event) => setWorkflowInput(event.target.value)} placeholder={workflowMessages.length ? "补充说明，例如受众、页数或风格" : "输入 PPT 需求，例如：做一份关于 AI 发展的 10 页技术团队汇报"} className="h-10 flex-1 bg-transparent px-3 text-sm outline-none" />
          <button disabled={!workflowInput.trim() || workflowRunning} className="h-10 rounded-lg bg-[#0d0d0d] px-4 text-sm font-semibold text-white disabled:opacity-40">{workflowMessages.length ? "继续" : "发送"}</button>
        </div>
      </form>
    </div>
  );
}

function workflowNodeLabel(node: string) {
  const labels: Record<string, string> = {
    requirement: "需求理解",
    search: "资料检索",
    template_select: "模板选择",
    template_info: "模板分析",
    outline: "大纲生成",
    schema: "页面结构生成",
    render: "PPT 渲染"
  };
  return labels[node] ?? node;
}

function KnowledgeView({ documents, segments, roles, selectedDocId, showUpload, docSearch, statusFilter, loadingDocs, busyDocId, selectDocument, setSelectedDocId, setShowUpload, setDocSearch, setStatusFilter, uploadDocument, deleteDocument, updateDocumentStatus, refreshDocuments }: { documents: DocumentItem[]; segments: SegmentItem[]; roles: RoleItem[]; selectedDocId: number | null; showUpload: boolean; docSearch: string; statusFilter: "ALL" | DocumentStatus; page: number; loadingDocs: boolean; busyDocId: number | null; setSelectedDocId: (value: number | null) => void; selectDocument: (docId: number) => void; setShowUpload: (value: boolean) => void; setDocSearch: (value: string) => void; setStatusFilter: (value: "ALL" | DocumentStatus) => void; setPage: (value: number) => void; uploadDocument: (event: FormEvent<HTMLFormElement>) => void; deleteDocument: (docId: number) => void; updateDocumentStatus: (docId: number, status: DocumentStatus) => void; refreshDocuments: () => void }) {
  const selectedDoc = documents.find((doc) => doc.docId === selectedDocId) ?? null;
  const filteredDocs = documents.filter((doc) => {
    const keyword = docSearch.trim().toLowerCase();
    const matchesKeyword = !keyword || doc.docTitle.toLowerCase().includes(keyword) || doc.description.toLowerCase().includes(keyword) || doc.uploadUser.toLowerCase().includes(keyword);
    const matchesStatus = statusFilter === "ALL" || doc.status === statusFilter;
    return matchesKeyword && matchesStatus;
  });

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
          <Typography.Title level={4} className="!mb-1">文档管理</Typography.Title>
          <Typography.Text type="secondary">管理文档上传、分块、向量化和访问权限。</Typography.Text>
        </div>
        <Button type="primary" icon={<UploadCloud className="h-4 w-4" />} onClick={() => setShowUpload(true)}>
          上传文档
        </Button>
      </div>

      <Card className="min-h-0 flex-1 overflow-hidden" bodyStyle={{ padding: 0, height: "100%" }}>
        <div className="flex flex-col gap-3 border-b border-[#f0f0f0] p-4 xl:flex-row xl:items-center xl:justify-between">
          <Input.Search
            allowClear
            value={docSearch}
            onChange={(event) => setDocSearch(event.target.value)}
            placeholder="按标题、描述、上传人搜索"
            className="max-w-md"
          />
          <Space wrap>
            <Select
              value={statusFilter}
              className="w-40"
              onChange={(value) => setStatusFilter(value)}
              options={[
                { value: "ALL", label: "全部状态" },
                { value: "CONVERTED", label: statusLabel("CONVERTED") },
                { value: "CHUNKED", label: statusLabel("CHUNKED") },
                { value: "VECTOR_STORED", label: statusLabel("VECTOR_STORED") },
                { value: "STORED", label: statusLabel("STORED") }
              ]}
            />
            <Button icon={<RefreshCw className={clsx("h-4 w-4", loadingDocs && "animate-spin")} />} onClick={refreshDocuments}>
              刷新
            </Button>
          </Space>
        </div>
        <Table
          rowKey="docId"
          loading={loadingDocs}
          dataSource={filteredDocs}
          pagination={{ pageSize: 8, showSizeChanger: false, showTotal: (total) => `共 ${total} 条` }}
          scroll={{ x: 980, y: "calc(100vh - 300px)" }}
          columns={[
            { title: "ID", dataIndex: "docId", width: 80 },
            {
              title: "标题",
              dataIndex: "docTitle",
              width: 260,
              render: (text: string, doc: DocumentItem) => (
                <button className="text-left font-semibold text-[#111827] hover:underline" onClick={() => selectDocument(doc.docId)}>{text}</button>
              )
            },
            { title: "类型", dataIndex: "knowledgeBaseType", width: 160, render: (value: string) => <Tag>{value}</Tag> },
            { title: "上传人", dataIndex: "uploadUser", width: 120 },
            { title: "状态", dataIndex: "status", width: 140, render: (status: DocumentStatus) => <StatusBadge status={status} /> },
            { title: "更新时间", dataIndex: "updatedAt", width: 180 },
            {
              title: "操作",
              key: "actions",
              fixed: "right",
              width: 150,
              render: (_: unknown, doc: DocumentItem) => (
                <Space size="small">
                  <Button size="small" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => selectDocument(doc.docId)}>查看</Button>
                  <Button size="small" danger loading={busyDocId === doc.docId} onClick={() => deleteDocument(doc.docId)}>删除</Button>
                </Space>
              )
            }
          ]}
        />
      </Card>
      {showUpload ? <UploadDialog roles={roles} onClose={() => setShowUpload(false)} onSubmit={uploadDocument} /> : null}
    </div>
  );
}

function DocumentDetail({ doc, segments, busy, onBack, onDelete, onUpdateStatus }: { doc: DocumentItem; segments: SegmentItem[]; busy: boolean; onBack: () => void; onDelete: () => void; onUpdateStatus: (status: DocumentStatus) => void }) {
  const visibleLifecycle = documentLifecycle.filter((item) => doc.knowledgeBaseType === "DATA_QUERY" ? item.status !== "VECTOR_STORED" : item.status !== "STORED");
  const lifecycleIndex = Math.max(0, visibleLifecycle.findIndex((item) => item.status === doc.status));
  const nextActions = doc.status === "CONVERTED" ? [{ label: "执行分块", status: "CHUNKED" as const }] : doc.status === "CHUNKED" ? [{ label: "执行向量化", status: "VECTOR_STORED" as const }] : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Button type="link" className="mb-1 px-0" onClick={onBack}>返回文档列表</Button>
          <Typography.Title level={4} className="!mb-1">{doc.docTitle}</Typography.Title>
          <Typography.Text type="secondary">{doc.description || "暂无描述"}</Typography.Text>
        </div>
        <Space wrap>
          {nextActions.map((item) => <Button key={item.label} type="primary" loading={busy} onClick={() => onUpdateStatus(item.status)}>{item.label}</Button>)}
          <Button danger loading={busy} onClick={onDelete}>删除</Button>
        </Space>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="基本信息">
          <Descriptions column={2} size="small" bordered items={[
            { key: "id", label: "文档 ID", children: doc.docId },
            { key: "user", label: "上传人", children: doc.uploadUser },
            { key: "type", label: "知识库类型", children: <Tag>{doc.knowledgeBaseType}</Tag> },
            { key: "roles", label: "可访问角色", children: doc.accessibleBy },
            { key: "created", label: "创建时间", children: doc.createdAt },
            { key: "updated", label: "更新时间", children: doc.updatedAt },
            { key: "status", label: "当前状态", children: <StatusBadge status={doc.status} /> },
            { key: "segments", label: "切片数量", children: segments.length }
          ]} />
        </Card>
        <Card title="处理流程">
          <Steps
            direction="vertical"
            size="small"
            current={lifecycleIndex}
            items={visibleLifecycle.map((item) => ({ title: item.label, description: item.status }))}
          />
        </Card>
      </div>
      <Card className="mt-5" title="文档切片">
        <Table
          rowKey="id"
          size="small"
          dataSource={segments}
          pagination={{ pageSize: 6, showSizeChanger: false }}
          scroll={{ x: 920 }}
          columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "Chunk ID", dataIndex: "chunkId", width: 180 },
            { title: "顺序", dataIndex: "chunkOrder", width: 90 },
            { title: "状态", dataIndex: "status", width: 120, render: (status: string) => <Tag>{status}</Tag> },
            { title: "内容", dataIndex: "text", render: (text: string) => <Typography.Paragraph className="!mb-0" ellipsis={{ rows: 3, expandable: true }}>{text}</Typography.Paragraph> }
          ]}
        />
      </Card>
    </div>
  );
}

function UploadDialog({ roles, onClose, onSubmit }: { roles: RoleItem[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <Modal open title="上传文档" onCancel={onClose} footer={null} destroyOnClose width={620}>
      <Typography.Paragraph type="secondary">上传后会自动解析，并进入知识库处理流程。</Typography.Paragraph>
      <form onSubmit={onSubmit} className="mt-4">
        <div className="grid gap-4">
          <FormField name="title" label="文档标题" defaultValue="新文档" />
          <FormField name="uploadUser" label="上传人" defaultValue="web" />
          <FormField name="description" label="描述" defaultValue="" />
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#4b5563]">知识库类型</span>
            <select name="knowledgeBaseType" defaultValue="DOCUMENT_SEARCH" className="h-10 rounded-lg border border-[#d9d9d9] bg-white px-3 text-sm outline-none">
              <option value="DOCUMENT_SEARCH">文档检索</option>
              <option value="DATA_QUERY">数据查询</option>
            </select>
          </label>
          <FormField name="tableName" label="表名（DATA_QUERY 可选）" defaultValue="" />
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#4b5563]">可访问角色</span>
            <select name="accessibleBy" multiple className="min-h-24 rounded-lg border border-[#d9d9d9] bg-white px-3 py-2 text-sm outline-none">
              {roles.map((role) => <option key={role.name} value={role.name}>{role.displayName || role.name}</option>)}
            </select>
            <Typography.Text type="secondary" className="text-xs">不选择则按公开文档处理。</Typography.Text>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-[#4b5563]">文件</span>
            <input name="file" type="file" required className="rounded-lg border border-dashed border-[#d9d9d9] bg-white px-3 py-3 text-sm" />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="default" onClick={onClose}>取消</Button>
          <Button htmlType="submit" type="primary">上传</Button>
        </div>
      </form>
    </Modal>
  );
}

function ChatMessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  return (
    <div className={clsx("flex", isUser && "justify-end")}>
      <div className={clsx("max-w-[min(78%,720px)] rounded-2xl px-4 py-3 text-sm leading-6", isUser ? "bg-[#ececec] text-[#20201d]" : isTool ? "border border-[#ead49a] bg-[#fff9e8] text-[#5f4612]" : "text-[#2f2f2b]")}>
        {isUser || isTool ? (
          <p className="whitespace-pre-wrap">{message.content || "..."}</p>
        ) : (
          <MarkdownMessage content={message.content || "..."} />
        )}
      </div>
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
  const control = type === "password"
    ? <Input.Password name={name} defaultValue={defaultValue} size="large" />
    : <Input name={name} defaultValue={defaultValue} size="large" />;
  return <label className={clsx("grid gap-1.5", className)}><span className="text-sm font-medium text-[#4b5563]">{label}</span>{control}</label>;
}

function LoginFeature({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return <div className="flex items-center gap-3 rounded-lg border border-[#e5e7eb] bg-white p-3"><Avatar shape="square" className="bg-[#f3f4f6] text-[#111827]" icon={<Icon className="h-4 w-4" />} /><Typography.Text strong>{title}</Typography.Text></div>;
}

function ToolPill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full bg-[#f0f0eb] px-2 text-xs font-medium text-[#5f5f5a]">{children}</span>;
}
