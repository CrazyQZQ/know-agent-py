import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { ToolApproval } from "@/components/chat/ToolApproval";
import { useAuth } from "@/features/auth/AuthProvider";
import { streamSse, type SseEvent } from "@/lib/sse-client";

type Step = { node: string; values?: Record<string, unknown> };
export function WorkflowRunPage() {
  const { auth } = useAuth();
  const { workflowId = "ppt", threadId: routeThreadId } = useParams<{ workflowId?: string; threadId?: string }>();
  const navigate = useNavigate();
  const [threadId] = useState(() => routeThreadId ?? crypto.randomUUID());
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("idle");
  const [approval, setApproval] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const consume = (event: SseEvent) => {
    if (event.event === "update") { try { const data = JSON.parse(event.data) as Step; setSteps((prev) => [...prev, data]); } catch { /* ignore malformed update */ } }
    else if (event.event === "done") { setStatus("done"); try { setResult(String((JSON.parse(event.data) as { ppt_result?: string }).ppt_result ?? "")); } catch { setResult(event.data); } }
    else if (event.event === "interrupt" || event.event === "tool") { setStatus("waiting"); setApproval(event.data); }
    else if (event.event === "error") { setStatus("error"); setResult(event.data); }
  };
  const run = async () => { const controller = new AbortController(); abort.current = controller; setStatus("running"); setSteps([]); setResult(""); navigate(`/workflows/${workflowId}/${threadId}`, { replace: true }); try { await streamSse({ path: "/v1/graph_run_sse", token: auth?.token, signal: controller.signal, body: { threadId, newMessage: { role: "user", content: input } }, onEvent: consume }); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { setStatus("error"); setResult("Workflow failed"); } } finally { abort.current = null; if (status === "running") setStatus("idle"); } };
  const stop = () => { abort.current?.abort(); abort.current = null; setStatus("stopped"); };
  const resume = async () => { if (!approval) return; const controller = new AbortController(); abort.current = controller; setApproval(null); setStatus("running"); try { await streamSse({ path: "/v1/graph_resume_sse", token: auth?.token, signal: controller.signal, body: { threadId, clarificationResponse: approval }, onEvent: consume }); } finally { abort.current = null; } };
  return <section className="mx-auto flex max-w-3xl flex-col gap-4 p-5"><h1 className="text-2xl font-semibold">{workflowId === "ppt" ? "PPT 工作流" : workflowId}</h1><textarea aria-label="需求" value={input} onChange={(e) => setInput(e.target.value)} className="min-h-32 rounded-md border p-3" placeholder="描述演示文稿需求" /><div>{status === "running" ? <button type="button" aria-label="停止工作流" onClick={stop} className="inline-flex items-center gap-2 rounded-md border px-3 py-2"><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />停止</button> : <button type="button" onClick={() => void run()} className="rounded-md bg-primary px-3 py-2 text-primary-foreground">运行工作流</button>}</div>{approval ? <ToolApproval title="需要补充信息" description={approval} onApprove={() => void resume()} onReject={stop} /> : null}<ol className="space-y-2">{steps.map((step, index) => <li key={`${step.node}-${index}`} className="rounded-md border p-3"><span className="font-medium">{step.node}</span>{step.values ? <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(step.values, null, 2)}</pre> : null}</li>)}</ol>{result ? <pre className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm">{result}</pre> : null}<p className="text-xs text-muted-foreground" role="status">{status === "running" ? "运行中" : status === "stopped" ? "已停止" : status === "error" ? "运行失败" : status === "done" ? "已完成" : ""}</p></section>;
}
