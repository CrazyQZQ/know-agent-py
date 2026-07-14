import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPage } from "@/features/assistant/AssistantPage";
import { AuthProvider } from "@/features/auth/AuthProvider";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), history: vi.fn(), remove: vi.fn(), run: vi.fn() }));
vi.mock("@/features/assistant/assistant-api", () => ({ listAssistantSessions: mocks.list, createAssistantSession: mocks.create, getAssistantHistory: mocks.history, deleteAssistantSession: mocks.remove, runAssistant: mocks.run }));

describe("AssistantPage", () => {
  beforeEach(() => {
    localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
    vi.clearAllMocks(); mocks.list.mockResolvedValue([]); mocks.history.mockResolvedValue([]); mocks.create.mockResolvedValue({ thread_id: "t1" });
  });
  it("loads sessions and creates a conversation with a composer", async () => {
    render(<MemoryRouter><AuthProvider><AssistantPage /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(screen.getByText(/create a conversation/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /new conversation/i }));
    expect(await screen.findByText("New conversation")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(mocks.run).toHaveBeenCalled());
    expect(mocks.run.mock.calls[0][0]).toMatchObject({ threadId: "t1", content: "hello" });
  });
});
