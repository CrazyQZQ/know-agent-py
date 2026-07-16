# 前端 UI 组件库迁移设计：shadcn/Radix -> Ant Design + Ant Design X

- 日期：2026-07-16
- 范围：`web-ui/`
- 目标：将基础 UI 组件全部替换为 Ant Design，Chat 相关组件替换为 Ant Design X；组件之外的动画用 gsap 优化。不破坏现有功能。

## 一、关键决策（已与用户确认）

1. **迁移范围**：完整迁移。基础组件（`@/components/ui` 的 6 个）-> antd；Chat 组件（Composer/MessageRow/SessionList/ToolApproval）-> Ant Design X。
2. **Tailwind**：保留。antd（CSS-in-JS）与 Tailwind 原子类共存。
3. **主题**：antd 适配现有 CSS 变量体系。保留 shadcn HSL 变量 + `.dark` class 作为唯一主题源，ConfigProvider token 映射到这些变量；dark mode 由 `useTheme` 同时切 `.dark` class 与 antd `darkAlgorithm`。
4. **动画**：选择性优化。保留装饰性 CSS keyframes（伪元素光泽、drop-shadow 呼吸、pulse）；元素进出场类动画改 gsap 驱动；新增列表 stagger、路由切换淡入；antd 组件内部动画不动；保留 `prefers-reduced-motion` 降级。
5. **测试**：同步更新，迁移后全部通过。保留所有 `aria-label`/`data-testid`，失效断言改语义查询。

补充发现：i18next 已安装但代码零引用，文案全部硬编码 -> antd locale 固定 `zhCN`，无需语言切换。

## 二、依赖增减

- 新增：`antd@^5`、`@ant-design/x@^1`、`@ant-design/icons`
- 移除：`@radix-ui/react-*`（alert-dialog/dialog/dropdown-menu/select/separator/slot/tooltip 共 7 个）、`class-variance-authority`、`tailwindcss-animate`
- 保留：`clsx`、`tailwind-merge`（`cn` 仍用于业务 className 合并）、`lucide-react`（业务装饰图标）、`gsap`（已有）、`@tailwindcss/typography`
- vite.config.ts：移除 `optimizeDeps.exclude` 中的 `@radix-ui/react-dialog`
- tailwind.config.js：`plugins` 移除 `tailwindcss-animate`（手写的 accordion keyframes 保留）

## 三、Provider 接入与主题

现有 `useTheme` 是 hook 形态（AppRouter 调用，toggle 传 AppShell）。迁移后需在根处消费 theme 喂给 ConfigProvider。新增 `ThemeBridge` 组件：

```
BrowserRouter
└─ ThemeBridge（useTheme -> theme + toggle）
   └─ ConfigProvider（algorithm + token + locale=zhCN）
      └─ XProvider（locale=zhCN.X）
         └─ AuthProvider > App
```

- `AppShell` 的 `onToggleTheme` 改从 ThemeBridge 取，行为不变。
- ConfigProvider token 映射：`colorPrimary: "hsl(var(--primary))"`、`colorBgContainer: "hsl(var(--card))"`、`colorBgElevated: "hsl(var(--popover))"`、`colorText: "hsl(var(--foreground))"`、`colorTextSecondary: "hsl(var(--muted-foreground))"`、`colorBorder: "hsl(var(--border))"`、`borderRadius: "var(--radius)"` 等。`cssVar: true`。
- 风险：antd 全局样式与 Tailwind preflight 可能冲突，集成时实测关键页面无回归；必要时限定 `prefix`。

## 四、基础组件映射（删除 `src/components/ui/`）

| 现有 | antd | 变体映射 |
|---|---|---|
| Button | Button | default->primary，destructive->danger，outline/secondary->默认，ghost->text，link->link；icon->shape=circle |
| Dialog 全家桶 | Modal | title/desc/footer prop；open/onCancel |
| Select 全家桶 | Select | value/onChange |
| DropdownMenu（多选勾选） | Dropdown + Checkbox.Group | 保留按钮触发下拉勾选交互 |
| Input | Input | ref/aria-label 保留 |
| Textarea | Input.TextArea | className 保留 min-h/resize |

