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

  it("renders the knowledge document detail route for an authenticated user", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ id: "doc-1", title: "文档", updated_at: "2026-07-14T12:00:00Z", segments: [] })));
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    render(<AuthProvider><MemoryRouter initialEntries={["/knowledge/doc-1"]}><AppRouter /></MemoryRouter></AuthProvider>);
    expect(screen.getByRole("heading", { name: "文档详情" })).toBeInTheDocument();
  });
});
