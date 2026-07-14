import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AppRouter } from "@/app/AppRouter";
import { AuthProvider } from "@/features/auth/AuthProvider";

describe("application routes", () => {
  it("redirects unauthenticated protected routes to login", () => {
    render(<AuthProvider><MemoryRouter initialEntries={["/knowledge"]}><AppRouter /></MemoryRouter></AuthProvider>);
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("renders the knowledge document detail route for an authenticated user", () => {
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    render(<AuthProvider><MemoryRouter initialEntries={["/knowledge/doc-1"]}><AppRouter /></MemoryRouter></AuthProvider>);
    expect(screen.getByRole("heading", { name: "文档详情" })).toBeInTheDocument();
  });
});
