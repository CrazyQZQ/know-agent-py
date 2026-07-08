"""文件类型判断与处理器工厂 — 对应源项目 FileTypeUtil + FileProcessServiceFactory."""

from know_agent.models.enums import FileType, KnowledgeBaseType
from know_agent.services.document.processors.base import FileProcessor
from know_agent.services.document.processors.pdf import PdfProcessor
from know_agent.services.document.processors.word import WordProcessor

_processors: list[FileProcessor] = [PdfProcessor(), WordProcessor()]


def get_file_type(file_name: str) -> FileType | None:
    """按扩展名判断文件类型（对应源项目 FileTypeUtil）."""
    name = (file_name or "").lower()
    if name.endswith(".pdf"):
        return FileType.PDF
    if name.endswith(".docx") or name.endswith(".doc"):
        return FileType.DOC
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return FileType.EXCEL
    if name.endswith(".csv"):
        return FileType.CSV
    if name.endswith(".md"):
        return FileType.MARKDOWN
    if name.endswith(".txt"):
        return FileType.TXT
    if name.endswith(".html") or name.endswith(".htm"):
        return FileType.HTML
    return None


def get_processor(file_type: FileType, kb_type: KnowledgeBaseType | None) -> FileProcessor | None:
    """按文件类型 + 知识库类型获取处理器；无匹配返回 None（Excel/CSV/TXT/MD 等）."""
    for p in _processors:
        if p.supports(file_type, kb_type):
            return p
    return None
