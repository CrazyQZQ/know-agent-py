import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Circle, Clock3, Download, FileText, LoaderCircle, PanelRightClose, PanelRightOpen, Play, Square, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthProvider";
import { streamSse, type SseEvent } from "@/lib/sse-client";
import { cn } from "@/lib/utils";

type StepUpdate = { node: string; values?: Record<string, unknown> };
type RunStatus = "idle" | "running" | "waiting" | "done" | "error" | "stopped";
type Clarification = { question: string; options: string[] };

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

export function WorkflowRunPage() {
  const { auth } = useAuth();
  const { workflowId = "ppt", threadId: routeThreadId } = useParams<{ workflowId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const generatedThreadId = useRef(crypto.randomUUID());
  const threadId = routeThreadId ?? generatedThreadId.current;
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [selectedNode, setSelectedNode] = useState("requirement");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [clarificationResponse, setClarificationResponse] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "output">("details");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const completedNodes = useMemo(() => new Set(steps.map((step) => step.node)), [steps]);
  const latestByNode = useMemo(() => new Map(steps.map((step) => [step.node, step])), [steps]);
  const selectedStep = latestByNode.get(selectedNode);
  const lastCompletedIndex = STEP_DEFINITIONS.reduce((last, step, index) => completedNodes.has(step.id) ? index : last, -1);
  const activeIndex = status === "waiting" ? 1 : status === "running" ? Math.min(lastCompletedIndex + 1, STEP_DEFINITIONS.length - 1) : lastCompletedIndex;

  function consume(event: SseEvent) {
    if (event.event === "update") {
      try { const update = JSON.parse(event.data) as StepUpdate; setSteps((current) => [...current, update]); setSelectedNode(update.node); } catch { /* ignore malformed update */ }
    } else if (event.event === "done") {
      setStatus("done"); setSelectedNode("render");
      try { setResult(String((JSON.parse(event.data) as { ppt_result?: string }).ppt_result ?? "")); } catch { setResult(event.data); }
    } else if (event.event === "interrupt" || event.event === "tool") {
      setStatus("waiting"); setClarification(readClarification(event.data)); setClarificationResponse(""); setSelectedNode("clarification");
    } else if (event.event === "error") {
      setStatus("error"); setResult(event.data); setDetailTab("output"); setDetailsOpen(true);
    }
  }

  async function run() {
    if (!input.trim()) return;
    const controller = new AbortController(); abortRef.current = controller;
    setStatus("running"); setStartedAt(new Date()); setSteps([]); setResult(""); setClarification(null); setSelectedNode("requirement");
    navigate(`/workflows/${workflowId}/${threadId}`, { replace: true });
    try {
      await streamSse({ path: "/v1/graph_run_sse", token: auth?.token, signal: controller.signal, body: { graphName: workflowId, threadId, newMessage: { role: "user", content: input } }, onEvent: consume });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) { setStatus("error"); setResult("工作流运行失败"); }
    } finally { abortRef.current = null; setStatus((current) => current === "running" ? "idle" : current); }
  }

  function stop() { abortRef.current?.abort(); abortRef.current = null; setStatus("stopped"); }

  async function resume(response = clarificationResponse) {
    if (!response.trim()) return;
    const controller = new AbortController(); abortRef.current = controller; setClarification(null); setStatus("running");
    try { await streamSse({ path: "/v1/graph_resume_sse", token: auth?.token, signal: controller.signal, body: { graphName: workflowId, threadId, clarificationResponse: response }, onEvent: consume }); }
    finally { abortRef.current = null; setStatus((current) => current === "running" ? "idle" : current); }
  }

  return <div className="relative flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/55 px-5">
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" asChild><Link to="/workflows" aria-label="返回工作流"><ArrowLeft className="h-4 w-4" /></Link></Button>
      <div className="min-w-0"><h1 className="truncate text-[15px] font-semibold">{workflowId === "ppt" ? "PPT 工作流" : workflowId}</h1><p className="text-xs text-muted-foreground">引导式生成工作台</p></div>
      <span className={cn("ml-2 rounded-full px-2.5 py-1 text-[11px] font-medium", status === "running" ? "bg-blue-500/10 text-blue-600" : status === "waiting" ? "bg-amber-500/10 text-amber-700" : status === "done" ? "bg-emerald-500/10 text-emerald-700" : status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{STATUS_COPY[status]}</span>
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={detailsOpen ? "收起运行详情" : "展开运行详情"} onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}</Button>
        {status === "running" ? <Button variant="outline" className="h-9 gap-2 rounded-full px-4" aria-label="停止工作流" onClick={stop}><Square className="h-3.5 w-3.5 fill-current" />停止</Button> : <Button className="h-9 gap-2 rounded-full px-4" onClick={() => void run()} disabled={!input.trim()}><Play className="h-3.5 w-3.5 fill-current" />运行工作流</Button>}
      </div>
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

      <main className="min-w-0 flex-1 overflow-y-auto" aria-label="工作流内容">
        <section className="mx-auto flex min-h-full max-w-[52rem] flex-col px-5 py-7 md:px-8" aria-label="当前步骤">
          <div className="mb-6"><div className="text-xs font-medium text-muted-foreground">当前步骤</div><h2 className="mt-1 text-xl font-semibold">{STEP_DEFINITIONS.find((step) => step.id === selectedNode)?.label ?? selectedNode}</h2></div>

          {selectedNode === "requirement" && !completedNodes.has("requirement") ? <div className="space-y-4">
            <div><label htmlFor="workflow-requirement" className="text-sm font-medium">演示文稿需求</label><p className="mt-1 text-xs text-muted-foreground">描述主题、受众、预计页数、风格和使用场景。</p></div>
            <Textarea id="workflow-requirement" aria-label="需求" value={input} onChange={(event) => setInput(event.target.value)} className="min-h-44 resize-y rounded-[18px] border-border/70 bg-card p-4 text-sm leading-6 shadow-[0_8px_24px_rgba(15,23,42,0.045)]" placeholder="例如：为产品委员会制作一份 12 页的季度产品汇报，突出增长数据、重点项目和下季度计划，风格简洁专业。" />
          </div> : selectedNode === "clarification" && clarification ? <div className="space-y-5">
            <div className="rounded-[18px] border border-amber-500/25 bg-amber-500/[0.045] p-5"><div className="text-sm font-medium">{clarification.question}</div>{clarification.options.length ? <div className="mt-3 flex flex-wrap gap-2">{clarification.options.map((option) => <Button key={option} variant="outline" size="sm" className="rounded-full bg-background" onClick={() => setClarificationResponse(option)}>{option}</Button>)}</div> : null}</div>
            <Textarea aria-label="补充信息" value={clarificationResponse} onChange={(event) => setClarificationResponse(event.target.value)} className="min-h-28 rounded-[16px]" placeholder="补充你的选择或说明" />
            <div className="flex gap-2"><Button className="rounded-full px-5" disabled={!clarificationResponse.trim()} onClick={() => void resume()}>继续运行</Button><Button variant="ghost" className="rounded-full" onClick={() => void resume("REJECTED")}>终止本次流程</Button></div>
          </div> : selectedStep ? <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />该步骤已完成</div>
            <div className="overflow-hidden rounded-[18px] border border-border/60 bg-card"><div className="border-b border-border/50 px-4 py-3 text-xs font-medium text-muted-foreground">步骤输出</div><pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap p-4 text-xs leading-5">{JSON.stringify(selectedStep.values ?? {}, null, 2)}</pre></div>
          </div> : <div className="flex min-h-64 flex-col items-center justify-center text-center"><Clock3 className="h-6 w-6 text-muted-foreground/45" /><p className="mt-3 text-sm font-medium">等待执行此步骤</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">运行工作流后，这里会展示当前步骤的交互与输出。</p></div>}

          {result && selectedNode === "render" ? <div className="mt-6 flex items-center justify-between rounded-[18px] border border-emerald-500/25 bg-emerald-500/[0.045] p-4"><div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-background"><FileText className="h-5 w-5" /></span><div className="min-w-0"><div className="text-sm font-medium">PPT 已生成</div><div className="truncate text-xs text-muted-foreground">{result}</div></div></div><Button variant="outline" size="sm" className="ml-4 shrink-0 gap-2 rounded-full" asChild><a href={result} download><Download className="h-4 w-4" />下载</a></Button></div> : null}
        </section>
      </main>

      <aside aria-label="运行详情" className={cn("border-l border-border/50 bg-background", detailsOpen ? "fixed inset-y-0 right-0 z-30 flex w-80 flex-col shadow-[-18px_0_50px_rgba(15,23,42,0.12)] xl:static xl:shadow-none" : "hidden xl:flex xl:w-72 xl:flex-col")}>
        <div className="flex h-14 items-center border-b border-border/50 px-3"><button type="button" onClick={() => setDetailTab("details")} className={cn("h-8 rounded-full px-3 text-xs font-medium", detailTab === "details" ? "bg-muted" : "text-muted-foreground")}>运行详情</button><button type="button" onClick={() => setDetailTab("output")} className={cn("h-8 rounded-full px-3 text-xs font-medium", detailTab === "output" ? "bg-muted" : "text-muted-foreground")}>输出</button><Button variant="ghost" size="icon" className="ml-auto h-8 w-8 rounded-full xl:hidden" aria-label="关闭运行详情" onClick={() => setDetailsOpen(false)}><PanelRightClose className="h-4 w-4" /></Button></div>
        {detailTab === "details" ? <dl className="divide-y divide-border/45 px-4 text-xs"><div className="py-4"><dt className="text-muted-foreground">运行状态</dt><dd className="mt-1 font-medium">{STATUS_COPY[status]}</dd></div><div className="py-4"><dt className="text-muted-foreground">运行 ID</dt><dd className="mt-1 break-all font-mono text-[11px]">{threadId}</dd></div><div className="py-4"><dt className="text-muted-foreground">开始时间</dt><dd className="mt-1 font-medium">{startedAt ? startedAt.toLocaleTimeString("zh-CN", { hour12: false }) : "-"}</dd></div><div className="py-4"><dt className="text-muted-foreground">已完成步骤</dt><dd className="mt-1 font-medium">{completedNodes.size} / {STEP_DEFINITIONS.length}</dd></div></dl> : <div className="min-h-0 flex-1 overflow-auto p-4">{result ? <pre className="whitespace-pre-wrap text-xs leading-5">{result}</pre> : <p className="text-xs text-muted-foreground">运行完成后在这里查看最终输出。</p>}</div>}
      </aside>
    </div>
  </div>;
}
