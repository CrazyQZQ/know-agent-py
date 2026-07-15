import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Circle, LoaderCircle, PanelRightClose, PanelRightOpen, XCircle } from "lucide-react";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/AuthProvider";
import { streamSse, type SseEvent } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

type StepUpdate = { node: string; values?: Record<string, unknown> };
type RunStatus = "idle" | "running" | "waiting" | "done" | "error" | "stopped";
type Clarification = { question: string; options: string[] };
type WorkflowMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  node?: string;
};

const STEP_DEFINITIONS = [
  { id: "requirement", label: "需求分析", description: "理解主题、受众、页数和表达目标" },
  { id: "clarification", label: "需求澄清", description: "补充生成演示文稿所需的信息" },
  { id: "search", label: "资料搜索", description: "收集与主题相关的可靠材料" },
  { id: "template_select", label: "模板选择", description: "确定演示文稿的视觉模板" },
  { id: "template_info", label: "模板解析", description: "分析模板版式和可用页面" },
  { id: "outline", label: "内容提纲", description: "规划章节和叙事顺序" },
  { id: "schema", label: "页面结构", description: "生成逐页内容和布局结构" },
  { id: "render", label: "渲染导出", description: "生成并导出最终 PPT 文件" },
] as const;

const STATUS_COPY: Record<RunStatus, string> = { idle: "等待运行", running: "运行中", waiting: "等待补充", done: "已完成", error: "运行失败", stopped: "已停止" };

function readClarification(raw: string): Clarification {
  try {
    const data = JSON.parse(raw) as { clarification?: string; clarification_options?: Array<{ question?: string; options?: Array<{ label?: string; value?: string } | string> }> };
    const first = data.clarification_options?.[0];
    const options = (first?.options ?? []).map((item) => typeof item === "string" ? item : item.label ?? item.value ?? "").filter(Boolean);
    return { question: first?.question || data.clarification || "请补充更多信息", options };
  } catch { return { question: raw || "请补充更多信息", options: [] }; }
}

function readString(values: Record<string, unknown> | undefined, key: string): string {
  const value = values?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function templateSummary(raw: string): string {
  try {
    const template = JSON.parse(raw) as { template_name?: string; slide_count?: number; template_desc?: string };
    const title = template.template_name || "演示文稿模板";
    const count = template.slide_count ? `，包含 ${template.slide_count} 种基础版式` : "";
    const description = template.template_desc ? `\n\n${template.template_desc}` : "";
    return `已完成模板解析：${title}${count}。${description}`;
  } catch { return "已完成模板结构解析。"; }
}

function schemaSummary(raw: string): string {
  const normalized = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const schema = JSON.parse(normalized) as unknown;
    const pageCount = Array.isArray(schema) ? schema.length : schema && typeof schema === "object" && Array.isArray((schema as { slides?: unknown[] }).slides) ? (schema as { slides: unknown[] }).slides.length : 0;
    return pageCount ? `已生成 ${pageCount} 页演示文稿的内容与版式结构。完整结构可在右侧“输出”中查看。` : "已生成逐页内容与版式结构，完整结构可在右侧“输出”中查看。";
  } catch { return "已生成逐页内容与版式结构，完整结构可在右侧“输出”中查看。"; }
}

function stepMessage(update: StepUpdate): string | null {
  const { node, values } = update;
  if (node === "requirement") return readString(values, "requirement") || null;
  if (node === "clarification") return null;
  if (node === "search") return readString(values, "search_info") || "资料搜索已完成。";
  if (node === "template_select") {
    const template = readString(values, "template_code");
    return template ? `已选择模板：${template}` : "已完成模板选择。";
  }
  if (node === "template_info") return templateSummary(readString(values, "template_info"));
  if (node === "outline") return readString(values, "ppt_outline") || "演示文稿提纲已生成。";
  if (node === "schema") return schemaSummary(readString(values, "ppt_schema"));
  if (node === "render") {
    const url = readString(values, "ppt_result");
    return url ? `PPT 已生成。\n\n[下载演示文稿](${url})` : "PPT 渲染已完成。";
  }
  return null;
}

function createMessage(role: WorkflowMessage["role"], content: string, node?: string): WorkflowMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date(), node };
}

