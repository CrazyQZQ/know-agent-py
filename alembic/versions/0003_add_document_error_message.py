"""add error_message column to knowledge_document

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-08
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 异步处理失败时记录错误信息（status=FAILED 时填充），前端轮询展示
    op.add_column(
        "knowledge_document",
        sa.Column("error_message", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("knowledge_document", "error_message")
