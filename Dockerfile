# syntax=docker/dockerfile:1.7

# ===== 构建阶段：安装依赖到 .venv =====
FROM python:3.12-slim AS builder

# 安装 uv（从官方镜像复制二进制，免 curl）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# 预编译字节码加速冷启动；copy 模式跨阶段复制更稳
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# 先复制依赖清单，利用层缓存（依赖不变时跳过安装）
COPY pyproject.toml uv.lock ./
# 只装依赖，不装项目本身
RUN uv sync --frozen --no-install-project --no-dev

# ===== 运行阶段 =====
FROM python:3.12-slim AS runtime

WORKDIR /app

# 复制虚拟环境
COPY --from=builder /app/.venv /app/.venv

# 复制源码、迁移、脚本
COPY src/ ./src/
COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY scripts/ ./scripts/

# .venv 优先；PYTHONPATH 让 src layout（src/know_agent）可 import
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# 启动前自动迁移；迁移失败则不启动服务（fail-fast）
CMD ["sh", "-c", "alembic upgrade head && uvicorn know_agent.main:app --host 0.0.0.0 --port 8000"]