export function WorkflowRunPage() {
  const { auth } = useAuth();
  const { workflowId = "ppt", threadId: routeThreadId } = useParams<{ workflowId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const generatedThreadId = useRef(crypto.randomUUID());
  const threadId = routeThreadId ?? generatedThreadId.current;
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<WorkflowMessage[]>([]);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [selectedNode, setSelectedNode] = useState("requirement");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "output">("details");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const completedNodes = useMemo(() => new Set(steps.map((step) => step.node)), [steps]);
  const latestByNode = useMemo(() => new Map(steps.map((step) => [step.node, step])), [steps]);
  const selectedStep = latestByNode.get(selectedNode);
  const lastCompletedIndex = STEP_DEFINITIONS.reduce((last, step, index) => completedNodes.has(step.id) ? index : last, -1);
  const activeIndex = status === "waiting" ? 1 : status === "running" ? Math.min(lastCompletedIndex + 1, STEP_DEFINITIONS.length - 1) : lastCompletedIndex;

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, status]);

  function consume(event: SseEvent) {
    if (event.event === "update") {
      try {
        const update = JSON.parse(event.data) as StepUpdate;
        setSteps((current) => [...current, update]);
        setSelectedNode(update.node);
        const content = stepMessage(update);
        if (content) setMessages((current) => [...current, createMessage("assistant", content, update.node)]);
        const updateResult = readString(update.values, "ppt_result");
        if (updateResult) setResult(updateResult);
      } catch { /* ignore malformed update */ }
    } else if (event.event === "done") {
      setStatus("done");
      setSelectedNode("render");
      try {
        const nextResult = String((JSON.parse(event.data) as { ppt_result?: string }).ppt_result ?? "");
        setResult(nextResult);
        if (nextResult) {
          setMessages((current) => current.some((message) => message.node === "render")
            ? current
            : [...current, createMessage("assistant", `PPT 已生成。\n\n[下载演示文稿](${nextResult})`, "render")]);
        }
      } catch { setResult(event.data); }
    } else if (event.event === "interrupt" || event.event === "tool") {
      const nextClarification = readClarification(event.data);
      setStatus("waiting");
      setClarification(nextClarification);
      setInput("");
      setSelectedNode("clarification");
      setMessages((current) => [...current, createMessage("assistant", nextClarification.question, "clarification")]);
    } else if (event.event === "error") {
      setStatus("error");
      setResult(event.data);
      setMessages((current) => [...current, createMessage("assistant", event.data || "工作流运行失败")]);
      setDetailTab("output");
      setDetailsOpen(true);
    }
  }

  async function run(requirement: string) {
    const text = requirement.trim();
    if (!text) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput("");
    setMessages((current) => [...current, createMessage("user", text)]);
    setStatus("running");
    setStartedAt(new Date());
    setSteps([]);
    setResult("");
    setClarification(null);
    setSelectedNode("requirement");
    navigate(`/workflows/${workflowId}/${threadId}`, { replace: true });
    try {
      await streamSse({ path: "/v1/graph_run_sse", token: auth?.token, signal: controller.signal, body: { graphName: workflowId, threadId, newMessage: { role: "user", content: text } }, onEvent: consume });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus("error");
        setResult("工作流运行失败");
        setMessages((current) => [...current, createMessage("assistant", "工作流运行失败，请稍后重试。")]);
      }
    } finally {
      abortRef.current = null;
      setStatus((current) => current === "running" ? "idle" : current);
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("stopped");
    setMessages((current) => [...current, createMessage("assistant", "已停止本次工作流。")]);
  }

  async function resume(response: string) {
    const text = response.trim();
    if (!text) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setInput("");
    setMessages((current) => [...current, createMessage("user", text)]);
    setClarification(null);
    setStatus("running");
    try {
      await streamSse({ path: "/v1/graph_resume_sse", token: auth?.token, signal: controller.signal, body: { graphName: workflowId, threadId, clarificationResponse: text }, onEvent: consume });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus("error");
        setResult("工作流继续运行失败");
        setMessages((current) => [...current, createMessage("assistant", "工作流继续运行失败，请稍后重试。")]);
      }
    } finally {
      abortRef.current = null;
      setStatus((current) => current === "running" ? "idle" : current);
    }
  }

  function send(value: string) {
    if (status === "waiting") void resume(value);
    else void run(value);
  }

  return <div className="relative flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/55 px-5">
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" asChild><Link to="/workflows" aria-label="返回工作流"><ArrowLeft className="h-4 w-4" /></Link></Button>
      <div className="min-w-0"><h1 className="truncate text-[15px] font-semibold">{workflowId === "ppt" ? "PPT 工作流" : workflowId}</h1><p className="text-xs text-muted-foreground">引导式生成工作台</p></div>
      <span className={cn("ml-2 rounded-full px-2.5 py-1 text-[11px] font-medium", status === "running" ? "bg-blue-500/10 text-blue-600" : status === "waiting" ? "bg-amber-500/10 text-amber-700" : status === "done" ? "bg-emerald-500/10 text-emerald-700" : status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{STATUS_COPY[status]}</span>
      <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 rounded-full" aria-label={detailsOpen ? "收起运行详情" : "展开运行详情"} onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button>
    </header>

    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-52 shrink-0 overflow-y-auto border-r border-border/50 px-3 py-4 md:block" aria-label="工作流步骤">
        <div className="px-2 pb-3 text-[11px] font-medium text-muted-foreground">执行步骤</div>
        <ol className="space-y-0.5">{STEP_DEFINITIONS.map((step, index) => {
          const complete = status === "done" || completedNodes.has(step.id);
          const active = index === activeIndex && (status === "running" || status === "waiting");
          const failed = status === "error" && selectedNode === step.id;
          return <li key={step.id}><button type="button" onClick={() => setSelectedNode(step.id)} className={cn("flex w-full items-start gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors hover:bg-muted/55", selectedNode === step.id && "bg-muted/70")}>
            <span className="mt-0.5">{failed ? <XCircle className="h-4 w-4 text-destructive" /> : active ? <LoaderCircle className="h-4 w-4 animate-spin text-blue-500 motion-reduce:animate-none" /> : complete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground/45" />}</span>
            <span className="min-w-0"><span className="block text-[12.5px] font-medium">{step.label}</span><span className="mt-0.5 block text-[10.5px] leading-4 text-muted-foreground">{step.description}</span></span>
          </button></li>;
        })}</ol>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col" aria-label="工作流内容">
        <section className="min-h-0 flex-1 overflow-y-auto" aria-label="工作流对话">
          <div className="mx-auto flex min-h-full w-full max-w-[52rem] flex-col px-5 py-7 md:px-8">
            {messages.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center"><h2 className="text-lg font-semibold">从演示文稿需求开始</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">在下方输入主题、受众、页数和风格，工作流会逐步返回处理结果。</p></div> : <div className="space-y-6 py-2">
              {messages.map((message) => <ChatMessageRow key={message.id} role={message.role} content={message.content} createdAt={message.createdAt} />)}
              {status === "running" ? <ChatMessageRow role="assistant" content="" createdAt={Date.now()} isStreaming /> : null}
              <div ref={messageEndRef} />
            </div>}
          </div>
        </section>

        <div className="shrink-0 border-t border-border/40 bg-background/95 px-4 pb-4 pt-3 backdrop-blur-sm md:px-8">
          {status === "waiting" && clarification?.options.length ? <div className="mx-auto mb-2 flex max-w-[49.5rem] flex-wrap items-center gap-2 px-1">
            {clarification.options.map((option) => <Button key={option} variant="outline" size="sm" className="h-8 rounded-full bg-background" onClick={() => setInput(option)}>{option}</Button>)}
            <Button variant="ghost" size="sm" className="h-8 rounded-full text-muted-foreground" onClick={() => void resume("REJECTED")}>终止本次流程</Button>
          </div> : null}
          <ChatComposer value={input} onChange={setInput} onSend={send} isStreaming={status === "running"} onStop={stop} placeholder={status === "waiting" ? "补充信息以继续工作流" : "描述你想生成的演示文稿"} />
        </div>
      </main>

      <aside aria-label="运行详情" className={cn("border-l border-border/50 bg-background", detailsOpen ? "fixed inset-y-0 right-0 z-30 flex w-80 flex-col shadow-[-18px_0_50px_rgba(15,23,42,0.12)] xl:static xl:shadow-none" : "hidden xl:flex xl:w-72 xl:flex-col")}>
        <div className="flex h-14 items-center border-b border-border/50 px-3"><button type="button" onClick={() => setDetailTab("details")} className={cn("h-8 rounded-full px-3 text-xs font-medium", detailTab === "details" ? "bg-muted" : "text-muted-foreground")}>运行详情</button><button type="button" onClick={() => setDetailTab("output")} className={cn("h-8 rounded-full px-3 text-xs font-medium", detailTab === "output" ? "bg-muted" : "text-muted-foreground")}>输出</button><Button variant="ghost" size="icon" className="ml-auto h-8 w-8 rounded-full xl:hidden" aria-label="关闭运行详情" onClick={() => setDetailsOpen(false)}><PanelRightClose className="h-4 w-4" /></Button></div>
        {detailTab === "details" ? <dl className="divide-y divide-border/45 px-4 text-xs"><div className="py-4"><dt className="text-muted-foreground">运行状态</dt><dd className="mt-1 font-medium">{STATUS_COPY[status]}</dd></div><div className="py-4"><dt className="text-muted-foreground">运行 ID</dt><dd className="mt-1 break-all font-mono text-[11px]">{threadId}</dd></div><div className="py-4"><dt className="text-muted-foreground">开始时间</dt><dd className="mt-1 font-medium">{startedAt ? startedAt.toLocaleTimeString("zh-CN", { hour12: false }) : "-"}</dd></div><div className="py-4"><dt className="text-muted-foreground">已完成步骤</dt><dd className="mt-1 font-medium">{completedNodes.size} / {STEP_DEFINITIONS.length}</dd></div></dl> : <div className="min-h-0 flex-1 overflow-auto p-4">{selectedStep ? <><div className="mb-3 text-xs font-medium">{STEP_DEFINITIONS.find((step) => step.id === selectedStep.node)?.label ?? selectedStep.node}</div><pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{JSON.stringify(selectedStep.values ?? {}, null, 2)}</pre></> : result ? <pre className="whitespace-pre-wrap break-words text-xs leading-5">{result}</pre> : <p className="text-xs text-muted-foreground">节点完成后在这里查看完整输出。</p>}</div>}
      </aside>
    </div>
  </div>;
}
