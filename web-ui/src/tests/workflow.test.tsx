import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { WorkflowsPage } from "@/features/workflows/WorkflowsPage";

describe("workflow catalog", () => {
  it("shows extensible workflow cards and opens ppt run", () => {
    render(<MemoryRouter><WorkflowsPage /></MemoryRouter>);
    expect(screen.getByText("PPT 工作流")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /运行 PPT/i }));
    expect(screen.getByRole("link", { name: /运行 PPT/i })).toHaveAttribute("href", "/workflows/ppt");
  });
});
