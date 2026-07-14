# Know-Agent Web UI Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `know-agent-ui` with a production-ready `web-ui` that preserves Know-Agent's current auth, assistant, workflow, and knowledge-base capabilities while adopting the open-source UI/UX.

**Architecture:** Keep the Vite, React, Tailwind, Radix/shadcn, Lucide, and markdown foundation in `web-ui`, but replace nanobot state and protocols with four bounded Know-Agent features: auth, assistant, workflows, and knowledge. Shared API, SSE, routing, shell, and chat primitives sit below those features; the old frontend is deleted only after real-backend, test, build, and visual acceptance gates pass.

**Tech Stack:** React 18, TypeScript, Vite 5, React Router 7, Tailwind CSS 3, Radix UI, shadcn/ui, Lucide React, React Markdown, Vitest, Testing Library, FastAPI REST/SSE backend.

---

## File Structure

Create or retain these focused units:

```text
web-ui/src/
  app/
    App.tsx                       # provider composition and router outlet
    AppRouter.tsx                 # route table and protected-route rules
  components/
    chat/
      ChatComposer.tsx            # send/stop control and text input
      ChatMessageRow.tsx          # markdown, copy, and mm:ss footer
      ToolApproval.tsx            # HITL approve/reject UI
    knowledge/
      DocumentStatusBadge.tsx     # semantic lifecycle colors
      Pagination.tsx              # complete table pagination
    shell/
      AppShell.tsx                # responsive sidebar + main outlet
      AppSidebar.tsx              # primary navigation and context list
      SessionList.tsx             # grouped sessions and running icon
    ui/
      select.tsx                  # Radix Select wrapper
  features/
    assistant/
      AssistantPage.tsx
      assistant-api.ts
      useAssistantSession.ts
    auth/
      AuthProvider.tsx
      LoginPage.tsx
      auth-api.ts
    knowledge/
      DocumentDetailPage.tsx
      DocumentListPage.tsx
      UploadDocumentDialog.tsx
      knowledge-api.ts
      knowledge-types.ts
      useDocuments.ts
    workflows/
      WorkflowCatalogPage.tsx
      WorkflowRunPage.tsx
      useWorkflowRun.ts
      workflow-api.ts
      workflow-registry.tsx
      workflow-types.ts
  lib/
    api-client.ts                 # authenticated REST client
    format.ts                     # mm:ss and yyyy-MM-dd HH:mm:ss
    sse-client.ts                 # POST SSE parser with AbortSignal
  tests/
    api-client.test.ts
    app-router.test.tsx
    app-shell.test.tsx
    assistant-page.test.tsx
    auth.test.tsx
    chat-components.test.tsx
    format.test.ts
    knowledge-detail.test.tsx
    knowledge-list.test.tsx
    sse-client.test.ts
    upload-dialog.test.tsx
    workflow-catalog.test.tsx
    workflow-run.test.tsx
```

Files under `web-ui/src` that remain nanobot-specific are removed in Task 11, after replacement coverage is demonstrated.

---

### Task 1: Rebase the Vite Project on Know-Agent Runtime Conventions

**Files:**
- Modify: `web-ui/package.json`
- Modify: `web-ui/package-lock.json`
- Modify: `web-ui/vite.config.ts`
- Modify: `web-ui/index.html`
- Test: `web-ui/src/tests/vite-config.test.ts`

- [ ] **Step 1: Change the existing Vite config test to describe the Know-Agent target**

Replace nanobot-specific expectations with:

```ts
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

describe("Know-Agent Vite config", () => {
  it("uses the local FastAPI server and a local dist directory", async () => {
    process.env.VITE_API_BASE_URL = "http://localhost:8000";
    const configModule = await import("../../vite.config");
    const config = await configModule.default({ command: "serve", mode: "test" });

    expect(config.server?.proxy?.["/v1"]).toMatchObject({
      target: "http://localhost:8000",
      changeOrigin: true,
    });
    expect(config.build?.outDir).toBe("dist");
    expect(createRequire(import.meta.url)("../../package.json").name).toBe("know-agent-web-ui");
  });
});
```

- [ ] **Step 2: Run the config test and confirm it fails against nanobot defaults**

Run: `cd web-ui && npm run test -- src/tests/vite-config.test.ts`

Expected: FAIL because the package name, proxy target, and output directory are still nanobot-specific.

- [ ] **Step 3: Install routing and Radix Select, then update package metadata**

Run:

```powershell
cd web-ui
npm install react-router-dom @radix-ui/react-select
```

Set these package fields:

```json
{
  "name": "know-agent-web-ui",
  "version": "0.1.0",
  "private": true
}
```

- [ ] **Step 4: Replace nanobot Vite proxy/build behavior**

Use this configuration core while retaining the existing alias, optimizer, manual markdown chunks, and Vitest settings:

```ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_BASE_URL || "http://localhost:8000";

  return {
    plugins: [react()],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: { output: { manualChunks: webuiManualChunk } },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/v1": { target, changeOrigin: true },
        "/health": { target, changeOrigin: true },
      },
    },
    test: {
      environment: "happy-dom",
      globals: true,
      setupFiles: ["./src/tests/setup.ts"],
    },
  };
});
```

Update `index.html` title and metadata to `Know-Agent` without changing the Vite root element.

- [ ] **Step 5: Run the config test and build**

Run:

```powershell
cd web-ui
npm run test -- src/tests/vite-config.test.ts
npm run build
```

Expected: the focused test passes and Vite writes `web-ui/dist`.

- [ ] **Step 6: Commit the runtime rebase**

