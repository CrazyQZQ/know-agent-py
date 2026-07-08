"""文件处理器接口 — 对应源项目 FileProcessService."""

from abc import ABC, abstractmethod

from know_agent.models.enums import FileType, KnowledgeBaseType


class FileProcessor(ABC):
    """文件处理器：把原始文件解析为文本/markdown."""

    @abstractmethod
    def supports(self, file_type: FileType, kb_type: KnowledgeBaseType | None) -> bool:
        """是否支持该文件类型."""

    @abstractmethod
    def parse(self, content: bytes) -> str:
        """解析文件字节，返回文本/markdown."""
