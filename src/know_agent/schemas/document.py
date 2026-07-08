"""文档管理 API 模型."""

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    doc_id: int
    doc_title: str
    upload_user: str | None = None
    doc_url: str | None = None
    converted_doc_url: str | None = None
    status: str
    accessible_by: str | None = None
    description: str | None = None
    knowledge_base_type: str | None = None
    extension: dict | None = None
    error_message: str | None = None
    content_md5: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SegmentOut(BaseModel):
    # metadata 是 SQLAlchemy 保留属性，ORM 侧用 metadata_ 别名；这里从 metadata_ 读、以 metadata 输出
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    text: str
    chunk_id: str | None = None
    metadata: dict | None = Field(default=None, validation_alias="metadata_")
    document_id: int
    chunk_order: int
    embedding_id: str | None = None
    status: str | None = None
    skip_embedding: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SearchResultOut(BaseModel):
    segment_id: int | None = None
    text: str
    score: float
    source: str  # keyword / vector / hybrid
    metadata: dict = {}


class PageResponse(BaseModel, Generic[T]):
    records: list[T]
    total: int
    current: int
    size: int