```powershell
git add web-ui/package.json web-ui/package-lock.json web-ui/vite.config.ts web-ui/index.html web-ui/src/tests/vite-config.test.ts
git commit -m "build(ui): rebase web ui on know-agent runtime"
```

---

### Task 2: Build Shared Formatting, REST, and SSE Clients

**Files:**
- Create: `web-ui/src/lib/format.ts`
- Create: `web-ui/src/lib/api-client.ts`
- Create: `web-ui/src/lib/sse-client.ts`
- Test: `web-ui/src/tests/format.test.ts`
- Test: `web-ui/src/tests/api-client.test.ts`
- Test: `web-ui/src/tests/sse-client.test.ts`

- [ ] **Step 1: Write failing formatting tests**

```ts
import { describe, expect, it } from "vitest";
import { formatClock, formatDateTime } from "@/lib/format";

describe("date formatting", () => {
  it("formats message time as mm:ss", () => {
    expect(formatClock("2026-07-14T10:32:09+08:00")).toBe("32:09");
  });

  it("formats document time as yyyy-MM-dd HH:mm:ss", () => {
    expect(formatDateTime("2026-07-14T10:32:09+08:00")).toBe("2026-07-14 10:32:09");
  });
});
```

- [ ] **Step 2: Write failing REST and SSE tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { apiRequest, ApiError } from "@/lib/api-client";
import { streamSse } from "@/lib/sse-client";

it("adds bearer auth and surfaces FastAPI detail", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ detail: "denied" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  )));
  await expect(apiRequest("/v1/private", { token: "abc" })).rejects.toEqual(
    expect.objectContaining<ApiError>({ status: 403, message: "denied" }),
  );
  expect(fetch).toHaveBeenCalledWith("/v1/private", expect.objectContaining({
    headers: expect.objectContaining({ Authorization: "Bearer abc" }),
  }));
});

it("parses POST SSE frames and honors AbortSignal", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("event: message\ndata: hello\n\n"));
      controller.close();
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const events: Array<{ event: string; data: string }> = [];
  await streamSse({ path: "/v1/run_sse", body: {}, signal: new AbortController().signal, onEvent: e => events.push(e) });
  expect(events).toEqual([{ event: "message", data: "hello" }]);
});
```

- [ ] **Step 3: Run the shared-client tests and confirm missing modules**

Run: `cd web-ui && npm run test -- src/tests/format.test.ts src/tests/api-client.test.ts src/tests/sse-client.test.ts`

Expected: FAIL with unresolved `@/lib/format`, `api-client`, and `sse-client` modules.

- [ ] **Step 4: Implement deterministic formatters**

```ts
const pad = (value: number) => String(value).padStart(2, "0");

