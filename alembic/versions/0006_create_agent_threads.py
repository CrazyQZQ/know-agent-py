"""create agent thread metadata table

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-09
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_threads",
        sa.Column("thread_id", sa.String(length=128), primary_key=True),
        sa.Column("app_name", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_agent_threads_user_app", "agent_threads", ["user_id", "app_name"])
    op.create_index("idx_agent_threads_updated_at", "agent_threads", ["updated_at"])


def downgrade() -> None:
    op.drop_index("idx_agent_threads_updated_at", table_name="agent_threads")
    op.drop_index("idx_agent_threads_user_app", table_name="agent_threads")
    op.drop_table("agent_threads")
