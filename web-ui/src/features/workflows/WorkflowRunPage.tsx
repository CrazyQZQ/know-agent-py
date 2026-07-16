import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { gsap } from "gsap";
import { ArrowLeft, Check, CheckCircle2, Circle, Copy, Download, LoaderCircle, PanelRightClose, PanelRightOpen, XCircle } from "lucide-react";

import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { MarkdownText } from "@/components/MarkdownText";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { Button } from "antd";
import { useAuth } from "@/features/auth/AuthProvider";
import { getGraphTopology, listGraphs, type GraphNode } from "@/features/workflows/workflow-api";
import { ApiError } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { streamSse, type SseEvent } from "@/lib/sse-client";
import { cn } from "@/lib/utils";
import { eventFingerprint, extractClarificationOptions, parseInterruptForm, parsePresentation, upsertStepUpdate, type InterruptForm, type StepUpdate, type WorkflowPresentation } from "./workflow-message";

type RunStatus = "idle" | "running" | "waiting" | "done" | "error" | "stopped";
type FormValue = string | string[];
type Clarification = { question: string; options: string[]; form?: InterruptForm };
type UserMessage = { id: string; role: "user"; content: string; createdAt: Date };
type ActiveRun = {
  id: string;
  createdAt: Date;
  status: RunStatus;
  node?: string;
  presentation?: WorkflowPresentation;
  clarification?: Clarification;
};

const STEP_PRESENTATION: Record<string, { label: string; description: string }> = {
  requirement: { label: "需求分析", description: "理解主题、受众、页数和表达目标" },
  clarification: { label: "需求澄清", description: "补充生成演示文稿所需的信息" },
  search: { label: "资料检索", description: "收集与主题相关的可靠材料" },
  template_select: { label: "模板选择", description: "确定演示文稿的视觉模板" },
  template_info: { label: "模板解析", description: "分析模板版式和可用页面" },
  outline: { label: "内容大纲", description: "规划章节和叙事顺序" },
  schema: { label: "页面结构", description: "生成逐页内容和布局结构" },
  render: { label: "渲染导出", description: "生成并导出最终文件" },
};

const STATUS_COPY: Record<RunStatus, string> = { idle: "等待运行", running: "运行中", waiting: "等待补充", done: "已完成", error: "运行失败", stopped: "已停止" };

function readClarification(raw: string): Clarification {
  const form = parseInterruptForm(raw);
  if (form) return { question: form.description || form.title, options: [], form };
  try {
    const data = JSON.parse(raw) as {
      clarification?: string;
      clarification_options?: Array<{ question?: string; options?: Array<{ label?: string; value?: string } | string> } | string>;
    };
    const groups = data.clarification_options ?? [];
    const first = groups[0];
    const options = groups.flatMap((item) => {
      if (typeof item === "string") return [item];
      return (item.options ?? []).map((option) => typeof option === "string" ? option : option.label ?? option.value ?? "");
    }).filter(Boolean);
    const question = typeof first === "object" ? first.question : "";
    const resolvedQuestion = question || data.clarification || "请补充更多信息";
    return { question: resolvedQuestion, options: options.length ? options : extractClarificationOptions(resolvedQuestion) };
  } catch {
    return { question: raw || "请补充更多信息", options: extractClarificationOptions(raw) };
  }
}

function createUserMessage(content: string): UserMessage {
  return { id: crypto.randomUUID(), role: "user", content, createdAt: new Date() };
}

