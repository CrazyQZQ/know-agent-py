import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/features/auth/AuthProvider";
import { DocumentUploadDialog } from "@/features/knowledge/DocumentUploadDialog";

describe("document upload", () => {
  it("uses the web-ui controls and keeps files local when cancelled", async () => {
    const onClose = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter><AuthProvider><DocumentUploadDialog open onClose={onClose} /></AuthProvider></MemoryRouter>);

    expect(screen.getByRole("combobox", { name: "知识库类型" })).toBeInTheDocument();
    expect(document.querySelector("select[multiple]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /公开/ }));
    expect(await screen.findByRole("checkbox", { name: /管理员/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const file = new File(["hello"], "技术方案.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    fireEvent.drop(screen.getByTestId("upload-dropzone"), { dataTransfer: { files: [file] } });
    expect(screen.getByLabelText("标题")).toHaveValue("技术方案");
    expect(screen.getByLabelText("描述")).toHaveValue("技术方案");
    expect(screen.getByText("技术方案.docx")).toBeInTheDocument();

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
