import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppRouter } from "@/app/AppRouter";
import { AuthProvider } from "@/features/auth/AuthProvider";

describe("application routes", () => {
  it("redirects unauthenticated protected routes to login", () => {
    render(<AuthProvider><MemoryRouter initialEntries={["/knowledge"]}><AppRouter /></MemoryRouter></AuthProvider>);
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("renders the knowledge document detail route for an authenticated user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/segment/list-by-document")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({ doc_id: 1, doc_title: "文档", status: "VECTOR_STORED", updated_at: "2026-07-14T12:00:00Z" }));
    }));
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    render(<AuthProvider><MemoryRouter initialEntries={["/knowledge/doc-1"]}><AppRouter /></MemoryRouter></AuthProvider>);
    expect(screen.getByRole("heading", { name: "文档详情" })).toBeInTheDocument();
    expect(await screen.findByText("文档")).toBeInTheDocument();
  });
});
