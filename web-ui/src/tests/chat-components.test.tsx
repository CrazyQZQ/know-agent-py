import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatMessageRow } from "@/components/chat/ChatMessageRow";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ToolApproval } from "@/components/chat/ToolApproval";

describe("shared chat components", () => {
  it("renders user and assistant timestamps and copies either message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const createdAt = new Date(2026, 6, 14, 10, 5, 9).getTime();
    render(
      <>
        <ChatMessageRow role="user" content="question" createdAt={createdAt} />
        <ChatMessageRow role="assistant" content="answer" createdAt={createdAt} />
      </>,
    );

    expect(screen.getAllByText("05:09")).toHaveLength(2);
    const copyButtons = screen.getAllByRole("button", { name: "Copy message" });
    fireEvent.click(copyButtons[0]);
    fireEvent.click(copyButtons[1]);
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(1, "question"));
    expect(writeText).toHaveBeenNthCalledWith(2, "answer");
  });

  it("renders assistant content through markdown and shows dots while waiting for the first token", () => {
    const { rerender } = render(<ChatMessageRow role="assistant" content="**bold**" createdAt={Date.now()} />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    rerender(<ChatMessageRow role="assistant" content="" createdAt={Date.now()} isStreaming />);
    expect(screen.getByLabelText("Assistant typing")).toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
  });

  it("uses a send icon and switches to a stop action while streaming", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <ChatComposer value="hello" onChange={vi.fn()} onSend={onSend} />,
    );
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.querySelector("svg")).toBeTruthy();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith("hello");

    rerender(<ChatComposer value="hello" onChange={vi.fn()} onSend={onSend} isStreaming onStop={onStop} />);
    const stop = screen.getByRole("button", { name: "Stop generating" });
    expect(stop.querySelector("svg")).toBeTruthy();
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("submits tool approval decisions", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ToolApproval title="Run search" description="Search documents" onApprove={onApprove} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });
});
