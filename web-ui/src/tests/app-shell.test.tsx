import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/shell/AppShell";
import { SessionList } from "@/components/shell/SessionList";

describe("AppShell", () => {
  it("shows only the three Know-Agent primary modules", () => {
    render(
      <MemoryRouter initialEntries={["/assistant"]}>
        <AppShell user={{ name: "lxqq", roles: [] }} onLogout={vi.fn()} onToggleTheme={vi.fn()}>
          <h1>Assistant</h1>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "智能助理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "工作流" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "知识库" })).toBeInTheDocument();
    expect(screen.queryByText("Skills")).not.toBeInTheDocument();
    expect(screen.getByText("lxqq")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
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

    expect(screen.getByLabelText("季度汇报正在运行")).toHaveClass("animate-spin");
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
