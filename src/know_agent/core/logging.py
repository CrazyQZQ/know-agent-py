"""日志配置 — loguru + request_id 串联.

每条日志注入当前请求的 request_id（来自 contextvar），并发请求可按 request_id 过滤出完整链路。
非请求上下文（启动/后台）的日志 request_id 显示为 "-"。
"""

import sys

from loguru import logger

from know_agent.core.request_context import get_request_id


def _request_id_patcher(record) -> None:
    """loguru patcher：把 request_id 注入 record.extra，供 format 引用."""
    record["extra"]["request_id"] = get_request_id() or "-"


def setup_logging() -> "logger":
    logger.remove()
    logger.configure(patcher=_request_id_patcher)
    logger.add(
        sys.stdout,
        level="DEBUG",
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            "<blue>{extra[request_id]}</blue> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
            "<level>{message}</level>"
        ),
        colorize=True,
    )
    return logger
