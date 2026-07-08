"""ORM 模型 — 文档与分块，对应源项目 KnowledgeDocument / KnowledgeSegment."""

from sqlalchemy import BigInteger, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from know_agent.db.base import Base, SoftDeleteMixin, TimestampMixin
from know_agent.models.enums import DocumentStatus, KnowledgeBaseType, SegmentStatus


class KnowledgeDocument(Base, TimestampMixin, SoftDeleteMixin):
    """知识文档表."""

    __tablename__ = "knowledge_document"
    __table_args__ = (
        Index("idx_status", "status"),
        Index("idx_status_doc_id", "status", "doc_id"),
        Index("idx_created_at", "created_at"),
    )

    doc_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    doc_title: Mapped[str] = mapped_column(String(1024), nullable=False)
    upload_user: Mapped[str | None] = mapped_column(String(255), nullable=True)
    doc_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    converted_doc_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    status: Mapped[DocumentStatus] = mapped_column(
        SAEnum(DocumentStatus, native_enum=False, length=32), nullable=False
    )
    accessible_by: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    description: Mapped[str | None] = mapped_column(String(512), nullable=True)
    knowledge_base_type: Mapped[KnowledgeBaseType | None] = mapped_column(
        SAEnum(KnowledgeBaseType, native_enum=False, length=32), nullable=True
    )
    # extension 存 JSON（isOverride / tableName 等），对应源项目 extension 字段
    extension: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    def __repr__(self) -> str:
        return f"<KnowledgeDocument doc_id={self.doc_id} title={self.doc_title!r} status={self.status}>"


class KnowledgeSegment(Base, TimestampMixin, SoftDeleteMixin):
    """知识分块表."""

    __tablename__ = "knowledge_segment"
    __table_args__ = (
        Index("idx_document_id", "document_id"),
        Index("idx_document_id_chunk_order", "document_id", "chunk_order"),
        Index("idx_document_status_skip", "document_id", "status", "skip_embedding"),
        # PG 索引名 schema 内唯一，segment 表用 idx_segment_status 避免与 document 表冲突
        Index("idx_segment_status", "status"),
        # pg_trgm GIN 索引：关键词检索（trigram 相似度），替代 Elasticsearch
        Index(
            "idx_segment_text_trgm",
            "text",
            postgresql_using="gin",
            postgresql_ops={"text": "gin_trgm_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # "metadata" 是 SQLAlchemy 保留属性，Python 侧用 metadata_ 别名映射到列 metadata
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    document_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chunk_order: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[SegmentStatus | None] = mapped_column(
        SAEnum(SegmentStatus, native_enum=False, length=32), nullable=True
    )
    skip_embedding: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def __repr__(self) -> str:
        return f"<KnowledgeSegment id={self.id} document_id={self.document_id} order={self.chunk_order}>"
