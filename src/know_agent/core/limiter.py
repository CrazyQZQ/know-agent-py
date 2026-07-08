"""API 限流 — slowapi，按客户端 IP 限流，保护高成本端点（agent/graph）.

限流速率由 `RATE_LIMIT` 配置（默认 60/minute），端点用
`@limiter.limit(lambda: get_settings().rate_limit)` 动态读取，超频触发
`RateLimitExceeded`，由 main.py 的 `_rate_limit_exceeded_handler` 返回 429。
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

# 单例 limiter（main.py 挂到 app.state.limiter + SlowAPIMiddleware）
limiter = Limiter(key_func=get_remote_address)
