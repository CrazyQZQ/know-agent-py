"""init document tables

Revision ID: 0001
Revises:
Create Date: 2026-07-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_document",
        sa.Column("doc_id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("doc_title", sa.String(1024), nullable=False),
        sa.Column("upload_user", sa.String(255), nullable=True),
        sa.Column("doc_url", sa.String(2048), nullable=True),
        sa.Column("converted_doc_url", sa.String(2048), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("accessible_by", sa.String(1024), nullable=True),
        sa.Column("description", sa.String(512), nullable=True),
        sa.Column("knowledge_base_type", sa.String(32), nullable=True),
        sa.Column("extension", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("lock_version", sa.Integer, server_default="0", nullable=False),
        sa.Column("deleted", sa.Integer, server_default="0", nullable=False),
    )
    op.create_index("idx_status", "knowledge_document", ["status"])
    op.create_index("idx_status_doc_id", "knowledge_document", ["status", "doc_id"])
    op.create_index("idx_created_at", "knowledge_document", ["created_at"])

    op.create_table(
        "knowledge_segment",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("chunk_id", sa.String(255), nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
        sa.Column("document_id", sa.BigInteger, nullable=False),
        sa.Column("chunk_order", sa.Integer, nullable=False),
        sa.Column("embedding_id", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("skip_embedding", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column("lock_version", sa.Integer, server_default="0", nullable=False),
        sa.Column("deleted", sa.Integer, server_default="0", nullable=False),
    )
    op.create_index("idx_document_id", "knowledge_segment", ["document_id"])
    op.create_index("idx_document_id_chunk_order", "knowledge_segment", ["document_id", "chunk_order"])
    op.create_index(
        "idx_document_status_skip", "knowledge_segment", ["document_id", "status", "skip_embedding"]
    )
    # PG 索引名 schema 内唯一，segment 表用 idx_segment_status
    op.create_index("idx_segment_status", "knowledge_segment", ["status"])


def downgrade() -> None:
    op.drop_table("knowledge_segment")
    op.drop_table("knowledge_document")
