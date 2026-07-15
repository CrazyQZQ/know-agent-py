import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPage } from "@/features/assistant/AssistantPage";
import { AuthProvider } from "@/features/auth/AuthProvider";

const mocks = vi.hoisted(() => ({ history: vi.fn(), run: vi.fn(), resume: vi.fn() }));
vi.mock("@/features/assistant/assistant-api", () => ({ getAssistantHistory: mocks.history, runAssistant: mocks.run, resumeAssistant: mocks.resume }));

describe("AssistantPage", () => {
  beforeEach(() => {
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    vi.clearAllMocks(); mocks.history.mockResolvedValue([]);
  });
  it("renders only the active conversation and composer", async () => {
    render(<MemoryRouter initialEntries={["/assistant/t1"]}><AuthProvider><Routes><Route path="/assistant/:threadId" element={<AssistantPage />} /></Routes></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(mocks.history).toHaveBeenCalledWith("u", "t1", "token"));
    expect(screen.queryByRole("button", { name: /new conversation/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/conversation list/i)).not.toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalled());
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ threadId: "t1", content: "hello" });
  });
});