function WorkflowInterruptForm({ form, values, onChange, onSubmit, onCancel }: { form: InterruptForm; values: Record<string, FormValue>; onChange: (id: string, value: FormValue) => void; onSubmit: () => void; onCancel: () => void }) {
  const missingRequired = form.fields.some((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return !value || (Array.isArray(value) ? value.length === 0 : !value.trim());
  });
  return <div className="mt-4 space-y-4">
    {form.fields.map((field) => {
      const current = values[field.id] ?? (field.type === "multi_select" ? [] : "");
      return <div key={field.id} className="space-y-2">
        <label htmlFor={`workflow-field-${field.id}`} className="block text-sm font-medium">{field.label}{field.required ? <span className="ml-1 text-destructive">*</span> : null}</label>
        {field.type === "textarea" ? <textarea id={`workflow-field-${field.id}`} value={typeof current === "string" ? current : current.join("、")} onChange={(event) => onChange(field.id, event.target.value)} rows={3} className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-blue-400" /> : <div className="flex flex-wrap gap-2">{field.options.map((option) => {
          const selected = Array.isArray(current) ? current.includes(option.value) : current === option.value;
          return <button key={option.value} type="button" aria-pressed={selected} onClick={() => {
            if (field.type === "multi_select") {
              const next = Array.isArray(current) ? current : [];
              onChange(field.id, selected ? next.filter((value) => value !== option.value) : [...next, option.value]);
            } else onChange(field.id, option.value);
          }} className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", selected ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{option.label}</button>;
        })}</div>}
      </div>;
    })}
    <div className="flex flex-wrap gap-2 pt-1"><Button type="primary" size="small" disabled={missingRequired} onClick={onSubmit}>继续生成</Button><Button size="small" type="text" onClick={onCancel}>终止流程</Button></div>
  </div>;
}

