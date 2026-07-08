"""add content_md5 to document and chunk_md5 to segment

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-08
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 文档内容 MD5（版本标识）+ 分块 MD5（增量更新对比，相同则复用旧 embedding）
    op.add_column("knowledge_document",
                  sa.Column("content_md5", sa.String(length=64), nullable=True))
    op.add_column("knowledge_segment",
                  sa.Column("chunk_md5", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_segment", "chunk_md5")
    op.drop_column("knowledge_document", "content_md5")