涉及文件：`AppSidebar`、`WorkflowRunPage`、`KnowledgeListPage`、`DocumentUploadDialog`。`asChild`（Radix Slot）模式废弃，antd `Dropdown` trigger 直接包按钮。

测试保留：`upload-dropzone`、`选择文件`、`标题`、`描述`、`知识库类型` 等 aria-label/testid。

## 五、Chat 组件映射（-> Ant Design X）

| 现有 | X / antd | 对接 |
|---|---|---|
| ChatMessageRow | X Bubble（Bubble.List 驱动） | roles 配置 user(右灰底)/assistant(左)；messageRender 接 MarkdownText 保留流式 markdown；typing 用 loading；复制+时间戳放 footer slot |
| ChatComposer | X Sender | onSubmit、loading(流式)、onCancel 接 onStop；Enter 发送/shift+enter 默认支持；手动补 Send message/Stop generating aria-label |
| SessionList | X Conversations | items + activeKey + onActiveChange；running 用 icon；删除走 menu |
| ToolApproval | antd Alert(warning) + Button | X 无对应组件；保留 Tool approval/Approve/Reject aria-label |
| AssistantPage | 容器 | messages -> Bubble.List；approval -> ToolApproval；空态文案保留 |
| WorkflowRunPage | 容器 | 复用 Sender + WorkflowRunMessage（自定义运行消息，含 gsap 动画/typing/复制/clarification form） |

测试更新：`Send message`/`Stop generating`/`Approve`/`Reject`/`Copy message`/`Copied`/`Assistant typing` 靠保留 aria-label 通过；`querySelector("svg")` 仍可用（antd/X icon 也是 svg）；`toHaveClass("animate-spin")` 改查 loading 状态或 stop 按钮存在性。

## 六、gsap 动画方案

新建 `src/lib/gsap-animations.ts`：封装 `useEnterAnimation(ref, opts)` hook，用 gsap context（scope + revert）+ `matchMedia` 做 reduced-motion 降级。

- 保留 CSS keyframes（装饰性）：streaming-text-sheen、run-pulse-dot/ring、goal-shell-glow-breathe、cli-app-linked-sheen
- 改 gsap 驱动（进出场）：composer-status-strip、queued-prompt-row（逐个核对实际引用，在用的改 gsap，无引用的清理）
- 新增：Bubble.List 消息进入 stagger、Conversations/知识库列表项进入、AppShell main 路由切换淡入
- WorkflowRunPage 现有 `gsap.fromTo` 保留并纳入统一工具

## 七、实施阶段

1. **基础设施**：依赖增减 + 安装；ThemeBridge + ConfigProvider/XProvider 接入；main.tsx；vite/tailwind 配置清理。验证现有页面无样式回归。
2. **基础组件迁移**：删除 `src/components/ui/`；改 4 个业务文件；更新对应测试。
3. **Chat -> X**：Composer->Sender、MessageRow->Bubble、SessionList->Conversations、ToolApproval->Alert+Button；AssistantPage + WorkflowRunPage 容器对接；更新 chat 测试。
4. **散落控件 + 动画**：WorkflowInterruptForm 原生控件 -> antd；其他页面原生 button/input/textarea -> antd；gsap 动画封装 + 重写 + 新增 stagger/路由淡入；移除 tailwindcss-animate；清理 globals.css 无引用动画。
5. **验证**：`npm test`、`npm run lint`、`npm run build`、视觉核对。

## 八、风险

- antd 全局样式与 Tailwind preflight 冲突（实测 + 必要时 prefix）
- X Bubble/Sender 默认样式与现有定制差异大，视觉回归高发，需逐项对照
- 大范围重构，单次零回归有挑战，分阶段 + 每阶段测试验证
- WorkflowRunPage 逻辑复杂（SSE、clarification form、gsap），迁移需小心保行为
