"""Casdoor 客户端 — 角色列表查询（client credentials）.

上传文档时前端需要列出 Casdoor 可选角色（绑定可见角色）。后端用应用凭证走
client_credentials 换 token，调 /api/get-roles 列出组织内角色，缓存 10min。
"""

import time

import requests
from loguru import logger

from know_agent.configuration import get_settings

# client token 缓存：{token, expire}
_client_token_cache: dict[str, object] = {"token": None, "expire": 0.0}
# 角色列表缓存：{roles, expire}
_roles_cache: dict[str, object] = {"roles": [], "expire": 0.0}
ROLES_CACHE_TTL = 600  # 角色列表缓存 10min（角色不常变）
_CLIENT_TOKEN_TTL = 300  # client token 缓存 5min


def _get_client_token() -> str:
    """用 client_credentials 换 Casdoor token（缓存 5min）."""
    s = get_settings()
    now = time.time()
    cached_token = _client_token_cache["token"]
    if cached_token and _client_token_cache["expire"] > now:
        return str(cached_token)
    resp = requests.post(
        f"{s.casdoor_endpoint.rstrip('/')}/api/login/oauth/access_token",
        data={
            "grant_type": "client_credentials",
            "client_id": s.casdoor_client_id,
            "client_secret": s.casdoor_client_secret,
            "scope": "openid profile",
        },
        timeout=10,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    _client_token_cache["token"] = token
    _client_token_cache["expire"] = now + _CLIENT_TOKEN_TTL
    return token


def list_roles() -> list[dict]:
    """列出 Casdoor 组织内所有角色 [{name, displayName}]，缓存 10min."""
    s = get_settings()
    if not s.casdoor_enabled or not s.casdoor_org:
        return []
    now = time.time()
    if _roles_cache["roles"] and _roles_cache["expire"] > now:
        return list(_roles_cache["roles"])  # type: ignore[arg-type]

    try:
        token = _get_client_token()
        resp = requests.get(
            f"{s.casdoor_endpoint.rstrip('/')}/api/get-roles",
            params={"owner": s.casdoor_org, "p": 1, "pageSize": 100},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "ok":
            logger.warning("[casdoor] 列角色失败: {}", data.get("msg"))
            return []
        roles = [
            {
                "name": r.get("name"),
                "displayName": r.get("displayName") or r.get("name"),
            }
            for r in (data.get("data") or [])
        ]
        _roles_cache["roles"] = roles
        _roles_cache["expire"] = now + ROLES_CACHE_TTL
        logger.info("[casdoor] 列出 {} 个角色", len(roles))
        return roles
    except Exception as e:
        logger.warning("[casdoor] 列角色异常: {}", e)
        return []
