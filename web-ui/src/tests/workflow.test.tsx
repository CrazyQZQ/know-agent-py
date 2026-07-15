import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowsPage } from "@/features/workflows/WorkflowsPage";
import { WorkflowRunPage } from "@/features/workflows/WorkflowRunPage";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { streamSse, type StreamSseOptions } from "@/lib/sse-client";

vi.mock("@/lib/sse-client", () => ({ streamSse: vi.fn() }));

const streamSseMock = vi.mocked(streamSse);

function renderWorkflowRun() {
  localStorage.setItem("know-agent.auth", JSON.stringify({ token: "token", user: { name: "u", roles: [] } }));
  return render(
    <MemoryRouter initialEntries={["/workflows/ppt/thread-1"]}>
      <AuthProvider><Routes><Route path="/workflows/:workflowId/:threadId" element={<WorkflowRunPage />} /></Routes></AuthProvider>
    </MemoryRouter>,
  );
}

describe("workflow catalog", () => {
  beforeEach(() => {
    streamSseMock.mockReset();
  });

  it("shows extensible workflow cards and opens ppt run", () => {
    render(<MemoryRouter><WorkflowsPage /></MemoryRouter>);
    expect(screen.getByText("PPT 工作流")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: /运行 PPT/i }));
    expect(screen.getByRole("link", { name: /运行 PPT/i })).toHaveAttribute("href", "/workflows/ppt");
  });

  it("uses a guided step workspace for a workflow run", () => {
    renderWorkflowRun();
    expect(screen.getByRole("heading", { name: "PPT 工作流" })).toBeInTheDocument();
    expect(screen.getByLabelText("工作流步骤")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "工作流对话" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "运行详情" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "运行工作流" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("placeholder", "描述你想生成的演示文稿");
  });

  it("starts from the bottom composer and renders node output as chat messages", async () => {
    streamSseMock.mockImplementation(async (options: StreamSseOptions) => {
      options.onEvent({
        event: "update",
        data: JSON.stringify({ node: "requirement", values: { requirement: "为产品委员会制作 12 页季度汇报" } }),
      });
      options.onEvent({ event: "done", data: JSON.stringify({ ppt_result: "/files/report.pptx" }) });
    });
    renderWorkflowRun();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "制作季度产品汇报" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(screen.getByText("制作季度产品汇报")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("为产品委员会制作 12 页季度汇报")).toBeInTheDocument());
    expect(streamSseMock).toHaveBeenCalledWith(expect.objectContaining({
      path: "/v1/graph_run_sse",
      body: expect.objectContaining({ newMessage: { role: "user", content: "制作季度产品汇报" } }),
    }));
  });

  it("uses the same composer to resume after clarification", async () => {
    streamSseMock
      .mockImplementationOnce(async (options: StreamSseOptions) => {
        options.onEvent({ event: "interrupt", data: JSON.stringify({ clarification: "请补充汇报受众" }) });
      })
      .mockResolvedValueOnce(undefined);
    renderWorkflowRun();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "制作季度产品汇报" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText("请补充汇报受众")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("placeholder", "补充信息以继续工作流");

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "面向产品委员会" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(streamSseMock).toHaveBeenLastCalledWith(expect.objectContaining({
      path: "/v1/graph_resume_sse",
      body: expect.objectContaining({ clarificationResponse: "面向产品委员会" }),
    })));
  });

  it("stops the active workflow from the composer", async () => {
    let requestSignal: AbortSignal | undefined;
    streamSseMock.mockImplementation((options: StreamSseOptions) => {
      requestSignal = options.signal;
      return new Promise<void>((_, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    renderWorkflowRun();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "制作季度产品汇报" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop generating" }));

    expect(requestSignal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByText("已停止本次工作流。")).toBeInTheDocument());
  });
});
