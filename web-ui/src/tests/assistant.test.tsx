import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPage } from "@/features/assistant/AssistantPage";
import { AuthProvider } from "@/features/auth/AuthProvider";

const mocks = vi.hoisted(() => ({ history: vi.fn(), create: vi.fn(), run: vi.fn(), resume: vi.fn() }));
vi.mock("@/features/assistant/assistant-api", () => ({ createAssistantSession: mocks.create, getAssistantHistory: mocks.history, runAssistant: mocks.run, resumeAssistant: mocks.resume }));

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

  it("creates a conversation when sending from the empty assistant route", async () => {
    mocks.create.mockResolvedValue({ thread_id: "new-thread" });
    mocks.run.mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={["/assistant"]}>
        <AuthProvider><Routes>
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/assistant/:threadId" element={<AssistantPage />} />
        </Routes></AuthProvider>
      </MemoryRouter>,
    );

    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith("u", "token"));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "new-thread",
      content: "你好",
    })));
    expect(screen.getByText("你好")).toBeInTheDocument();
  });

  it("updates one assistant message while SSE chunks arrive", async () => {
    mocks.run.mockImplementation(async ({ onEvent }) => {
      onEvent({ event: "message", data: "现在" });
      onEvent({ event: "message", data: "是" });
      onEvent({ event: "message", data: "完整回复" });
    });
    render(
      <MemoryRouter initialEntries={["/assistant/t1"]}>
        <AuthProvider><Routes><Route path="/assistant/:threadId" element={<AssistantPage />} /></Routes></AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.history).toHaveBeenCalledWith("u", "t1", "token"));

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "提问" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("现在是完整回复")).toBeInTheDocument();
    expect(screen.queryByText("现在")).not.toBeInTheDocument();
    expect(screen.queryByText("现在是")).not.toBeInTheDocument();
  });

  it("smoothly scrolls the message list when new content arrives", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    mocks.run.mockImplementation(async ({ onEvent }) => {
      onEvent({ event: "message", data: "新回复" });
    });
    render(
      <MemoryRouter initialEntries={["/assistant/t1"]}>
        <AuthProvider><Routes><Route path="/assistant/:threadId" element={<AssistantPage />} /></Routes></AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.history).toHaveBeenCalledWith("u", "t1", "token"));
    scrollIntoView.mockClear();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "提问" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("新回复");
    await waitFor(() => expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "end",
    }));
  });
});
