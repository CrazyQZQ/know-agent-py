"""add pg_trgm extension and trgm index on segment text

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-07
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pg_trgm：PG 内置扩展，trigram 关键词检索（替代 Elasticsearch 关键词检索）
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_segment_text_trgm "
        "ON knowledge_segment USING GIN (text gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_segment_text_trgm")
