"""PDF 处理器 — PyMuPDF (fitz).

替代源项目的 MinerU 调用，本地直接解析。
"""

import fitz  # pymupdf

from know_agent.models.enums import FileType, KnowledgeBaseType
from know_agent.services.document.processors.base import FileProcessor


class PdfProcessor(FileProcessor):
    def supports(self, file_type: FileType, kb_type: KnowledgeBaseType | None) -> bool:
        return file_type == FileType.PDF

    def parse(self, content: bytes) -> str:
        doc = fitz.open(stream=content, filetype="pdf")
        parts: list[str] = []
        for page in doc:
            parts.append(page.get_text("text"))
        doc.close()
        return "\n\n".join(parts)
