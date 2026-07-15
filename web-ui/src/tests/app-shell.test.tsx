import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/shell/AppShell";
import { SessionList } from "@/components/shell/SessionList";

const assistantMocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), remove: vi.fn() }));
vi.mock("@/features/assistant/assistant-api", () => ({
  listAssistantSessions: assistantMocks.list,
  createAssistantSession: assistantMocks.create,
  deleteAssistantSession: assistantMocks.remove,
}));

describe("AppShell", () => {
  it("owns assistant sessions and new conversation in the main sidebar", async () => {
    assistantMocks.list.mockResolvedValue([{ thread_id: "t1", name: "会话一" }]);
    assistantMocks.create.mockResolvedValue({ thread_id: "t2" });
    render(
      <MemoryRouter initialEntries={["/assistant/t1"]}>
        <AppShell token="token" user={{ name: "u", roles: [] }} onLogout={vi.fn()} onToggleTheme={vi.fn()}>
          <h1>Assistant</h1>
        </AppShell>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "会话一" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建对话" }));
    await waitFor(() => expect(assistantMocks.create).toHaveBeenCalledWith("u", "token"));
  });

  it("shows only the three Know-Agent primary modules", () => {
    render(
      <MemoryRouter initialEntries={["/assistant"]}>
        <AppShell user={{ name: "lxqq", roles: ["管理员"] }} onLogout={vi.fn()} onToggleTheme={vi.fn()}>
          <h1>Assistant</h1>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "智能助理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "工作流" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "知识库" })).toBeInTheDocument();
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
    expect(screen.getByText("lxqq")).toBeInTheDocument();
    expect(screen.getByText("管理员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换主题" })).toHaveAttribute("title", "切换主题");
    expect(screen.getByRole("button", { name: "退出登录" })).toHaveAttribute("title", "退出登录");
    expect(screen.getByRole("button", { name: "打开导航" })).toBeInTheDocument();
    expect(screen.getByTestId("app-shell")).toHaveClass("h-dvh", "overflow-hidden");
  });

  it("marks running sessions with an accessible spinner", () => {
    render(
      <SessionList
        sessions={[{ id: "run-1", title: "季度汇报", running: true }]}
        activeId="run-1"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("季度汇报正在运行")).toHaveClass("animate-spin", "motion-reduce:animate-none");
  });

  it("selects and deletes sessions", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(<SessionList sessions={[{ id: "a", title: "会话 A", running: false }]} activeId={null} onSelect={onSelect} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "会话 A" }));
    fireEvent.click(screen.getByRole("button", { name: "删除会话 A" }));
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(onDelete).toHaveBeenCalledWith("a");
  });
});
