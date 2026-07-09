"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Flex,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
  Upload,
  message,
  theme as antdTheme
} from "antd";
import type { MenuProps, UploadFile } from "antd";
import { Bubble, Conversations, Sender, XProvider, type BubbleListProps } from "@ant-design/x";
import XMarkdown from "@ant-design/x-markdown";
import { createStyles } from "antd-style";
import {
  Copy,
  Database,
  Eye,
  LogOut,
  MessageSquare,
  Play,
  Plus,
  Presentation,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import "@ant-design/x-markdown/themes/light.css";
import {
  clearAuth,
  deleteDocument as deleteDocumentApi,
  deleteThread,
  embedDocument,
  getThreadHistory,
  listDocuments,
  listRoles,
  listSegmentsByDocument,
  listThreads,
  login,
  logout,
  makeMessage,
  readAuth,
  resumeSse,
  splitDocument,
  streamSse,
  uploadDocument as uploadDocumentApi,
  type AuthState,
  type RoleItem,
  type ThreadItem,
  type ToolFeedback
} from "@/lib/api";
import {
  documentLifecycle,
  type ChatMessage,
  type DocumentItem,
  type DocumentStatus,
  type SegmentItem
} from "@/lib/mock-data";

type MainTab = "assistant" | "workflow" | "knowledge";

const navItems: Array<{ key: MainTab; label: string; icon: LucideIcon }> = [
  { key: "assistant", label: "智能助理", icon: MessageSquare },
  { key: "workflow", label: "工作流", icon: Workflow },
  { key: "knowledge", label: "知识库", icon: Database }
];

type ThreadGroup = { label: string; items: ThreadItem[] };

function threadTitle(thread: ThreadItem) {
  return thread.name?.trim() || "新会话";
}

function daysBetween(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.floor((end - start) / 86_400_000);
}

function groupThreadsByTime(threads: ThreadItem[], now = new Date()): ThreadGroup[] {
  const groups: ThreadGroup[] = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "7 天内", items: [] },
    { label: "30 天内", items: [] }
  ];
  for (const thread of threads) {
    const rawDate = thread.updated_at || thread.created_at;
    const date = rawDate ? new Date(rawDate) : now;
    const diff = Number.isNaN(date.getTime()) ? 0 : daysBetween(date, now);
    if (diff <= 0) groups[0].items.push(thread);
    else if (diff === 1) groups[1].items.push(thread);
    else if (diff <= 7) groups[2].items.push(thread);
    else groups[3].items.push(thread);
  }
  return groups.filter((group) => group.items.length > 0);
}

type UploadValues = {
  title: string;
  description: string;
  knowledgeBaseType: "DOCUMENT_SEARCH" | "DATA_QUERY";
  tableName?: string;
  accessibleBy?: string[];
  file?: UploadFile[];
};

