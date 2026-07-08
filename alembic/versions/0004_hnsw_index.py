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
    # HNSW 索引（cosine 距离）：比 ivfflat 召回更稳、无需调 lists；
    # m=16 每层邻居数，ef_construction=64 构建候选池（越大召回越好、构建越慢）。
    # pgvector HNSW 限制 2000 维，doubao embedding 2048 维超限 →
    # 用 EXCEPTION 守卫：建失败时 NOTICE 跳过（不阻断迁移）。
    # 降维到 ≤2000（改 EMBEDDING_DIMENSIONS + 重新向量化）或切 halfvec 后重跑迁移即生效。
    # langchain_pg_embedding 表由 PGVector 首次写入时创建，迁移时可能尚未存在，用 DO block 守卫。
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'langchain_pg_embedding') THEN
                BEGIN
                    CREATE INDEX IF NOT EXISTS idx_langchain_pg_embedding_hnsw
                    ON langchain_pg_embedding USING hnsw (embedding vector_cosine_ops)
                    WITH (m = 16, ef_construction = 64);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'HNSW 索引跳过（维度 >2000 或列无维度）: %', SQLERRM;
                END;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_langchain_pg_embedding_hnsw")
