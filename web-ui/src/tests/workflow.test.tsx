import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/features/auth/AuthProvider";
import { WorkflowRunPage } from "@/features/workflows/WorkflowRunPage";
import { WorkflowsPage } from "@/features/workflows/WorkflowsPage";
import { ApiError } from "@/lib/api-client";
import { streamSse, type StreamSseOptions } from "@/lib/sse-client";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn().mockResolvedValue({ svg: '<svg data-testid="workflow-diagram"></svg>' }),
}));

vi.mock("mermaid", () => ({ default: mermaidMocks }));
vi.mock("@/lib/sse-client", () => ({ streamSse: vi.fn() }));

const streamSseMock = vi.mocked(streamSse);
const fetchMock = vi.fn();

const topology = {
  nodes: [
    { id: "requirement", name: "requirement" },
    { id: "quality_gate", name: "quality_gate" },
    { id: "render", name: "render" },
  ],
  mermaid: "graph TD; requirement-->quality_gate; quality_gate-->render;",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signIn() {
  localStorage.setItem(
    "know-agent.auth",
    JSON.stringify({ token: "token", user: { name: "u", roles: [] } }),
  );
}

function renderCatalog() {
  signIn();
  return render(
    <MemoryRouter initialEntries={["/workflows"]}>
      <AuthProvider>
        <WorkflowsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function renderWorkflowRun(path = "/workflows/ppt_build/thread-1") {
  signIn();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/workflows/:workflowId/:threadId" element={<WorkflowRunPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("workflow registry integration", () => {
  beforeEach(() => {
    streamSseMock.mockReset();
    fetchMock.mockReset();
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/v1/list-graphs") {
        return Promise.resolve(jsonResponse([
          {
            name: "ppt_build",
            title: "PPT 生成",
            description: "根据需求生成 PPT",
          },
          {
            name: "report_builder",
            title: "数据报告",
            description: "生成数据分析报告",
          },
        ]));
      }
      if (path === "/v1/graph_topology/ppt_build") {
        return Promise.resolve(jsonResponse(topology));
      }
      if (path === "/v1/graph_topology/report_builder") {
        return Promise.resolve(jsonResponse({
          nodes: [
            { id: "collect", name: "collect" },
            { id: "publish", name: "publish" },
          ],
          mermaid: "graph TD; collect-->publish;",
        }));
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("renders backend graph metadata and links with the registered graph name", async () => {
    renderCatalog();

    expect(await screen.findByRole("heading", { name: "PPT 生成" })).toBeInTheDocument();
    expect(screen.getByText("根据需求生成 PPT")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /运行 PPT 生成/ })).toHaveAttribute(
      "href",
      "/workflows/ppt_build",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/list-graphs",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("uses backend topology nodes and renders the returned Mermaid graph", async () => {
    const { container } = renderWorkflowRun();

    expect(await screen.findByText("quality_gate")).toBeInTheDocument();
    await waitFor(() => expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.any(String),
      topology.mermaid,
    ));
    expect(container.querySelector('[data-testid="workflow-diagram"]')).toBeTruthy();
  });

  it("runs the registered graph and reads the generic done result", async () => {
    streamSseMock.mockImplementation(async (options: StreamSseOptions) => {
      options.onEvent({
        event: "update",
        data: JSON.stringify({ node: "requirement", values: { requirement: "制作季度产品汇报" } }),
      });
      options.onEvent({ event: "done", data: JSON.stringify({ result: "/files/report.pptx" }) });
    });
    renderWorkflowRun();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "制作季度产品汇报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(streamSseMock).toHaveBeenCalledWith(expect.objectContaining({
      path: "/v1/graph_run_sse",
      body: expect.objectContaining({ graphName: "ppt_build" }),
    })));
    expect(await screen.findByRole("link", { name: "下载演示文稿" })).toHaveAttribute(
      "href",
      "/files/report.pptx",
    );
  });

  it("shows a specific message when a graph no longer exists", async () => {
    streamSseMock.mockRejectedValue(new ApiError(404, "graph 'ppt_build' not found"));
    renderWorkflowRun();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "制作季度产品汇报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("工作流不存在或已下线")).toBeInTheDocument();
  });

  it("uses the registered graph name when resuming after clarification", async () => {
    streamSseMock
      .mockImplementationOnce(async (options: StreamSseOptions) => {
        options.onEvent({
          event: "interrupt",
          data: JSON.stringify({ clarification: "请补充汇报受众" }),
        });
      })
      .mockResolvedValueOnce(undefined);
    renderWorkflowRun();

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "制作季度产品汇报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("请补充汇报受众");

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "面向产品委员会" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(streamSseMock).toHaveBeenLastCalledWith(expect.objectContaining({
      path: "/v1/graph_resume_sse",
      body: expect.objectContaining({ graphName: "ppt_build" }),
    })));
  });

  it("renders generic node output and result for a non-PPT graph", async () => {
    streamSseMock.mockImplementation(async (options: StreamSseOptions) => {
      options.onEvent({
        event: "update",
        data: JSON.stringify({
          node: "collect",
          values: { summary: "数据采集完成", artifact_result: "/files/report.csv" },
        }),
      });
      options.onEvent({ event: "done", data: JSON.stringify({ result: "/files/report.csv" }) });
    });
    renderWorkflowRun("/workflows/report_builder/thread-2");

    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "生成月度数据报告" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("数据采集完成")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "下载结果" })).toHaveAttribute(
      "href",
      "/files/report.csv",
    );
    expect(screen.queryByText("PPT 已生成。")).not.toBeInTheDocument();
    expect(streamSseMock).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ graphName: "report_builder" }),
    }));
  });
});
