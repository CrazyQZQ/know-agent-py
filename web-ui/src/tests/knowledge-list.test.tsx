import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeListPage } from "@/features/knowledge/KnowledgeListPage";
import { AuthProvider } from "@/features/auth/AuthProvider";

vi.mock("@/features/knowledge/knowledge-api", () => ({ listAllDocuments: vi.fn().mockResolvedValue([{ id: 1, title: "Doc", status: "VECTOR_STORED", updated_at: "2026-07-14T10:20:30" }]), deleteDocument: vi.fn().mockResolvedValue(undefined) }));
describe("knowledge document list", () => {
  it("renders search/filter/refresh, status color, timestamp and full pagination actions", async () => {
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    render(<MemoryRouter><AuthProvider><KnowledgeListPage /></AuthProvider></MemoryRouter>);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传文档" })).not.toHaveClass("fixed");
    expect(screen.getByRole("button", { name: /刷新/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(await screen.findByText("VECTOR_STORED")).toHaveClass("text-emerald-700");
    expect(screen.getByText("2026-07-14 10:20:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /上一页/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一页/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看详情/i })).toHaveAttribute("href", "/knowledge/1");
    fireEvent.click(screen.getByRole("button", { name: /删除/i }));
    await waitFor(() => expect(screen.queryByText("Doc")).not.toBeInTheDocument());
  });
});
