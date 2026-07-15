import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { WorkflowsPage } from "@/features/workflows/WorkflowsPage";
import { WorkflowRunPage } from "@/features/workflows/WorkflowRunPage";
import { AuthProvider } from "@/features/auth/AuthProvider";

describe("workflow catalog", () => {
  it("shows extensible workflow cards and opens ppt run", () => {
    render(<MemoryRouter><WorkflowsPage /></MemoryRouter>);
    expect(screen.getByText("PPT 工作流")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /运行 PPT/i }));
    expect(screen.getByRole("link", { name: /运行 PPT/i })).toHaveAttribute("href", "/workflows/ppt");
  });

  it("uses a guided step workspace for a workflow run", () => {
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    render(
      <MemoryRouter initialEntries={["/workflows/ppt/thread-1"]}>
        <AuthProvider><Routes><Route path="/workflows/:workflowId/:threadId" element={<WorkflowRunPage />} /></Routes></AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "PPT 工作流" })).toBeInTheDocument();
    expect(screen.getByLabelText("工作流步骤")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "当前步骤" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "运行详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行工作流" })).toBeInTheDocument();
  });
});