// 直接套用 ultramodern.tsx 的 createStyles（基于 antd token）
const useStyle = createStyles(({ token, css }) => ({
  layout: css`
    width: 100%;
    height: 100vh;
    display: flex;
    background: ${token.colorBgContainer};
    overflow: hidden;
  `,
  side: css`
    background: ${token.colorBgLayout};
    width: 280px;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 0 12px;
    box-sizing: border-box;
    border-right: 1px solid ${token.colorBorderSecondary};
  `,
  logo: css`
    display: flex;
    align-items: center;
    justify-content: start;
    padding: 0 12px;
    box-sizing: border-box;
    gap: 8px;
    margin: 16px 0 8px;
    span {
      font-weight: bold;
      color: ${token.colorText};
      font-size: 16px;
    }
  `,
  menu: css`
    padding: 0 4px 8px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    margin-bottom: 8px;
  `,
  conversations: css`
    overflow-y: auto;
    margin-top: 4px;
    padding: 0;
    flex: 1;
    min-height: 0;
    .ant-conversations-list {
      padding-inline-start: 0;
    }
  `,
  sideFooter: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  `,
  chat: css`
    height: 100%;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    .ant-bubble-content-updating {
      background-image: linear-gradient(90deg, #ff6b23 0%, #af3cb8 31%, #53b6ff 89%);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: bottom;
    }
  `,
  chatList: css`
    flex: 1;
    overflow-y: auto;
    padding: 0 24px;
    margin-block-start: ${token.margin}px;
  `,
  chatSender: css`
    padding: ${token.paddingXS}px ${token.paddingLG}px;
  `,
  startPage: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  `,
  agentName: css`
    margin-block-start: 25%;
    font-size: 32px;
    margin-block-end: 38px;
    font-weight: 600;
  `,
  contentWrap: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
  header: css`
    height: 56px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    padding: 0 ${token.paddingLG}px;
    background: ${token.colorBgContainer};
  `
}));

export default function Home() {
  const { styles } = useStyle();
  const [messageApi, contextHolder] = message.useMessage();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("assistant");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return crypto.randomUUID();
    return window.localStorage.getItem("know-agent-thread") || crypto.randomUUID();
  });
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [workflowSession, setWorkflowSession] = useState(false);
  const [workflowMessages, setWorkflowMessages] = useState<ChatMessage[]>([]);
  const [workflowInput, setWorkflowInput] = useState("");
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(0);
  const [workflowThreadId, setWorkflowThreadId] = useState<string>(() => {
    if (typeof window === "undefined") return crypto.randomUUID();
    return window.localStorage.getItem("know-agent-workflow-thread") || crypto.randomUUID();
  });
  const [workflowThreads, setWorkflowThreads] = useState<ThreadItem[]>([]);
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
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    action_requests: { name: string; args: Record<string, unknown> }[];
  } | null>(null);
  const assistantBufferRef = useRef<Record<string, string>>({});

  const token = auth?.token ?? null;
  const user = auth?.user;
  const showError = (err: unknown, fallback: string) => {
    messageApi.error(err instanceof Error ? err.message : fallback);
  };
  const copyMessage = async (content: string) => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      messageApi.success("已复制");
    } catch {
      messageApi.error("复制失败");
    }
  };
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
  const conversationItems = useMemo(
    () =>
      groupThreadsByTime(threads).flatMap((group) =>
        group.items.map((thread) => ({
          key: thread.thread_id,
          label: threadTitle(thread),
          group: group.label
        }))
      ),
    [threads]
  );
  const workflowConversationItems = useMemo(
    () =>
      groupThreadsByTime(workflowThreads).flatMap((group) =>
        group.items.map((thread) => ({
          key: thread.thread_id,
          label: threadTitle(thread),
          group: group.label
        }))
      ),
    [workflowThreads]
  );

  useEffect(() => {
    const stored = readAuth();
    if (stored) setAuth(stored);
  }, []);

  useEffect(() => {
    if (activeTab === "assistant" && token) loadThreads();
    if (activeTab === "workflow" && token) loadWorkflowThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token]);

  useEffect(() => {
    if (activeTab === "knowledge" && token && !knowledgeLoaded) {
      setKnowledgeLoaded(true);
      refreshDocuments();
      listRoles(token).then(setRoles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token, knowledgeLoaded]);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("know-agent-thread", threadId);
  }, [threadId]);

  async function refreshDocuments() {
    setLoadingDocs(true);
    try {
      setDocuments(await listDocuments(token));
    } catch (err) {
      showError(err, "文档列表加载失败");
    } finally {
      setLoadingDocs(false);
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setAuth(await login(String(form.get("username")), String(form.get("password"))));
    } catch (err) {
      showError(err, "登录失败");
    }
  }

  async function handleLogout() {
    await logout(token);
    clearAuth();
    setAuth(null);
    setDocuments([]);
    setSegments([]);
    setRoles([]);
    setThreads([]);
    setKnowledgeLoaded(false);
  }

  async function sendMessage(content: string) {
    const text = content.trim();
    if (!text || streaming) return;
    const assistantId = `assistant-${Date.now()}`;
    setInput("");
    setStreaming(true);
    setMessages((current) => [
      ...current,
      makeMessage("user", text),
      { ...makeMessage("assistant", "", ["loading"]), id: assistantId }
    ]);
    assistantBufferRef.current[assistantId] = "";
    try {
      await streamSse(
        "/run_sse",
        {
          appName: "common_agent",
          userId: user?.name ?? "web",
          threadId,
          newMessage: { content: text, role: "user" },
          streaming: true,
          stateDelta: null
        },
        token,
        ({ event, data }) => {
          if (event === "done") return;
          if (event === "tool") {
            delete assistantBufferRef.current[assistantId];
            setMessages((current) => current.filter((message) => message.id !== assistantId));
            setMessages((current) => [...current, makeMessage("tool", data, ["event: tool"])]);
            return;
          }
          if (event === "interrupt") {
            delete assistantBufferRef.current[assistantId];
            setMessages((current) => current.filter((message) => message.id !== assistantId));
            try {
              const hitl = JSON.parse(data) as {
                action_requests: { name: string; args: Record<string, unknown> }[];
              };
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
          assistantBufferRef.current[assistantId] = `${assistantBufferRef.current[assistantId] || ""}${data}`;
        }
      );
    } catch (err) {
      assistantBufferRef.current[assistantId] = "";
      setMessages((current) => [
        ...current.filter((message) => message.id !== assistantId),
        makeMessage("assistant", err instanceof Error ? err.message : "对话请求失败", ["error"])
      ]);
    } finally {
      const finalContent = assistantBufferRef.current[assistantId] || "";
      delete assistantBufferRef.current[assistantId];
      setMessages((current) =>
        finalContent
          ? current.map((message) =>
              message.id === assistantId
                ? { ...message, content: finalContent, sources: message.sources?.filter((source) => source !== "loading") }
                : message
            )
          : current.filter((message) => message.id !== assistantId || message.content)
      );
      setStreaming(false);
      loadThreads();
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
    setMessages((current) => [...current, { ...makeMessage("assistant", "", ["loading"]), id: assistantId }]);
    assistantBufferRef.current[assistantId] = "";
    setStreaming(true);
    try {
      await resumeSse(threadId, feedbacks, token, ({ event, data }) => {
        if (event === "done") return;
        if (event === "tool") {
          delete assistantBufferRef.current[assistantId];
          setMessages((current) => current.filter((message) => message.id !== assistantId));
          setMessages((current) => [...current, makeMessage("tool", data, ["event: tool"])]);
          return;
        }
        if (event === "interrupt") {
          delete assistantBufferRef.current[assistantId];
          setMessages((current) => current.filter((message) => message.id !== assistantId));
          try {
            const hitl = JSON.parse(data) as {
              action_requests: { name: string; args: Record<string, unknown> }[];
            };
            setPendingApproval(hitl);
          } catch {
            /* ignore */
          }
          return;
        }
        assistantBufferRef.current[assistantId] = `${assistantBufferRef.current[assistantId] || ""}${data}`;
      });
    } catch (err) {
      assistantBufferRef.current[assistantId] = "";
      setMessages((current) => [
        ...current.filter((message) => message.id !== assistantId),
        makeMessage("assistant", err instanceof Error ? err.message : "恢复失败", ["error"])
      ]);
    } finally {
      const finalContent = assistantBufferRef.current[assistantId] || "";
      delete assistantBufferRef.current[assistantId];
      setMessages((current) =>
        finalContent
          ? current.map((message) =>
              message.id === assistantId
                ? { ...message, content: finalContent, sources: message.sources?.filter((source) => source !== "loading") }
                : message
            )
          : current.filter((message) => message.id !== assistantId || message.content)
      );
      setStreaming(false);
    }
  }

  async function loadThreads() {
    if (!token || !user) return;
    try {
      setThreads(await listThreads(token, "common_agent", user.name));
    } catch {
      /* ignore */
    }
  }

  async function loadWorkflowThreads() {
    if (!token || !user) return;
    try {
      setWorkflowThreads(await listThreads(token, "ppt_build", user.name));
    } catch {
      /* ignore */
    }
  }

  async function loadWorkflowHistory(tid: string) {
    if (!token || !user) return;
    try {
      const history = await getThreadHistory(token, "ppt_build", user.name, tid);
      setWorkflowMessages(history.map((h) => makeMessage(h.role === "user" ? "user" : "assistant", h.content)));
    } catch {
      setWorkflowMessages([]);
    }
  }

  function createNewWorkflowThread() {
    setWorkflowThreadId(crypto.randomUUID());
    setWorkflowMessages([]);
    setWorkflowSession(false);
  }

  function switchWorkflowThread(tid: string) {
    setWorkflowThreadId(tid);
    setWorkflowSession(true);
    loadWorkflowHistory(tid);
  }

  async function removeWorkflowThread(tid: string) {
    if (!token || !user) return;
    try {
      const result = await deleteThread(token, "ppt_build", user.name, tid);
      if (!result.deleted) throw new Error("会话不存在或已被删除");
      setWorkflowThreads((current) => current.filter((item) => item.thread_id !== tid));
      if (tid === workflowThreadId) {
        setWorkflowThreadId(crypto.randomUUID());
        setWorkflowMessages([]);
        setWorkflowSession(false);
      }
      messageApi.success("会话已删除");
    } catch (err) {
      loadWorkflowThreads();
      showError(err, "删除会话失败");
    }
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
    if (messages.length) messageApi.info("已开启新会话");
    setThreadId(crypto.randomUUID());
    setMessages([]);
    setPendingApproval(null);
  }

  function switchThread(tid: string) {
    setThreadId(tid);
    setPendingApproval(null);
    loadHistory(tid);
  }

  async function removeThread(tid: string) {
    if (!token || !user) return;
    try {
      const result = await deleteThread(token, "common_agent", user.name, tid);
      if (!result.deleted) throw new Error("会话不存在或已被删除");
      setThreads((current) => current.filter((item) => item.thread_id !== tid));
      if (tid === threadId) {
        setThreadId(crypto.randomUUID());
        setMessages([]);
        setPendingApproval(null);
      }
      messageApi.success("会话已删除");
    } catch (err) {
      loadThreads();
      showError(err, "删除会话失败");
    }
  }

  function startWorkflowSession() {
    setWorkflowSession(true);
    setWorkflowMessages([]);
    setWorkflowInput("");
    setWorkflowStep(0);
  }

  async function runWorkflow(content: string) {
    const text = content.trim();
    if (!text || workflowRunning) return;
    setWorkflowSession(true);
    setWorkflowRunning(true);
    setWorkflowStep(0);
    setWorkflowMessages([makeMessage("user", text)]);
    setWorkflowInput("");
    try {
      await streamSse(
        "/graph_run_sse",
        {
          graphName: "ppt_build",
          userId: user?.name ?? "web",
          threadId: workflowThreadId,
          newMessage: { content: text, role: "user" },
          inputs: null
        },
        token,
        ({ event, data }) => {
          if (event === "update") {
            const update = JSON.parse(data) as { node: string; values: Record<string, unknown> };
            setWorkflowStep((current) => current + 1);
            setWorkflowMessages((current) => [...current, makeMessage("assistant", `${workflowNodeLabel(update.node)}已完成`)]);
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

  async function resumeWorkflow(content: string) {
    const text = content.trim();
    if (!text || workflowRunning) return;
    setWorkflowRunning(true);
    setWorkflowMessages((current) => [...current, makeMessage("user", text)]);
    setWorkflowInput("");
    try {
      await streamSse(
        "/graph_resume_sse",
        { graphName: "ppt_build", userId: user?.name ?? "web", threadId: workflowThreadId, clarificationResponse: text },
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
      setWorkflowMessages((current) => [
        ...current,
        makeMessage("assistant", err instanceof Error ? err.message : "恢复工作流失败", ["error"])
      ]);
    } finally {
      setWorkflowRunning(false);
    }
  }

  async function uploadDocument(values: UploadValues) {
    const file = values.file?.[0]?.originFileObj as File | undefined;
    if (!file || file.size === 0) {
      messageApi.warning("请先选择要上传的文件");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    form.set("title", values.title || "未命名文档");
    form.set("description", values.description || "");
    form.set("knowledge_base_type", values.knowledgeBaseType || "DOCUMENT_SEARCH");
    form.set("accessible_by", (values.accessibleBy ?? []).join(","));
    if (values.tableName?.trim()) form.set("table_name", values.tableName.trim());
    try {
      const doc = await uploadDocumentApi(token, form);
      setDocuments((current) => [doc, ...current]);
      setShowUpload(false);
      messageApi.success("上传成功");
    } catch (err) {
      showError(err, "上传失败");
    }
  }

  async function deleteDocument(docId: number) {
    setBusyDocId(docId);
    try {
      await deleteDocumentApi(token, docId);
      setDocuments((current) => current.filter((doc) => doc.docId !== docId));
      setSelectedDocId(null);
      messageApi.success("文档已删除");
    } catch (err) {
      showError(err, "删除失败");
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
      showError(err, "状态更新失败");
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
      showError(err, "切片加载失败");
    }
  }

  if (!auth) {
    return (
      <>
        {contextHolder}
        <LoginView onLogin={handleLogin} />
      </>
    );
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#111827",
          borderRadius: 10,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          colorBgTextHover: "#f5f5f5",
          colorBgTextActive: "#e8e8e8",
          controlItemBgHover: "#f5f5f5",
          controlItemBgActive: "#e8e8e8"
        },
        components: {
          Menu: { itemSelectedBg: "#e8e8e8", itemActiveBg: "#f5f5f5" },
          Input: { activeBorderColor: "#d9d9d9", hoverBorderColor: "#d9d9d9" }
        }
      }}
    >
      <XProvider>
        {contextHolder}
        <div className={styles.layout}>
          {/* 侧栏：logo + 菜单 + 会话列表 + 用户信息（套用 ultramodern side 样式） */}
          <div className={styles.side}>
            <div className={styles.logo}>
              <Avatar shape="square" size={32} className="!bg-[#111827]" icon={<Sparkles className="h-4 w-4" />} />
              <span>Know-Agent</span>
            </div>
            <div className={styles.menu}>
              <Menu
                mode="inline"
                selectedKeys={[activeTab]}
                items={menuItems}
                onClick={({ key }) => setActiveTab(key as MainTab)}
              />
            </div>
            {(activeTab === "assistant" || activeTab === "workflow") ? (
              <Conversations
                className={styles.conversations}
                items={activeTab === "assistant" ? conversationItems : workflowConversationItems}
                activeKey={activeTab === "assistant" ? threadId : workflowThreadId}
                onActiveChange={(key) => (activeTab === "assistant" ? switchThread(key) : switchWorkflowThread(key))}
                groupable
                styles={{ item: { padding: "0 8px" } }}
                creation={{
                  onClick: () => (activeTab === "assistant" ? createNewThread() : createNewWorkflowThread()),
                }}
                menu={(conversation) => ({
                  items: [
                    {
                      label: "删除",
                      key: "delete",
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      danger: true,
                      onClick: () => (activeTab === "assistant" ? removeThread(conversation.key as string) : removeWorkflowThread(conversation.key as string))
                    }
                  ]
                })}
              />
            ) : null}
            <div className={styles.sideFooter}>
              <div className="flex min-w-0 items-center gap-2">
                <Avatar size="small" icon={<UserRound className="h-4 w-4" />} />
                <div className="min-w-0">
                  <Typography.Text strong className="block truncate text-sm leading-4">{user?.name}</Typography.Text>
                  <Typography.Text type="secondary" className="block truncate text-xs">{user?.roles.join(", ") || "无角色"}</Typography.Text>
                </div>
              </div>
              <Popconfirm title="退出登录" description="确定退出当前账号？" okText="退出" cancelText="取消" onConfirm={handleLogout}>
                <Button type="text" size="small" icon={<LogOut className="h-4 w-4" />} aria-label="退出登录" />
              </Popconfirm>
            </div>
          </div>

          {/* 主区：助理用 ultramodern chat 样式；其他 tab 用 header + content */}
          <div className={styles.chat}>
            {activeTab === "assistant" ? (
              <AssistantView
                input={input}
                messages={messages}
                streaming={streaming}
                setInput={setInput}
                sendMessage={sendMessage}
                pendingApproval={pendingApproval}
                onApprove={() => approveTool("APPROVED")}
                onReject={() => approveTool("REJECTED")}
                onCopyMessage={copyMessage}
              />
            ) : activeTab === "workflow" ? (
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
                onCopyMessage={copyMessage}
                backToWorkflowHome={() => setWorkflowSession(false)}
              />
            ) : (
              <div className={styles.contentWrap}>
                <div className={styles.header}>
                  <Typography.Title level={5} className="!mb-0">{activeTitle}</Typography.Title>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
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
                </div>
              </div>
            )}
          </div>
        </div>
      </XProvider>
    </ConfigProvider>
  );
}

function LoginView({ onLogin }: { onLogin: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#111827",
          borderRadius: 10,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }
      }}
    >
      <main className="grid min-h-screen bg-[#f6f7f4] text-[#111827] lg:grid-cols-[minmax(0,1fr)_420px]">
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
                <FormField name="password" label="密码" type="password" />
              </div>
              <Button htmlType="submit" type="primary" block size="large" className="mt-5">进入工作台</Button>
              <Typography.Paragraph type="success" className="!mt-4 !mb-0">登录后将保留你的会话和访问权限。</Typography.Paragraph>
            </form>
          </Card>
        </section>
      </main>
    </ConfigProvider>
  );
}

// 助理对话区：直接套用 ultramodern 的 chat 结构（Bubble.List + XMarkdown + Sender footer + agentName 空状态）
function AssistantView({
  input,
  messages,
  streaming,
  setInput,
  sendMessage,
  pendingApproval,
  onApprove,
  onReject,
  onCopyMessage
}: {
  input: string;
  messages: ChatMessage[];
  streaming: boolean;
  setInput: (value: string) => void;
  sendMessage: (content: string) => void;
  pendingApproval: { action_requests: { name: string; args: Record<string, unknown> }[] } | null;
  onApprove: () => void;
  onReject: () => void;
  onCopyMessage: (content: string) => void;
}) {
  const { styles } = useStyle();
  const [deepThink, setDeepThink] = useState(true);

  const roles: BubbleListProps["role"] = {
    user: { placement: "end" },
    assistant: {
      placement: "start",
      contentRender: (content: string) => (
        <XMarkdown streaming={{ enableAnimation: true }}>{content}</XMarkdown>
      ),
      footer: (content: string) =>
        content ? (
          <Button
            type="text"
            size="small"
            className="!text-[#9a9a92]"
            icon={<Copy className="h-3.5 w-3.5" />}
            onClick={() => onCopyMessage(content)}
          />
        ) : null
    },
    tool: {
      placement: "start",
      contentRender: (content: string) => (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
          {content}
        </div>
      )
    }
  };

  const bubbleItems = messages.map((message) => ({
    key: message.id,
    content: message.content,
    role: message.role,
    loading: message.role === "assistant" && !message.content && message.sources?.includes("loading")
  }));

  return (
    <>
      <div className={styles.chatList}>
        {messages.length > 0 && (
          <Bubble.List
            items={bubbleItems}
            role={roles}
            styles={{ root: { maxWidth: 940, margin: "0 auto", marginBlockEnd: 24 } }}
          />
        )}
        {pendingApproval ? (
          <Card size="small" className="mx-auto mt-3 max-w-[940px] border-[#f0d98c] bg-[#fffbe6]">
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
      <div className={clsx(styles.chatSender, { [styles.startPage]: messages.length === 0 })}>
        {messages.length === 0 && <div className={styles.agentName}>Know-Agent</div>}
        <Sender
          suffix={false}
          value={input}
          onChange={setInput}
          loading={streaming}
          onSubmit={(val) => sendMessage(val)}
          placeholder="Message Know-Agent"
          autoSize={{ minRows: 3, maxRows: 6 }}
          footer={(actionNode) => (
            <Flex justify="space-between" align="center">
              <Flex gap="small" align="center">
                <Sender.Switch
                  value={deepThink}
                  onChange={(checked: boolean) => setDeepThink(checked)}
                  icon={<Sparkles className="h-4 w-4" />}
                >
                  深度思考
                </Sender.Switch>
              </Flex>
              <Flex align="center">{actionNode}</Flex>
            </Flex>
          )}
        />
      </div>
    </>
  );
}

function WorkflowView({
  workflowSession,
  workflowMessages,
  workflowInput,
  workflowRunning,
  workflowStep,
  setWorkflowInput,
  startWorkflowSession,
  runWorkflow,
  resumeWorkflow,
  backToWorkflowHome
}: {
  workflowSession: boolean;
  workflowMessages: ChatMessage[];
  workflowInput: string;
  workflowRunning: boolean;
  workflowStep: number;
  setWorkflowInput: (value: string) => void;
  startWorkflowSession: () => void;
  runWorkflow: (content: string) => void;
  resumeWorkflow: (content: string) => void;
  onCopyMessage: (content: string) => void;
  backToWorkflowHome: () => void;
}) {
  const { styles } = useStyle();
  const chatListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatListRef.current?.scrollTo({ top: chatListRef.current.scrollHeight, behavior: "smooth" });
  }, [workflowMessages, workflowRunning]);

  const roles: BubbleListProps["role"] = {
    user: { placement: "end" },
    assistant: { placement: "start", contentRender: (content: string) => <XMarkdown streaming={{ enableAnimation: true }}>{content}</XMarkdown> },
    tool: { placement: "start" }
  };
  const bubbleItems = workflowMessages.map((message) => ({
    key: message.id,
    content: message.content,
    role: message.role,
    loading: message.role === "assistant" && !message.content && message.sources?.includes("loading")
  }));

  if (!workflowSession) {
    return (
      <div ref={chatListRef} className={styles.chatList}>
        <div className="mx-auto max-w-3xl px-4 py-5">
          <div className="mb-5">
            <Typography.Title level={4} className="!mb-1">PPT 生成工作流</Typography.Title>
            <Typography.Text type="secondary">输入主题、受众和页数，系统会整理材料并生成 PPT。</Typography.Text>
          </div>
          <Card>
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#f0f0eb]">
                <Presentation className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <Typography.Text strong>PPT 生成</Typography.Text>
                  <ToolPill>演示文稿</ToolPill>
                </div>
                <Typography.Paragraph className="!mt-2 !mb-0 text-sm leading-6 text-[#66665f]">
                  根据主题、受众和页数生成 PPT：需求澄清、资料检索、模板选择、提纲、Schema 和渲染。
                </Typography.Paragraph>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Tag>8 个节点</Tag>
                  <Tag>支持中断补充</Tag>
                  <Tag>实时进度</Tag>
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="primary" icon={<Play className="h-4 w-4" />} onClick={startWorkflowSession}>启动工作流</Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={chatListRef} className={styles.chatList}>
        <div className="mx-auto max-w-3xl px-4">
          <div className="flex items-center justify-between py-3">
            <Button type="link" className="!px-0" onClick={backToWorkflowHome}>← 返回</Button>
            <ToolPill>已完成节点 {workflowStep}</ToolPill>
          </div>
          {!workflowMessages.length && !workflowRunning ? (
            <div className="grid min-h-[40vh] place-items-center text-center">
              <div>
                <Typography.Title level={3} className="!mb-2">描述你要生成的 PPT</Typography.Title>
                <Typography.Text type="secondary">例如主题、受众、页数、风格和需要强调的内容。</Typography.Text>
              </div>
            </div>
          ) : null}
          {bubbleItems.length > 0 && (
            <Bubble.List items={bubbleItems} role={roles} styles={{ root: { maxWidth: 940, margin: "0 auto", marginBlockEnd: 24 } }} />
          )}
        </div>
      </div>
      <div className={clsx(styles.chatSender, { [styles.startPage]: !workflowMessages.length })}>
        {!workflowMessages.length && <div className={styles.agentName}>PPT 生成</div>}
        <Sender
          suffix={false}
          value={workflowInput}
          onChange={setWorkflowInput}
          loading={workflowRunning}
          onSubmit={(val) => (workflowMessages.length ? resumeWorkflow(val) : runWorkflow(val))}
          placeholder={workflowMessages.length ? "补充说明，例如受众、页数或风格" : "输入 PPT 需求，例如：做一份关于 AI 发展的 10 页技术团队汇报"}
          autoSize={{ minRows: 3, maxRows: 6 }}
        />
      </div>
    </>
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

function KnowledgeView({
  documents,
  segments,
  roles,
  selectedDocId,
  showUpload,
  docSearch,
  statusFilter,
  page,
  loadingDocs,
  busyDocId,
  setSelectedDocId,
  selectDocument,
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
  segments: SegmentItem[];
  roles: RoleItem[];
  selectedDocId: number | null;
  showUpload: boolean;
  docSearch: string;
  statusFilter: "ALL" | DocumentStatus;
  page: number;
  loadingDocs: boolean;
  busyDocId: number | null;
  setSelectedDocId: (value: number | null) => void;
  selectDocument: (docId: number) => void;
  setShowUpload: (value: boolean) => void;
  setDocSearch: (value: string) => void;
  setStatusFilter: (value: "ALL" | DocumentStatus) => void;
  setPage: (value: number) => void;
  uploadDocument: (values: UploadValues) => void;
  deleteDocument: (docId: number) => void;
  updateDocumentStatus: (docId: number, status: DocumentStatus) => void;
  refreshDocuments: () => void;
}) {
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

      <Card className="min-h-0 flex-1 overflow-hidden" styles={{ body: { padding: 0, height: "100%" } }}>
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
                <Button type="link" className="!px-0 !text-[#111827]" onClick={() => selectDocument(doc.docId)}>{text}</Button>
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
              width: 180,
              render: (_: unknown, doc: DocumentItem) => (
                <Space size="small">
                  <Button size="small" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => selectDocument(doc.docId)}>查看</Button>
                  <Popconfirm
                    title="删除文档"
                    description="删除文档及其所有切片，不可恢复。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => deleteDocument(doc.docId)}
                  >
                    <Button size="small" danger loading={busyDocId === doc.docId}>删除</Button>
                  </Popconfirm>
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

function DocumentDetail({
  doc,
  segments,
  busy,
  onBack,
  onDelete,
  onUpdateStatus
}: {
  doc: DocumentItem;
  segments: SegmentItem[];
  busy: boolean;
  onBack: () => void;
  onDelete: () => void;
  onUpdateStatus: (status: DocumentStatus) => void;
}) {
  const visibleLifecycle = documentLifecycle.filter((item) =>
    doc.knowledgeBaseType === "DATA_QUERY" ? item.status !== "VECTOR_STORED" : item.status !== "STORED"
  );
  const lifecycleIndex = Math.max(0, visibleLifecycle.findIndex((item) => item.status === doc.status));
  const nextActions =
    doc.status === "CONVERTED"
      ? [{ label: "执行分块", status: "CHUNKED" as const }]
      : doc.status === "CHUNKED"
        ? [{ label: "执行向量化", status: "VECTOR_STORED" as const }]
        : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Button type="link" className="!mb-1 !px-0" onClick={onBack}>返回文档列表</Button>
          <Typography.Title level={4} className="!mb-1">{doc.docTitle}</Typography.Title>
          <Typography.Text type="secondary">{doc.description || "暂无描述"}</Typography.Text>
        </div>
        <Space wrap>
          {nextActions.map((item) => (
            <Button key={item.label} type="primary" loading={busy} onClick={() => onUpdateStatus(item.status)}>{item.label}</Button>
          ))}
          <Popconfirm title="删除文档" description="删除文档及其所有切片，不可恢复。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onDelete}>
            <Button danger loading={busy}>删除</Button>
          </Popconfirm>
        </Space>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="基本信息">
          <Descriptions
            column={2}
            size="small"
            bordered
            items={[
              { key: "id", label: "文档 ID", children: doc.docId },
              { key: "user", label: "上传人", children: doc.uploadUser },
              { key: "type", label: "知识库类型", children: <Tag>{doc.knowledgeBaseType}</Tag> },
              { key: "roles", label: "可访问角色", children: doc.accessibleBy },
              { key: "created", label: "创建时间", children: doc.createdAt },
              { key: "updated", label: "更新时间", children: doc.updatedAt },
              { key: "status", label: "当前状态", children: <StatusBadge status={doc.status} /> },
              { key: "segments", label: "切片数量", children: segments.length }
            ]}
          />
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

function UploadDialog({
  roles,
  onClose,
  onSubmit
}: {
  roles: RoleItem[];
  onClose: () => void;
  onSubmit: (values: UploadValues) => Promise<void> | void;
}) {
  const [form] = Form.useForm<UploadValues>();
  const [submitting, setSubmitting] = useState(false);
  const knowledgeBaseType = Form.useWatch("knowledgeBaseType", form);
  const handleFinish = async (values: UploadValues) => {
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal
      open
      title="上传文档"
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={680}
      closable={!submitting}
      maskClosable={!submitting}
    >
      <Typography.Paragraph type="secondary">上传后会自动解析，并进入知识库处理流程。</Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        className="mt-4"
        onFinish={handleFinish}
        initialValues={{
          title: "",
          description: "",
          knowledgeBaseType: "DOCUMENT_SEARCH",
          tableName: "",
          accessibleBy: []
        }}
      >
        <Form.Item
          name="file"
          label="文件"
          valuePropName="fileList"
          getValueFromEvent={(e: unknown) => (Array.isArray(e) ? e : (e as { fileList?: unknown })?.fileList)}
          rules={[{ required: true, message: "请选择文件" }]}
        >
          <Upload.Dragger
            beforeUpload={() => false}
            maxCount={1}
            onChange={(info) => {
              const f = info.fileList[0]?.originFileObj as File | undefined;
              if (f) {
                const name = f.name.replace(/\.[^.]+$/, "");
                form.setFieldsValue({ title: name, description: name });
              }
            }}
          >
            <p className="ant-upload-drag-icon">
              <UploadCloud className="mx-auto h-8 w-8 text-[#8b8b84]" />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">支持 PDF / Word / Excel / CSV / TXT / Markdown</p>
          </Upload.Dragger>
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="title" label="文档标题" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="description" label="描述">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="knowledgeBaseType" label="知识库类型" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: "DOCUMENT_SEARCH", label: "文档检索" },
                  { value: "DATA_QUERY", label: "数据查询" }
                ]}
              />
            </Form.Item>
          </Col>
          {knowledgeBaseType === "DATA_QUERY" && (
            <Col span={12}>
              <Form.Item name="tableName" label="表名">
                <Input />
              </Form.Item>
            </Col>
          )}
          <Col span={24}>
            <Form.Item name="accessibleBy" label="可访问角色" extra="不选择则按公开文档处理。">
              <Select
                mode="multiple"
                allowClear
                placeholder="选择可访问的角色"
                options={roles.map((role) => ({ value: role.name, label: role.displayName || role.name }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>取消</Button>
          <Button htmlType="submit" type="primary" loading={submitting} disabled={submitting}>上传</Button>
        </div>
      </Form>
    </Modal>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const colors: Record<DocumentStatus, string> = {
    CONVERTED: "blue",
    CHUNKED: "gold",
    VECTOR_STORED: "green",
    STORED: "cyan"
  };
  return <Tag color={colors[status]}>{statusLabel(status)}</Tag>;
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

function FormField({
  name,
  label,
  defaultValue,
  type = "text"
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
}) {
  const control = type === "password" ? <Input.Password name={name} defaultValue={defaultValue} size="large" /> : <Input name={name} defaultValue={defaultValue} size="large" />;
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-[#4b5563]">{label}</span>
      {control}
    </label>
  );
}

function LoginFeature({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#e5e7eb] bg-white p-3">
      <Avatar shape="square" className="bg-[#f3f4f6] text-[#111827]" icon={<Icon className="h-4 w-4" />} />
      <Typography.Text strong>{title}</Typography.Text>
    </div>
  );
}

function ToolPill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full bg-[#f0f0eb] px-2 text-xs font-medium text-[#5f5f5a]">{children}</span>;
}
