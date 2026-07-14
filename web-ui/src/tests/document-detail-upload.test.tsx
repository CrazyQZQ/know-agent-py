import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DocumentUploadDialog } from "@/features/knowledge/DocumentUploadDialog";
import { AuthProvider } from "@/features/auth/AuthProvider";

describe("document upload", () => {
  it("fills title/description from dropped file and cancel does not upload", () => {
    const onClose = vi.fn();
    render(<MemoryRouter><AuthProvider><DocumentUploadDialog open onClose={onClose} /></AuthProvider></MemoryRouter>);
    const file = new File(["hello"], "技术方案.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    fireEvent.drop(screen.getByTestId("upload-dropzone"), { dataTransfer: { files: [file] } });
    expect(screen.getByLabelText("标题")).toHaveValue("技术方案");
    expect(screen.getByLabelText("描述")).toHaveValue("技术方案");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalled();
  });
});
