"""create HNSW index on langchain_pg_embedding

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-08
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # HNSW 索引（cosine 距离）：比 ivfflat 召回更稳、无需调 lists。
    # embedding 已降到 1024 维，满足 pgvector HNSW 维度限制。
    # langchain_pg_embedding 表由 PGVector 首次写入时创建，迁移时可能尚未存在，用 DO block 守卫。
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'langchain_pg_embedding') THEN
                CREATE INDEX IF NOT EXISTS idx_langchain_pg_embedding_hnsw
                ON langchain_pg_embedding USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_langchain_pg_embedding_hnsw")
