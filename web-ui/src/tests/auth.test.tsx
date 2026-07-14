import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import { apiRequest } from "@/lib/api-client";
import { LoginPage } from "@/features/auth/LoginPage";

describe("authentication", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists login without storing the password", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      access_token: "token-1",
      user: { name: "lxqq", roles: ["admin"] },
    })));
    render(<AuthProvider><LoginPage /></AuthProvider>);
    await userEvent.type(screen.getByLabelText("用户名"), "lxqq");
    await userEvent.type(screen.getByLabelText("密码"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(localStorage.getItem("know-agent.auth")).toContain("token-1");
    expect(localStorage.getItem("know-agent.auth")).not.toContain("secret");
  });

  it("removes an expired session when a protected request receives 401", async () => {
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "stale", user: { name: "u", roles: [] } }));
    function Probe() {
      const { auth } = useAuth();
      return <span>{auth?.token ?? "signed-out"}</span>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText("stale")).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "expired" }), { status: 401 }),
    ));
    await act(async () => {
      await expect(apiRequest("/v1/protected", { token: "stale" })).rejects.toMatchObject({ status: 401 });
    });
    expect(await screen.findByText("signed-out")).toBeInTheDocument();
    expect(localStorage.getItem("know-agent.auth")).toBeNull();
  });
});
