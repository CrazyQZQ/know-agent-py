"""recreate HNSW index after embedding dimension downgrade

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-09
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0004 曾在 2048 维时可能跳过 HNSW；降到 1024 维后显式重建一次。
    # 旧向量为 2048 维且 embedding 列可能是裸 vector，无法直接建 HNSW 或 cast 到 1024。
    # 因此清空旧向量并把业务状态退回待向量化，后续重新 embed 生成 1024 维数据。
    op.execute(
        """
        UPDATE knowledge_segment
        SET embedding_id = NULL, status = 'STORED'
        WHERE embedding_id IS NOT NULL OR status = 'VECTOR_STORED';

        UPDATE knowledge_document
        SET status = 'CHUNKED'
        WHERE status = 'VECTOR_STORED';
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'langchain_pg_embedding') THEN
                DROP INDEX IF EXISTS idx_langchain_pg_embedding_hnsw;
                DELETE FROM langchain_pg_embedding;
                ALTER TABLE langchain_pg_embedding
                ALTER COLUMN embedding TYPE vector(1024)
                USING NULL::vector(1024);
                CREATE INDEX idx_langchain_pg_embedding_hnsw
                ON langchain_pg_embedding USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS idx_langchain_pg_embedding_hnsw;
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables
                       WHERE table_name = 'langchain_pg_embedding') THEN
                DELETE FROM langchain_pg_embedding;
                ALTER TABLE langchain_pg_embedding
                ALTER COLUMN embedding TYPE vector
                USING NULL::vector;
            END IF;
        END $$;
        """
    )