function WorkflowRunMessage({ run, activeLabel, formValues, onFormChange, onFormSubmit, onFormCancel }: { run: ActiveRun; activeLabel?: string; formValues: Record<string, FormValue>; onFormChange: (id: string, value: FormValue) => void; onFormSubmit: () => void; onFormCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const sourceBody = run.clarification?.question ?? run.presentation?.body ?? "";
  const [body, setBody] = useState(sourceBody);
  useEffect(() => {
    if (run.clarification || run.status === "error" || run.status === "stopped") {
      setBody(sourceBody);
      return;
    }
    setBody("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setBody(sourceBody.slice(0, index));
      if (index >= sourceBody.length) window.clearInterval(timer);
    }, 16);
    return () => window.clearInterval(timer);
  }, [sourceBody, run.clarification]);
  useEffect(() => {
    const article = articleRef.current;
    if (!article || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = gsap.fromTo(article, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.22, ease: "power2.out" });
    return () => { animation.kill(); };
  }, []);
  const copy = async () => {
    if (!body || !(await copyTextToClipboard(body))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  const icon = run.status === "error" ? <XCircle className="h-4 w-4 text-destructive" />
    : run.status === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      : run.status === "running" ? <LoaderCircle className="h-4 w-4 animate-spin text-blue-500 motion-reduce:animate-none" />
        : run.status === "stopped" ? <Circle className="h-4 w-4 text-muted-foreground" />
          : <CheckCircle2 className="h-4 w-4 text-amber-600" />;
  const headline = run.clarification ? "需要补充信息" : run.presentation?.headline ?? STATUS_COPY[run.status];
  return (
    <article ref={articleRef} className="flex w-full justify-start">
      <div className="min-w-0 max-w-[min(92%,46rem)]">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}<span>{headline}</span>
          {activeLabel && run.status === "running" ? <span className="text-xs font-normal text-muted-foreground">· {activeLabel}</span> : null}
        </div>
        <div className="mt-2 max-w-none text-[13px] leading-5 text-foreground/90">
          {run.status === "running" && !body ? <span aria-label="Assistant typing" className="inline-flex items-center gap-1 py-1">{[0, 1, 2].map((index) => <span key={index} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none" style={{ animationDelay: `${index * 150}ms` }} />)}</span> : null}
          {body ? <MarkdownText>{body}</MarkdownText> : null}
          {run.clarification?.form ? <WorkflowInterruptForm form={run.clarification.form} values={formValues} onChange={onFormChange} onSubmit={onFormSubmit} onCancel={onFormCancel} /> : null}
          {run.presentation?.artifactUrl ? <a href={run.presentation.artifactUrl} target="_blank" rel="noreferrer noopener" className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" />{run.presentation.artifactLabel ?? "下载结果"}</a> : null}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <time dateTime={run.createdAt.toISOString()}>{run.createdAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
          <button type="button" aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy message"} onClick={() => void copy()} className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>
        </div>
      </div>
    </article>
  );
}

export function WorkflowRunPage() {
  const { auth } = useAuth();
  const { workflowId = "ppt_build", threadId: routeThreadId } = useParams<{ workflowId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const generatedThreadId = useRef(crypto.randomUUID());
  const threadId = routeThreadId ?? generatedThreadId.current;
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UserMessage[]>([]);
  const [runMessages, setRunMessages] = useState<ActiveRun[]>([]);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [selectedNode, setSelectedNode] = useState("requirement");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [formValues, setFormValues] = useState<Record<string, FormValue>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "output">("details");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [mermaidDefinition, setMermaidDefinition] = useState("");
  const [workflowTitle, setWorkflowTitle] = useState(workflowId);
  const [pageError, setPageError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const seenEventsRef = useRef(new Set<string>());
  const stoppedRef = useRef(false);

  const activeRun = runMessages.at(-1) ?? null;
  function appendRunMessage(message: ActiveRun, replaceNode = false) {
    setRunMessages((current) => {
      const settled = current.map((item) => item.status === "running" && item.node !== message.node ? { ...item, status: "idle" as const } : item);
      if (replaceNode && message.node) {
        const index = settled.findIndex((item) => item.node === message.node && item.status === "running");
        if (index >= 0) return settled.map((item, itemIndex) => itemIndex === index ? { ...item, ...message } : item);
      }
      return [...settled, message];
    });
  }

  const completedNodes = useMemo(() => new Set(steps.map((step) => step.node)), [steps]);
  const stepDefinitions = useMemo(() => graphNodes.map((node) => ({ id: node.id, label: STEP_PRESENTATION[node.id]?.label ?? node.name, description: STEP_PRESENTATION[node.id]?.description ?? "工作流节点" })), [graphNodes]);
  const latestByNode = useMemo(() => new Map(steps.map((step) => [step.node, step])), [steps]);
  const selectedStep = latestByNode.get(selectedNode);
  const lastCompletedIndex = stepDefinitions.reduce((last, step, index) => completedNodes.has(step.id) ? index : last, -1);
  const clarificationIndex = stepDefinitions.findIndex((step) => step.id === "clarification");
  const activeIndex = status === "waiting" ? clarificationIndex : status === "running" ? Math.min(lastCompletedIndex + 1, stepDefinitions.length - 1) : lastCompletedIndex;
  const activeLabel = activeRun?.node ? stepDefinitions.find((step) => step.id === activeRun.node)?.label : undefined;

  useEffect(() => {
    let cancelled = false;
    setPageError("");
    void Promise.all([getGraphTopology(workflowId, auth?.token), listGraphs(auth?.token)]).then(([topology, graphs]) => {
      if (cancelled) return;
      setGraphNodes(topology.nodes);
      setMermaidDefinition(topology.mermaid);
      setWorkflowTitle(graphs.find((graph) => graph.name === workflowId)?.title ?? workflowId);
      if (topology.nodes.length > 0) setSelectedNode((current) => topology.nodes.some((node) => node.id === current) ? current : topology.nodes[0].id);
    }, (error) => {
      if (!cancelled) setPageError(error instanceof ApiError && error.status === 404 ? "工作流不存在或已下线" : "工作流信息加载失败，请稍后重试。");
    });
    return () => { cancelled = true; };
  }, [auth?.token, workflowId]);

  useEffect(() => { messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages, runMessages, status]);

  function consume(event: SseEvent) {
    if (stoppedRef.current) return;
    const key = event.id ? `id:${event.id}` : eventFingerprint(event);
    if (seenEventsRef.current.has(key)) return;
    seenEventsRef.current.add(key);
    if (event.event === "update") {
      try {
        const update = JSON.parse(event.data) as StepUpdate;
        if (update.node.startsWith("__")) return;
        setSteps((current) => upsertStepUpdate(current, update));
        setSelectedNode(update.node);
        const presentation = parsePresentation(update.presentation) ?? undefined;
        if (presentation && presentation.kind !== "silent") appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "running", node: update.node, presentation }, true);
      } catch { /* Ignore malformed update frames. */ }
    } else if (event.event === "done") {
      setStatus("done");
      const resultNode = graphNodes.at(-1)?.id ?? "render";
      setSelectedNode(resultNode);
      try {
        const payload = JSON.parse(event.data) as { result?: unknown; presentation?: unknown };
        const nextResult = String(payload.result ?? "");
        setResult(nextResult);
        const donePresentation = parsePresentation(payload.presentation);
        appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "done", node: resultNode, ...(donePresentation ? { presentation: donePresentation } : {}) });
      } catch { setResult(event.data); }
    } else if (event.event === "interrupt" || event.event === "tool") {
      const nextClarification = readClarification(event.data);
      setStatus("waiting");
      setClarification(nextClarification);
      setInput("");
      setFormValues(nextClarification.form ? Object.fromEntries(nextClarification.form.fields.map((field) => [field.id, field.type === "multi_select" ? [] : ""])) : {});
      setSelectedNode("clarification");
      appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "waiting", node: "clarification", clarification: nextClarification });
    } else if (event.event === "error") {
      setStatus("error");
      setResult(event.data);
      setDetailTab("output");
      setDetailsOpen(true);
      appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "error", presentation: { kind: "message", headline: "工作流运行失败", body: event.data || "工作流运行失败。" } });
    }
  }

  async function run(requirement: string) {
    const text = requirement.trim();
    if (!text) return;
    const controller = new AbortController();
    abortRef.current = controller;
    seenEventsRef.current.clear();
    stoppedRef.current = false;
    setInput("");
    setMessages((current) => [...current, createUserMessage(text)]);
    setRunMessages([]);
    setStatus("running");
    setStartedAt(new Date());
    setSteps([]);
    setResult("");
    setClarification(null);
    setFormValues({});
    setSelectedNode(graphNodes[0]?.id ?? "requirement");
    navigate(`/workflows/${workflowId}/${threadId}`, { replace: true });
    try {
      await streamSse({ path: "/v1/graph_run_sse", token: auth?.token, signal: controller.signal, body: { graphName: workflowId, threadId, newMessage: { role: "user", content: text } }, onEvent: consume });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message = error instanceof ApiError && error.status === 404 ? "工作流不存在或已下线" : "工作流运行失败，请稍后重试。";
        setStatus("error");
        setResult(message);
        appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "error", presentation: { kind: "message", headline: "工作流运行失败", body: error instanceof ApiError && error.status === 404 ? "工作流不存在或已下线" : message } });
      }
    } finally {
      abortRef.current = null;
      setStatus((current) => current === "running" ? "idle" : current);
      setRunMessages((current) => current.map((message, index) => index === current.length - 1 && message.status === "running" ? { ...message, status: "idle" } : message));
    }
  }

  function stop() {
    stoppedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("stopped");
    appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "stopped", presentation: { kind: "message", headline: "本次运行已停止", body: "可以重新输入需求开始新的工作流。" } });
  }

  async function resume(payload: { clarificationResponse?: string; answers?: Array<{ id: string; value: FormValue; label?: string }> }, displayText: string) {
    if (!payload.clarificationResponse && !payload.answers?.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;
    setInput("");
    setMessages((current) => [...current, createUserMessage(displayText)]);
    setClarification(null);
    setFormValues({});
    setStatus("running");
    try {
      await streamSse({ path: "/v1/graph_resume_sse", token: auth?.token, signal: controller.signal, body: { graphName: workflowId, threadId, ...payload }, onEvent: consume });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message = error instanceof ApiError && error.status === 404 ? "工作流不存在或已下线" : "工作流继续运行失败，请稍后重试。";
        setStatus("error");
        setResult(message);
        appendRunMessage({ id: crypto.randomUUID(), createdAt: new Date(), status: "error", presentation: { kind: "message", headline: "工作流运行失败", body: message } });
      }
    } finally {
      abortRef.current = null;
      setStatus((current) => current === "running" ? "idle" : current);
      setRunMessages((current) => current.map((message, index) => index === current.length - 1 && message.status === "running" ? { ...message, status: "idle" } : message));
    }
  }

  function resumeForm() {
    const form = clarification?.form;
    if (!form) return;
    const answers = form.fields.map((field) => {
      const value = formValues[field.id] ?? (field.type === "multi_select" ? [] : "");
      const values = Array.isArray(value) ? value : [value];
      const label = values.map((item) => field.options.find((option) => option.value === item)?.label ?? item).filter(Boolean).join("、");
      return { id: field.id, value, label };
    });
    void resume({ answers }, "已提交补充信息");
  }

  function send(value: string) { if (status === "waiting") void resume({ clarificationResponse: value.trim() }, value.trim()); else void run(value); }

  return <div className="relative flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/55 px-5">
      <Button type="text" className="h-8 w-8 rounded-full" aria-label="返回工作流" onClick={() => navigate("/workflows")}><ArrowLeft className="h-4 w-4" /></Button>
      <div className="min-w-0"><h1 className="truncate text-[15px] font-semibold">{workflowTitle}</h1><p className="text-xs text-muted-foreground">引导式工作台</p></div>
      <span className={cn("ml-2 rounded-full px-2.5 py-1 text-[11px] font-medium", status === "running" ? "bg-blue-500/10 text-blue-600" : status === "waiting" ? "bg-amber-500/10 text-amber-700" : status === "done" ? "bg-emerald-500/10 text-emerald-700" : status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{STATUS_COPY[status]}</span>
      <Button type="text" className="ml-auto h-8 w-8 rounded-full" aria-label={detailsOpen ? "收起运行详情" : "展开运行详情"} onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button>
    </header>

    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-52 shrink-0 overflow-y-auto border-r border-border/50 px-3 py-4 md:block" aria-label="工作流步骤">
        <div className="px-2 pb-3 text-[11px] font-medium text-muted-foreground">执行步骤</div>
        <ol className="space-y-0.5">{stepDefinitions.map((step, index) => {
          const complete = status === "done" || completedNodes.has(step.id);
          const active = index === activeIndex && (status === "running" || status === "waiting");
          const failed = status === "error" && selectedNode === step.id;
          return <li key={step.id}><button type="button" onClick={() => setSelectedNode(step.id)} className={cn("flex w-full items-start gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors hover:bg-muted/55", selectedNode === step.id && "bg-muted/70")}><span className="mt-0.5">{failed ? <XCircle className="h-4 w-4 text-destructive" /> : active ? <LoaderCircle className="h-4 w-4 animate-spin text-blue-500 motion-reduce:animate-none" /> : complete ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground/45" />}</span><span className="min-w-0"><span className="block text-[12.5px] font-medium">{step.label}</span><span className="mt-0.5 block text-[10.5px] leading-4 text-muted-foreground">{step.description}</span></span></button></li>;
        })}</ol>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col" aria-label="工作流内容">
        <section className="min-h-0 flex-1 overflow-y-auto" aria-label="工作流对话">
          <div className="mx-auto flex min-h-full w-full max-w-[52rem] flex-col px-5 py-7 md:px-8">
            {pageError ? <div className="mb-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">{pageError}</div> : null}
            {messages.length === 0 && runMessages.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center"><h2 className="text-lg font-semibold">从演示文稿需求开始</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">在下方输入主题、受众、页数和风格，工作流会持续返回处理结果。</p></div> : <div className="space-y-5 py-2">{messages.map((message) => <ChatMessageRow key={message.id} {...message} />)}{runMessages.map((run) => <WorkflowRunMessage key={run.id} run={run} activeLabel={activeLabel} formValues={formValues} onFormChange={(id, value) => setFormValues((current) => ({ ...current, [id]: value }))} onFormSubmit={resumeForm} onFormCancel={() => void resume({ clarificationResponse: "REJECTED" }, "终止本次流程")} />)}<div ref={messageEndRef} /></div>}
          </div>
        </section>

        <div className="shrink-0 border-t border-border/40 bg-background/95 px-4 pb-4 pt-3 backdrop-blur-sm md:px-8">
          {status === "waiting" && !clarification?.form && clarification?.options.length ? <div className="mx-auto mb-2 flex max-w-[49.5rem] flex-wrap items-center gap-2 px-1">{clarification.options.map((option) => <Button key={option} size="small" className="h-8 rounded-full" onClick={() => setInput(option)}>{option}</Button>)}<Button type="text" size="small" className="h-8 rounded-full" onClick={() => void resume({ clarificationResponse: "REJECTED" }, "终止本次流程")}>终止本次流程</Button></div> : null}
          <ChatComposer value={input} onChange={setInput} onSend={send} isStreaming={status === "running"} onStop={stop} placeholder={status === "waiting" ? "补充信息以继续工作流" : "描述你想生成的演示文稿"} />
        </div>
      </main>

      <aside aria-label="运行详情" className={cn("border-l border-border/50 bg-background", detailsOpen ? "fixed inset-y-0 right-0 z-30 flex w-80 flex-col shadow-[-18px_0_50px_rgba(15,23,42,0.12)] xl:static xl:shadow-none" : "hidden xl:flex xl:w-72 xl:flex-col")}>
        <div className="flex h-14 items-center border-b border-border/50 px-3"><button type="button" onClick={() => setDetailTab("details")} className={cn("h-8 rounded-full px-3 text-xs font-medium", detailTab === "details" ? "bg-muted" : "text-muted-foreground")}>运行详情</button><button type="button" onClick={() => setDetailTab("output")} className={cn("h-8 rounded-full px-3 text-xs font-medium", detailTab === "output" ? "bg-muted" : "text-muted-foreground")}>输出</button><Button type="text" className="ml-auto h-8 w-8 rounded-full xl:hidden" aria-label="关闭运行详情" onClick={() => setDetailsOpen(false)}><PanelRightClose className="h-4 w-4" /></Button></div>
        {detailTab === "details" ? <div className="min-h-0 flex-1 overflow-y-auto"><dl className="divide-y divide-border/45 px-4 text-xs"><div className="py-4"><dt className="text-muted-foreground">运行状态</dt><dd className="mt-1 font-medium">{STATUS_COPY[status]}</dd></div><div className="py-4"><dt className="text-muted-foreground">运行 ID</dt><dd className="mt-1 break-all font-mono text-[11px]">{threadId}</dd></div><div className="py-4"><dt className="text-muted-foreground">开始时间</dt><dd className="mt-1 font-medium">{startedAt ? startedAt.toLocaleTimeString("zh-CN", { hour12: false }) : "-"}</dd></div><div className="py-4"><dt className="text-muted-foreground">已完成步骤</dt><dd className="mt-1 font-medium">{completedNodes.size} / {stepDefinitions.length}</dd></div></dl>{mermaidDefinition ? <div className="border-t border-border/45 p-4"><div className="mb-3 text-xs font-medium">流程拓扑</div><MermaidDiagram definition={mermaidDefinition} /></div> : null}</div> : <div className="min-h-0 flex-1 overflow-auto p-4">{selectedStep ? <><div className="mb-3 text-xs font-medium">{stepDefinitions.find((step) => step.id === selectedStep.node)?.label ?? selectedStep.node}</div><pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{JSON.stringify(selectedStep.values ?? {}, null, 2)}</pre></> : result ? <pre className="whitespace-pre-wrap break-words text-xs leading-5">{result}</pre> : <p className="text-xs text-muted-foreground">节点完成后在这里查看完整输出。</p>}</div>}
      </aside>
    </div>
  </div>;
}