export function formatClock(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--" : `${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
```

- [ ] **Step 5: Implement the authenticated REST client**

```ts
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...requestInit } = options;
  const response = await fetch(path, {
    ...requestInit,
    headers: {
      ...(requestInit.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestInit.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new ApiError(response.status, payload?.detail || `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
```

- [ ] **Step 6: Implement the abortable POST SSE parser**

```ts
export type SseEvent = { id?: string; event: string; data: string };

export async function streamSse({ path, body, token, signal, onEvent }: {
  path: string;
  body: unknown;
  token?: string | null;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
}): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  if (!response.body) throw new Error("浏览器不支持流式响应");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      const lines = frame.split(/\r?\n/);
      onEvent({
        id: lines.find(line => line.startsWith("id:"))?.slice(3).trim(),
        event: lines.find(line => line.startsWith("event:"))?.slice(6).trim() || "message",
        data: lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"),
      });
    }
  }
}
```

- [ ] **Step 7: Run shared tests and commit**

Run: `cd web-ui && npm run test -- src/tests/format.test.ts src/tests/api-client.test.ts src/tests/sse-client.test.ts`

Expected: PASS.

```powershell
git add web-ui/src/lib/format.ts web-ui/src/lib/api-client.ts web-ui/src/lib/sse-client.ts web-ui/src/tests/format.test.ts web-ui/src/tests/api-client.test.ts web-ui/src/tests/sse-client.test.ts
git commit -m "feat(ui): add know-agent api and sse clients"
```

---

### Task 3: Add Authentication and URL Routing

**Files:**
- Create: `web-ui/src/features/auth/auth-api.ts`
- Create: `web-ui/src/features/auth/AuthProvider.tsx`
- Create: `web-ui/src/features/auth/LoginPage.tsx`
- Create: `web-ui/src/app/AppRouter.tsx`
- Create: `web-ui/src/app/App.tsx`
- Modify: `web-ui/src/main.tsx`
- Test: `web-ui/src/tests/auth.test.tsx`
- Test: `web-ui/src/tests/app-router.test.tsx`

- [ ] **Step 1: Write failing auth persistence and protected-route tests**

```tsx
it("persists login and exposes the authenticated user", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    access_token: "token-1",
    user: { name: "lxqq", roles: ["admin"] },
  })));
  render(<AuthProvider><LoginPage /></AuthProvider>);
  await userEvent.type(screen.getByLabelText("用户名"), "lxqq");
  await userEvent.type(screen.getByLabelText("密码"), "secret");
  await userEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(localStorage.getItem("know-agent.auth")).toContain("token-1");
});

it("redirects unauthenticated protected routes to login", () => {
  render(<MemoryRouter initialEntries={["/knowledge"]}><AppRouter /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the auth tests and confirm missing providers/routes**

Run: `cd web-ui && npm run test -- src/tests/auth.test.tsx src/tests/app-router.test.tsx`

Expected: FAIL with unresolved auth and router modules.

- [ ] **Step 3: Implement auth API and provider contract**

```ts
export type UserProfile = { name: string; sub?: string; roles: string[]; email?: string };
export type AuthState = { token: string; user: UserProfile };

export async function login(username: string, password: string): Promise<AuthState> {
  const response = await apiRequest<{ access_token: string; user: UserProfile }>("/v1/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return { token: response.access_token, user: response.user };
}
```

`AuthProvider` must expose this exact interface:

```ts
type AuthContextValue = {
  auth: AuthState | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
```

Store one JSON value under `know-agent.auth`, remove it on logout or `ApiError(401)`, and never persist passwords.

- [ ] **Step 4: Implement login and protected routes**

```tsx
export function ProtectedRoute() {
  const { auth } = useAuth();
  return auth ? <Outlet /> : <Navigate to="/login" replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/assistant/:threadId?" element={<div>智能助理</div>} />
        <Route path="/workflows" element={<div>工作流</div>} />
        <Route path="/workflows/:workflowId/:threadId?" element={<div>工作流运行</div>} />
        <Route path="/knowledge" element={<div>知识库</div>} />
        <Route path="/knowledge/:documentId" element={<div>文档详情</div>} />
      </Route>
      <Route path="*" element={<Navigate to="/assistant" replace />} />
    </Routes>
  );
}
```

Use temporary route components that render their module name until later tasks replace them.

- [ ] **Step 5: Replace `main.tsx` provider composition**

```tsx
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Run auth/router tests and commit**

Run: `cd web-ui && npm run test -- src/tests/auth.test.tsx src/tests/app-router.test.tsx`

Expected: PASS.

```powershell
git add web-ui/src/features/auth web-ui/src/app web-ui/src/main.tsx web-ui/src/tests/auth.test.tsx web-ui/src/tests/app-router.test.tsx
git commit -m "feat(ui): add auth and routed app shell"
```

---

### Task 4: Build the Single-Sidebar Application Shell

**Files:**
- Create: `web-ui/src/components/shell/AppShell.tsx`
- Create: `web-ui/src/components/shell/AppSidebar.tsx`
- Create: `web-ui/src/components/shell/SessionList.tsx`
- Modify: `web-ui/src/app/AppRouter.tsx`
- Modify: `web-ui/src/globals.css`
- Test: `web-ui/src/tests/app-shell.test.tsx`

- [ ] **Step 1: Write failing navigation and running-session tests**

```tsx
it("shows only the three Know-Agent primary modules", () => {
  renderShell("/assistant");
  expect(screen.getByRole("link", { name: "智能助理" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "工作流" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "知识库" })).toBeInTheDocument();
  expect(screen.queryByText("Skills")).not.toBeInTheDocument();
  expect(screen.getByText("lxqq")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "切换主题" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
});

it("marks running assistant and workflow sessions with an accessible spinner", () => {
  render(<SessionList sessions={[{ id: "run-1", title: "季度汇报", running: true }]} activeId="run-1" onSelect={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByLabelText("季度汇报正在运行")).toHaveClass("animate-spin");
});
```

- [ ] **Step 2: Run the shell test and confirm failure**

Run: `cd web-ui && npm run test -- src/tests/app-shell.test.tsx`

Expected: FAIL because the Know-Agent shell components do not exist.

- [ ] **Step 3: Implement the shell contracts**

```ts
export type ContextSession = {
  id: string;
  title: string;
  running: boolean;
  updatedAt?: string | null;
};

export type SidebarContext = {
  label?: string;
  sessions: ContextSession[];
  activeId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};
```

`AppSidebar` must render only these navigation records:

```ts
const NAV_ITEMS = [
  { to: "/assistant", label: "智能助理", icon: MessageSquare },
  { to: "/workflows", label: "工作流", icon: Workflow },
  { to: "/knowledge", label: "知识库", icon: Database },
] as const;
```

Render `LoaderCircle` with `animate-spin motion-reduce:animate-none` at the right edge of running sessions. Do not render knowledge filters in the sidebar.

The sidebar footer renders the authenticated user's name and roles plus an icon-only logout action. Retain the existing `useTheme` hook and expose a `Sun`/`Moon` icon button in the shell header with `aria-label="切换主题"`; both controls use Tooltip.

- [ ] **Step 4: Implement responsive sidebar behavior**

Desktop uses a stable `w-64` sidebar with a collapse button. Below `lg`, render the same sidebar content through the existing Radix `Sheet`; closing or selecting a route closes the sheet.

```tsx
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex h-dvh min-w-0 bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border lg:block"><AppSidebar /></aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>{/* same AppSidebar */}</Sheet>
      <main className="min-w-0 flex-1 overflow-hidden"><Outlet /></main>
    </div>
  );
}
```

Wrap the protected child routes from Task 3 in `<Route element={<AppShell />}>...</Route>` so every current and future feature page renders through the shell's `<Outlet />`.

- [ ] **Step 5: Run shell test and commit**

Run: `cd web-ui && npm run test -- src/tests/app-shell.test.tsx`

Expected: PASS.

```powershell
git add web-ui/src/components/shell web-ui/src/globals.css web-ui/src/tests/app-shell.test.tsx
git commit -m "feat(ui): add know-agent application shell"
```

---

### Task 5: Build Shared Chat Message and Composer Components

**Files:**
- Create: `web-ui/src/components/chat/ChatMessageRow.tsx`
- Create: `web-ui/src/components/chat/ChatComposer.tsx`
- Create: `web-ui/src/components/chat/ToolApproval.tsx`
- Test: `web-ui/src/tests/chat-components.test.tsx`

- [ ] **Step 1: Write failing message action and composer-state tests**

```tsx
it("shows copy and mm:ss for both user and assistant messages", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  render(<ChatMessageRow message={{ id: "m1", role: "user", content: "问题", createdAt: "2026-07-14T10:32:09+08:00" }} copyText={copy} />);
  expect(screen.getByText("32:09")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "复制消息" }));
  expect(copy).toHaveBeenCalledWith("问题");
});

it("switches the send icon to an animated stop control", async () => {
  const stop = vi.fn();
  render(<ChatComposer value="" onChange={vi.fn()} onSubmit={vi.fn()} onStop={stop} running />);
  const button = screen.getByRole("button", { name: "停止生成" });
  expect(within(button).getByTestId("stop-spinner")).toHaveClass("animate-spin");
  await userEvent.click(button);
  expect(stop).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run chat component tests and confirm failure**

Run: `cd web-ui && npm run test -- src/tests/chat-components.test.tsx`

Expected: FAIL because the chat components do not exist.

- [ ] **Step 3: Implement the shared message type and row**

```ts
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  loading?: boolean;
  error?: boolean;
};
```

`ChatMessageRow` must reuse `MarkdownText` for assistant content, render user text in the existing secondary pill style, and place a `Copy` icon plus `formatClock(createdAt)` below both roles. Loading messages render the existing `TypingDots`; do not render literal loading text.

- [ ] **Step 4: Implement the Codex-style composer**

```tsx
<Button
  type="button"
  size="icon"
  className="relative h-9 w-9 rounded-full"
  aria-label={running ? "停止生成" : "发送消息"}
  onClick={running ? onStop : () => onSubmit(value.trim())}
  disabled={!running && !value.trim()}
>
  {running ? <><span data-testid="stop-spinner" className="absolute inset-[-3px] rounded-full border-2 border-transparent border-r-muted-foreground border-t-foreground/60 animate-spin motion-reduce:animate-none" /><Square className="h-3.5 w-3.5 fill-current" /></> : <ArrowUp className="h-4 w-4" />}
</Button>
```

Keep the composer height stable while the icon changes. `ToolApproval` receives action names and emits only `APPROVED` or `REJECTED`.

- [ ] **Step 5: Run chat component tests and commit**

Run: `cd web-ui && npm run test -- src/tests/chat-components.test.tsx`

Expected: PASS.

```powershell
git add web-ui/src/components/chat web-ui/src/tests/chat-components.test.tsx
git commit -m "feat(ui): add shared know-agent chat controls"
```

---

### Task 6: Migrate the Intelligent Assistant

**Files:**
- Create: `web-ui/src/features/assistant/assistant-api.ts`
- Create: `web-ui/src/features/assistant/useAssistantSession.ts`
- Create: `web-ui/src/features/assistant/AssistantPage.tsx`
- Test: `web-ui/src/tests/assistant-page.test.tsx`

- [ ] **Step 1: Write failing buffered-SSE, stop, approval, and deletion tests**

```tsx
it("buffers assistant chunks until completion", async () => {
  const stream = createControlledAssistantStream();
  render(<AssistantPage streamFactory={() => stream} />);
  await sendMessage("你好");
  stream.emit({ event: "message", data: "半" });
  expect(screen.queryByText("半")).not.toBeInTheDocument();
  expect(screen.getByTestId("typing-dots")).toBeInTheDocument();
  stream.emit({ event: "message", data: "截" });
  stream.finish();
  expect(await screen.findByText("半截")).toBeInTheDocument();
});

it("aborts the active request from the stop button", async () => {
  const abortSpy = vi.spyOn(AbortController.prototype, "abort");
  render(<AssistantPage />);
  await sendMessage("停止测试");
  await userEvent.click(screen.getByRole("button", { name: "停止生成" }));
  expect(abortSpy).toHaveBeenCalled();
});

it("deletes the selected thread after confirmation", async () => {
  render(<AssistantPage />);
  await userEvent.click(screen.getByRole("button", { name: "删除 会话一" }));
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/apps/common_agent/"), expect.objectContaining({ method: "DELETE" }));
});
```

- [ ] **Step 2: Run the assistant test and confirm failure**

Run: `cd web-ui && npm run test -- src/tests/assistant-page.test.tsx`

Expected: FAIL because the assistant feature has not been migrated.

- [ ] **Step 3: Implement assistant API functions**

```ts
export const listAssistantThreads = (token: string, userId: string) =>
  apiRequest<ThreadSummary[]>(`/v1/apps/common_agent/users/${encodeURIComponent(userId)}/threads`, { token });

export const getAssistantHistory = (token: string, userId: string, threadId: string) =>
  apiRequest<Array<{ role: string; content: string }>>(`/v1/apps/common_agent/users/${encodeURIComponent(userId)}/threads/${threadId}/history`, { token });

export const deleteAssistantThread = (token: string, userId: string, threadId: string) =>
  apiRequest<{ deleted: string | null }>(`/v1/apps/common_agent/users/${encodeURIComponent(userId)}/threads/${threadId}`, { method: "DELETE", token });
```

Run and resume payloads must remain byte-for-byte compatible with current backend field names: `appName`, `userId`, `threadId`, `newMessage`, `streaming`, `stateDelta`, and `toolFeedbacks`.

- [ ] **Step 4: Implement the assistant session controller**

Use these state invariants:

```ts
const bufferRef = useRef("");
const abortRef = useRef<AbortController | null>(null);

function stop() {
  abortRef.current?.abort();
  abortRef.current = null;
}

function commitBufferedAssistant(messageId: string) {
  const content = bufferRef.current;
  setMessages(current => content
    ? current.map(message => message.id === messageId ? { ...message, content, loading: false } : message)
    : current.filter(message => message.id !== messageId));
  bufferRef.current = "";
}
```

Handle `tool`, `interrupt`, and `done` separately. Treat `AbortError` as a user stop, not an error notification. Refresh thread titles after completion.

- [ ] **Step 5: Assemble the assistant page**

Compose `SessionList`, `ChatMessageRow`, `ToolApproval`, and `ChatComposer`. The page owns no fetch calls; it consumes `useAssistantSession`. Use `useParams` and `useNavigate` so thread selection updates `/assistant/:threadId`.

- [ ] **Step 6: Run assistant and shared tests, then commit**

Run: `cd web-ui && npm run test -- src/tests/assistant-page.test.tsx src/tests/chat-components.test.tsx src/tests/sse-client.test.ts`

Expected: PASS.

```powershell
git add web-ui/src/features/assistant web-ui/src/tests/assistant-page.test.tsx
git commit -m "feat(ui): migrate intelligent assistant"
```

---

### Task 7: Add the Extensible Workflow Catalog and PPT Run Screen

**Files:**
- Create: `web-ui/src/features/workflows/workflow-types.ts`
- Create: `web-ui/src/features/workflows/workflow-registry.tsx`
- Create: `web-ui/src/features/workflows/workflow-api.ts`
- Create: `web-ui/src/features/workflows/useWorkflowRun.ts`
- Create: `web-ui/src/features/workflows/WorkflowCatalogPage.tsx`
- Create: `web-ui/src/features/workflows/WorkflowRunPage.tsx`
- Test: `web-ui/src/tests/workflow-catalog.test.tsx`
- Test: `web-ui/src/tests/workflow-run.test.tsx`

- [ ] **Step 1: Write failing registry and catalog tests**

```tsx
it("registers PPT without hard-coding it in the shell", () => {
  expect(getWorkflow("ppt-build")).toMatchObject({ graphName: "ppt_build", title: "PPT 生成" });
});

it("renders a compact multi-column workflow catalog", () => {
  render(<WorkflowCatalogPage />);
  expect(screen.getByTestId("workflow-grid")).toHaveClass("md:grid-cols-2", "xl:grid-cols-3");
  expect(screen.getByRole("link", { name: /启动 PPT 生成/ })).toHaveAttribute("href", "/workflows/ppt-build");
});
```

- [ ] **Step 2: Write failing run-screen event tests**

```tsx
it("maps update, interrupt, and done events into the run timeline", async () => {
  const stream = createControlledWorkflowStream();
  render(<WorkflowRunPage streamFactory={() => stream} />);
  await submitWorkflow("生成季度汇报");
  stream.emit({ event: "update", data: JSON.stringify({ node: "search", values: {} }) });
  expect(screen.getByText("资料检索")).toHaveAttribute("data-state", "complete");
  stream.emit({ event: "interrupt", data: JSON.stringify({ clarification: "请补充受众" }) });
  expect(screen.getByText("请补充受众")).toBeInTheDocument();
  stream.emit({ event: "done", data: JSON.stringify({ ppt_result: "/output/report.pptx" }) });
  expect(screen.getByRole("link", { name: "report.pptx" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run workflow tests and confirm failure**

Run: `cd web-ui && npm run test -- src/tests/workflow-catalog.test.tsx src/tests/workflow-run.test.tsx`

Expected: FAIL with missing workflow feature modules.

- [ ] **Step 4: Implement registry types and PPT definition**

```ts
export type WorkflowDefinition = {
  id: string;
  graphName: string;
  title: string;
  description: string;
  icon: LucideIcon;
  capabilities: string[];
};

export const WORKFLOWS: WorkflowDefinition[] = [{
  id: "ppt-build",
  graphName: "ppt_build",
  title: "PPT 生成",
  description: "从需求澄清、资料检索到演示文稿渲染。",
  icon: Presentation,
  capabilities: ["支持中断补充", "实时节点进度"],
}];

export const getWorkflow = (id: string) => WORKFLOWS.find(workflow => workflow.id === id);
```

- [ ] **Step 5: Implement workflow API and controller**

Use `/v1/graph_run_sse` and `/v1/graph_resume_sse`, and use thread endpoints with `appName=ppt_build`. Track these nodes in order:

```ts
export const PPT_NODES = [
  ["requirement", "需求理解"],
  ["search", "资料检索"],
  ["template_select", "模板选择"],
  ["template_info", "模板分析"],
  ["outline", "提纲生成"],
  ["schema", "页面结构"],
  ["render", "PPT 渲染"],
] as const;
```

`useWorkflowRun` exposes `definition`, `threads`, `messages`, `steps`, `interruption`, `result`, `running`, `run`, `resume`, `stop`, `selectThread`, and `deleteThread`.

- [ ] **Step 6: Implement catalog and run screens**

Catalog grid classes: `grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3`. Run screen uses the same `ChatMessageRow` and `ChatComposer` as assistant, plus an inline activity list with `complete`, `active`, and `pending` states. The context sidebar label must be `${definition.title} · 最近运行`.

- [ ] **Step 7: Run workflow tests and commit**

Run: `cd web-ui && npm run test -- src/tests/workflow-catalog.test.tsx src/tests/workflow-run.test.tsx`

Expected: PASS.

```powershell
git add web-ui/src/features/workflows web-ui/src/tests/workflow-catalog.test.tsx web-ui/src/tests/workflow-run.test.tsx
git commit -m "feat(ui): add extensible workflow experience"
```

---

### Task 8: Build the Knowledge Document List

**Files:**
- Create: `web-ui/src/components/ui/select.tsx`
- Create: `web-ui/src/components/knowledge/DocumentStatusBadge.tsx`
- Create: `web-ui/src/components/knowledge/Pagination.tsx`
- Create: `web-ui/src/features/knowledge/knowledge-types.ts`
- Create: `web-ui/src/features/knowledge/knowledge-api.ts`
- Create: `web-ui/src/features/knowledge/useDocuments.ts`
- Create: `web-ui/src/features/knowledge/DocumentListPage.tsx`
- Test: `web-ui/src/tests/knowledge-list.test.tsx`

- [ ] **Step 1: Write failing toolbar, status, operation, and pagination tests**

```tsx
it("keeps search and Radix status select together with refresh/upload on the right", () => {
  render(<DocumentListPage />);
  const toolbar = screen.getByRole("toolbar", { name: "文档工具栏" });
  expect(within(toolbar).getByRole("searchbox", { name: "搜索文档" })).toBeInTheDocument();
  expect(within(toolbar).getByRole("combobox", { name: "状态筛选" })).toBeInTheDocument();
  expect(within(toolbar).getByRole("button", { name: "刷新" })).toBeInTheDocument();
  expect(within(toolbar).getByRole("button", { name: "上传文档" })).toBeInTheDocument();
});

it("renders progressive statuses and full pagination", () => {
  render(<DocumentListPage />);
  expect(screen.getByText("转换中")).toHaveClass("text-amber-800");
  expect(screen.getByText("已切块")).toHaveClass("text-teal-800");
  expect(screen.getByText("已向量化")).toHaveClass("text-green-800");
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
});

it("requires confirmation before deleting a document", async () => {
  render(<DocumentListPage />);
  await userEvent.click(screen.getByRole("button", { name: "删除 技术方案.docx" }));
  expect(screen.getByRole("alertdialog", { name: "删除文档" })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/document/"), expect.objectContaining({ method: "DELETE" }));
});
```

- [ ] **Step 2: Run the list test and confirm failure**

Run: `cd web-ui && npm run test -- src/tests/knowledge-list.test.tsx`

Expected: FAIL with missing knowledge modules.

- [ ] **Step 3: Define knowledge API types and exact page mapping**

```ts
export type DocumentStatus = "UPLOADED" | "CONVERTING" | "CONVERTED" | "CHUNKED" | "VECTOR_STORED" | "STORED";
export type DocumentRecord = {
  id: number;
  title: string;
  description: string;
  uploadUser: string;
  knowledgeBaseType: "DOCUMENT_SEARCH" | "DATA_QUERY";
  accessibleBy: string;
  status: DocumentStatus;
  createdAt: string | null;
  updatedAt: string | null;
};
export type PageResult<T> = { records: T[]; total: number; current: number; size: number };
```

`listDocuments` must pass `current` and `size` to `/v1/api/document/page` and preserve the backend `total`; do not derive total from the current page.

- [ ] **Step 4: Implement status badge mapping**

```ts
const STATUS_STYLES: Record<DocumentStatus, string> = {
  UPLOADED: "border-zinc-300 bg-zinc-100 text-zinc-700",
  CONVERTING: "border-amber-300 bg-amber-50 text-amber-800",
  CONVERTED: "border-blue-300 bg-blue-50 text-blue-800",
  CHUNKED: "border-teal-300 bg-teal-50 text-teal-800",
  VECTOR_STORED: "border-green-300 bg-green-50 text-green-800",
  STORED: "border-green-300 bg-green-50 text-green-800",
};
```

Include visible text and a colored dot with `aria-hidden`; the text carries the accessible meaning.

- [ ] **Step 5: Implement list toolbar, table, and pagination**

Use Radix `Select` for statuses. Search width is `w-56 md:w-64`; Select follows immediately. Apply `ml-auto` only to the refresh/upload group. Format update values with `formatDateTime`. Operation icons are `Eye` and `Trash2`, each wrapped in Tooltip. Pagination includes size select, previous, page numbers, ellipsis, and next.

Wrap document deletion in the existing Radix `AlertDialog`. Only call `deleteDocument` from the destructive confirmation action; closing the dialog makes no request.

- [ ] **Step 6: Run the list test and commit**

Run: `cd web-ui && npm run test -- src/tests/knowledge-list.test.tsx src/tests/format.test.ts`

Expected: PASS.

```powershell
git add web-ui/src/components/ui/select.tsx web-ui/src/components/knowledge web-ui/src/features/knowledge/knowledge-types.ts web-ui/src/features/knowledge/knowledge-api.ts web-ui/src/features/knowledge/useDocuments.ts web-ui/src/features/knowledge/DocumentListPage.tsx web-ui/src/tests/knowledge-list.test.tsx
git commit -m "feat(ui): add knowledge document list"
```

---

### Task 9: Add Document Details and the Local-First Upload Dialog

**Files:**
- Create: `web-ui/src/features/knowledge/DocumentDetailPage.tsx`
- Create: `web-ui/src/features/knowledge/UploadDocumentDialog.tsx`
- Test: `web-ui/src/tests/knowledge-detail.test.tsx`
- Test: `web-ui/src/tests/upload-dialog.test.tsx`

- [ ] **Step 1: Write failing document-detail tests**

```tsx
it("shows metadata, lifecycle, next action, segments, and full timestamps", async () => {
  render(<DocumentDetailPage />);
  expect(await screen.findByText("2026-07-14 10:08:45")).toBeInTheDocument();
  expect(screen.getByText("已切块")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "执行向量化" })).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "文档切片" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing upload interaction tests**

```tsx
it("keeps a dropped file local and fills title/description from its basename", async () => {
  render(<UploadDocumentDialog open onOpenChange={vi.fn()} onUploaded={vi.fn()} />);
  const file = new File(["content"], "技术方案.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  fireEvent.drop(screen.getByLabelText("选择或拖拽文件"), { dataTransfer: { files: [file] } });
  expect(screen.getByLabelText("文档标题")).toHaveValue("技术方案");
  expect(screen.getByLabelText("描述")).toHaveValue("技术方案");
  expect(fetch).not.toHaveBeenCalled();
});

it("clears local file state on cancel without an OSS delete", async () => {
  render(<UploadDocumentDialog open onOpenChange={vi.fn()} onUploaded={vi.fn()} />);
  await chooseUploadFile("技术方案.docx");
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(fetch).not.toHaveBeenCalled();
});

it("uses Select and a checkbox dropdown for document type and roles", async () => {
  render(<UploadDocumentDialog open onOpenChange={vi.fn()} onUploaded={vi.fn()} />);
  await userEvent.click(screen.getByRole("combobox", { name: "知识库类型" }));
  expect(screen.getByRole("option", { name: "数据查询" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "可访问角色" }));
  expect(screen.getByRole("menuitemcheckbox", { name: "管理员" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run detail/upload tests and confirm failure**

Run: `cd web-ui && npm run test -- src/tests/knowledge-detail.test.tsx src/tests/upload-dialog.test.tsx`

Expected: FAIL because the pages are not implemented.

- [ ] **Step 4: Implement document detail behavior**

Load the document from the current list cache or refetch `/v1/api/document/{id}` if absent; load segments from `/v1/api/segment/list-by-document?document_id={id}`. Render the exact lifecycle order from the design and expose only valid next actions:

```ts
const nextAction = document.status === "CONVERTED"
  ? { label: "执行切块", run: () => splitDocument(document.id) }
  : document.status === "CHUNKED"
    ? { label: "执行向量化", run: () => embedDocument(document.id) }
    : null;
```

Use an independent segment pagination state with previous/next controls.

- [ ] **Step 5: Implement local-first upload form state**

```ts
function acceptFile(file: File) {
  const basename = file.name.replace(/\.[^.]+$/, "");
  setFile(file);
  setTitle(basename);
  setDescription(basename);
}

function cancel() {
  setFile(null);
  setTitle("");
  setDescription("");
  setRoles([]);
  onOpenChange(false);
}
```

`acceptFile` is called from both hidden file input change and drop. It must not call `fetch`.

- [ ] **Step 6: Implement production controls and submission**

Use the new Radix Select for `DOCUMENT_SEARCH` and `DATA_QUERY`. Use the existing `DropdownMenuCheckboxItem` for roles. The chevron stays inside the trigger with `ml-auto h-4 w-4`. Show `tableName` only for DATA_QUERY. On submit, build exactly these FormData keys: `file`, `title`, `description`, `knowledgeBaseType`, repeated `accessibleBy`, and optional `tableName`.

While submission is pending, disable file replacement, close, cancel, and submit controls. Re-enable them on request failure and keep the local file and field values so the user can retry.

- [ ] **Step 7: Run detail/upload/list tests and commit**

Run: `cd web-ui && npm run test -- src/tests/knowledge-detail.test.tsx src/tests/upload-dialog.test.tsx src/tests/knowledge-list.test.tsx`

Expected: PASS.

```powershell
git add web-ui/src/features/knowledge/DocumentDetailPage.tsx web-ui/src/features/knowledge/UploadDocumentDialog.tsx web-ui/src/tests/knowledge-detail.test.tsx web-ui/src/tests/upload-dialog.test.tsx
git commit -m "feat(ui): add document details and upload dialog"
```

---

### Task 10: Integrate the Full App and Verify Against the Real Backend

**Files:**
- Modify: `web-ui/src/app/App.tsx`
- Modify: `web-ui/src/app/AppRouter.tsx`
- Modify: `web-ui/src/tests/app-layout.test.tsx`
- Create: `web-ui/src/tests/know-agent-integration.test.tsx`

- [ ] **Step 1: Replace old app-layout expectations with Know-Agent routes**

```tsx
it("navigates among assistant, workflows, and knowledge without nanobot utilities", async () => {
  renderAuthenticatedApp("/assistant");
  await userEvent.click(screen.getByRole("link", { name: "工作流" }));
  expect(screen.getByRole("heading", { name: "选择工作流" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "知识库" }));
  expect(screen.getByRole("heading", { name: "知识库" })).toBeInTheDocument();
  expect(screen.queryByText("Automations")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add mocked cross-feature integration coverage**

The integration test must mock `/v1/api/auth/login`, assistant thread/history/SSE, graph thread/history/SSE, document page/roles/segments, upload, split, embedding, and delete endpoints. Assert one happy path per module and one `401` path that returns to login.

```ts
expect(fetch).toHaveBeenCalledWith("/v1/run_sse", expect.objectContaining({ method: "POST" }));
expect(fetch).toHaveBeenCalledWith("/v1/graph_run_sse", expect.objectContaining({ method: "POST" }));
expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/api/document/page"), expect.anything());
```

- [ ] **Step 3: Run all frontend tests, lint, and build**

Run:

```powershell
cd web-ui
npm run test
npm run lint
npm run build
```

Expected: all Vitest tests pass, ESLint exits 0, and Vite writes `dist`.

- [ ] **Step 4: Start backend and frontend for real integration**

Terminal 1:

```powershell
uv run uvicorn know_agent.main:app --reload --port 8000
```

Terminal 2:

```powershell
cd web-ui
npm run dev -- --host 127.0.0.1 --port 5173
```

Expected URLs: backend `http://localhost:8000/health`, frontend `http://localhost:5173`.

- [ ] **Step 5: Execute the real-backend acceptance checklist**

Verify in the user-selected browser:

1. Login and logout.
2. New assistant message, buffered loading dots, final text, user/assistant copy, `mm:ss`, stop, tool approval, history switch, and deletion.
3. Workflow catalog, PPT run, running icon, node updates, interruption, resume, result link, history, and deletion.
4. Knowledge search, status Select, refresh, pagination, status colors, full timestamps, details, split, embed, segment pagination, upload drag/drop, local cancel, and document deletion.
5. Desktop `1440x900` and mobile `390x844`, light and dark themes, with no overlap or viewport overflow.

- [ ] **Step 6: Commit full integration fixes**

```powershell
git add web-ui/src/app web-ui/src/tests/app-layout.test.tsx web-ui/src/tests/know-agent-integration.test.tsx
git commit -m "test(ui): verify know-agent frontend integration"
```

---

### Task 11: Remove Nanobot and Old Frontend Surfaces After Acceptance

**Files:**
- Delete: nanobot-only files under `web-ui/src/components`, `web-ui/src/hooks`, `web-ui/src/lib`, `web-ui/src/providers`, `web-ui/src/workers`, and `web-ui/src/tests`
- Modify: `web-ui/package.json`
- Modify: `web-ui/package-lock.json`
- Modify: `web-ui/README.md`
- Modify: root `README.md`
- Delete: `know-agent-ui/`

- [ ] **Step 1: Prove the deletion gate is satisfied**

Record current evidence before deleting anything:

```powershell
cd web-ui
npm run test
npm run lint
npm run build
cd ..
git status --short
```

Expected: all frontend checks pass and the real-backend checklist from Task 10 is complete. If any item is incomplete, stop this task and keep `know-agent-ui`.

- [ ] **Step 2: Identify nanobot-only imports from the new entry graph**

Run:

```powershell
cd web-ui
npx --yes madge --extensions ts,tsx --orphans src
```

If `madge` is not already available, use `npx --yes madge` without adding it to package dependencies. The retained graph must contain only Know-Agent features, shared UI, markdown, and theme modules.

- [ ] **Step 3: Delete only unreachable nanobot modules and tests**

Remove files identified as unreachable and nanobot-specific, including settings, skills, automation, workspace, nanobot client, voice, QR code, provider branding, CLI-app, MCP-preset, and their tests. Keep reusable `components/ui`, `MarkdownText`, `CodeBlock`, clipboard helpers, theme hooks, and responsive helpers if they remain imported.

After deletion, remove unused dependencies with:

```powershell
cd web-ui
npm uninstall qrcode diff i18next react-i18next
```

Only uninstall a dependency when `rg` finds no retained import.

- [ ] **Step 4: Update frontend documentation and root entry points**

`web-ui/README.md` must contain these exact development commands:

````markdown
## Development

```powershell
uv run uvicorn know_agent.main:app --reload --port 8000
cd web-ui
npm install
npm run dev
```

Open http://localhost:5173.
````

Update root `README.md` to point only to `web-ui`; remove instructions that reference `know-agent-ui`.

- [ ] **Step 5: Delete the accepted old frontend**

Delete `know-agent-ui/` only now, after the gate in Step 1 and documentation update. Do not delete unrelated user files outside that directory.

- [ ] **Step 6: Run final frontend and backend regression**

Run:

```powershell
cd web-ui
npm run test
npm run lint
npm run build
cd ..
uv run pytest tests/test_agent_sse.py tests/test_thread_history.py tests/test_document_service.py tests/test_sse_reconnect.py -q
```

Expected: frontend test/lint/build pass and the focused backend suite passes.

- [ ] **Step 7: Verify no stale frontend references remain**

Run:

```powershell
rg -n "know-agent-ui|nanobot|NANOBOT_API_URL" README.md docs web-ui --glob '!web-ui/node_modules/**' --glob '!web-ui/dist/**'
```

Expected: no stale runtime or setup references. Acknowledgement text is allowed only if intentionally retained in licensing documentation.

- [ ] **Step 8: Commit the cutover**

```powershell
git add -A -- web-ui know-agent-ui README.md
git commit -m "feat(ui): complete web ui cutover"
```

Do not stage unrelated backend or workspace changes.

---

## Final Verification

Run from the repository root:

```powershell
cd web-ui
npm run test
npm run lint
npm run build
cd ..
uv run pytest tests/test_agent_sse.py tests/test_thread_history.py tests/test_document_service.py tests/test_sse_reconnect.py -q
git status --short
```

Completion evidence must include:

- Frontend test count and pass result.
- ESLint exit 0.
- Vite production build exit 0.
- Focused backend test count and pass result.
- Desktop and mobile screenshots for assistant, workflow catalog, workflow run, knowledge list, document detail, and upload dialog.
- Confirmation that `know-agent-ui/` was deleted only after acceptance.
- A scoped `git status --short` showing unrelated user changes were not staged.
