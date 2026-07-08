"""领域枚举 — 对应源项目 document/constant/*."""

from enum import Enum


class DocumentStatus(str, Enum):
    """文档状态机：INIT → UPLOADED → CONVERTING → CONVERTED → CHUNKED → VECTOR_STORED."""

    INIT = "INIT"
    UPLOADED = "UPLOADED"
    CONVERTING = "CONVERTING"
    CONVERTED = "CONVERTED"
    CHUNKED = "CHUNKED"
    VECTOR_STORED = "VECTOR_STORED"
    STORED = "STORED"  # 不需要向量存储的终态


class SegmentStatus(str, Enum):
    """分块状态."""

    STORED = "STORED"  # 关系库存储完成
    VECTOR_STORED = "VECTOR_STORED"  # 向量库存储完成


class FileType(str, Enum):
    PDF = "pdf"
    DOC = "doc"
    TXT = "txt"
    HTML = "html"
    MARKDOWN = "markdown"
    CSV = "csv"
    EXCEL = "excel"


class KnowledgeBaseType(str, Enum):
    """知识库类型."""

    DOCUMENT_SEARCH = "DOCUMENT_SEARCH"
    DATA_QUERY = "DATA_QUERY"


class SplitType(str, Enum):
    """分块策略."""

    LENGTH = "LENGTH"
    TITLE = "TITLE"
    REGEX = "REGEX"
    SMART = "SMART"
    SEPARATOR = "SEPARATOR"


class ContentType:
    """MIME 类型常量."""

    TEXT_PLAIN = "text/plain"
    TEXT_HTML = "text/html"
    TEXT_MARKDOWN = "text/markdown"
    ZIP = "application/zip"
