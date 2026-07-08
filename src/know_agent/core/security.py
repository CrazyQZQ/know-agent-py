"""API 认证 — 支持 Casdoor JWT（OIDC）与 API Key 两种模式.

- AUTH_ENABLED=false（默认）：旁路（本地开发）
- AUTH_ENABLED=true + CASDOOR_ENABLED=true：Casdoor JWT 认证（调 /api/userinfo 验证）
- AUTH_ENABLED=true + CASDOOR_ENABLED=false：API Key 头认证

Casdoor 模式（方式 A）：验证 Bearer token，提取用户 + 角色，注入 contextvar 供检索权限过滤。
token 验证结果内存缓存（TTL=casdoor_token_cache_ttl），避免每请求调 Casdoor。
"""

import secrets
import time

import requests
from fastapi import Header, HTTPException, status
from loguru import logger

from know_agent.configuration import get_settings
from know_agent.core.request_context import set_current_roles, set_current_user

# token -> (userinfo, expire_at)，进程级缓存
_token_cache: dict[str, tuple[dict, float]] = {}
# 已注销 token 黑名单（进程内，重启清空；单实例够用，多实例需 Redis 共享）
_revoked_tokens: set[str] = set()


def revoke_token(token: str) -> None:
    """将 token 加入注销黑名单（logout 时调用）."""
    _revoked_tokens.add(token)


async def verify_api_key(api_key: str | None) -> str:
    """API Key 模式校验（内部函数，由 verify_auth 调用）."""
    s = get_settings()
    if not s.api_key:
        logger.warning("[auth] AUTH_ENABLED=true 但未配置 API_KEY，临时旁路")
        set_current_user("anonymous")
        set_current_roles([])
        return "anonymous"
    if not api_key or not secrets.compare_digest(api_key, s.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    # API Key 模式无用户身份/角色，仅可访问公开文档
    set_current_user("anonymous")
    set_current_roles([])
    return api_key


async def verify_casdoor_token(authorization: str | None) -> dict:
    """Casdoor JWT 模式：调 /api/userinfo 验证 token，提取用户 + 角色注入 contextvar."""
    s = get_settings()
    if not s.casdoor_endpoint:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "CASDOOR_ENDPOINT 未配置"
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization[7:].strip()

    # 注销黑名单检查（logout 后立即失效）
    if token in _revoked_tokens:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token 已注销")

    # 缓存命中检查
    now = time.time()
    cached = _token_cache.get(token)
    if cached and cached[1] > now:
        info = cached[0]
    else:
        url = f"{s.casdoor_endpoint.rstrip('/')}{s.casdoor_userinfo_path}"
        try:
            resp = requests.get(
                url, headers={"Authorization": f"Bearer {token}"}, timeout=5
            )
            resp.raise_for_status()
            info = resp.json()
        except requests.HTTPError as e:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, f"Casdoor token 无效: {e}"
            )
        except Exception as e:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"Casdoor 不可达: {e}"
            )
        _token_cache[token] = (info, now + s.casdoor_token_cache_ttl)

    user = info.get("sub") or info.get("name") or "unknown"
    raw_roles = info.get(s.casdoor_roles_field) or []
    if isinstance(raw_roles, str):
        raw_roles = [raw_roles]
    # Casdoor 角色格式 org/role_name，取 role_name 部分
    roles = [r.split("/", 1)[-1] if "/" in r else r for r in raw_roles]
    set_current_user(user)
    set_current_roles(roles)
    logger.debug("[auth] casdoor user={} roles={}", user, roles)
    return info


async def verify_auth(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="x-api-key"),
) -> dict | str:
    """统一认证入口：根据配置分发到 Casdoor JWT 或 API Key 模式."""
    s = get_settings()
    if not s.auth_enabled:
        set_current_user("anonymous")
        set_current_roles([])
        return "anonymous"
    if s.casdoor_enabled:
        return await verify_casdoor_token(authorization)
    return await verify_api_key(x_api_key)
