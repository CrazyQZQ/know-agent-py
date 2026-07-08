"""认证路由 — 登录/注销/当前用户（后端代理 Casdoor）.

- POST /api/auth/login  用户名密码登录（代理 Casdoor password grant，返回 token + 用户信息）
- POST /api/auth/logout 注销（调 Casdoor revoke + 清后端 token 缓存）
- GET  /api/auth/me     当前用户信息（受认证保护，前端验证 token 有效性用）

login/logout 公开访问；me 需带 Casdoor Bearer token。
"""

import requests
from fastapi import APIRouter, Depends, Header, HTTPException
from loguru import logger
from pydantic import BaseModel

from know_agent.configuration import get_settings
from know_agent.core.request_context import get_current_roles, get_current_user
from know_agent.core.security import _token_cache, revoke_token, verify_auth

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int | None = None
    user: dict


def _fetch_userinfo(token: str) -> dict:
    """调 Casdoor /api/userinfo 获取用户信息."""
    s = get_settings()
    try:
        r = requests.get(
            f"{s.casdoor_endpoint.rstrip('/')}{s.casdoor_userinfo_path}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.warning("[auth] 获取 userinfo 失败: {}", e)
    return {}


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    """用户名密码登录（后端代理 Casdoor password grant）."""
    s = get_settings()
    if not s.casdoor_enabled:
        raise HTTPException(500, "Casdoor 未启用，无法登录")
    try:
        resp = requests.post(
            f"{s.casdoor_endpoint.rstrip('/')}/api/login/oauth/access_token",
            data={
                "grant_type": "password",
                "client_id": s.casdoor_client_id,
                "client_secret": s.casdoor_client_secret,
                "username": req.username,
                "password": req.password,
                "scope": "openid profile email",
            },
            timeout=15,
        )
    except Exception as e:
        raise HTTPException(502, f"Casdoor 不可达: {e}")
    if resp.status_code != 200:
        raise HTTPException(401, "用户名或密码错误")
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise HTTPException(
            401, f"Casdoor 登录失败: {data.get('error_description', data)}"
        )
    info = _fetch_userinfo(token)
    roles = info.get(s.casdoor_roles_field) or []
    logger.info(
        "[auth] 用户登录: {} roles={}",
        info.get("preferred_username") or info.get("sub"),
        roles,
    )
    return LoginResponse(
        access_token=token,
        token_type=data.get("token_type", "Bearer"),
        expires_in=data.get("expires_in"),
        user={
            "name": info.get("name") or info.get("preferred_username"),
            "sub": info.get("sub"),
            "roles": roles,
            "email": info.get("email"),
        },
    )


@router.post("/logout")
def logout(authorization: str | None = Header(default=None)) -> dict:
    """注销：调 Casdoor revoke（best effort）+ 清后端 token 缓存.

    JWT 无状态，revoke 可能不立即生效；真正失效主要靠前端清除 token。
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"ok": True}
    token = authorization[7:].strip()
    s = get_settings()
    try:
        requests.post(
            f"{s.casdoor_endpoint.rstrip('/')}/api/login/oauth/revoke",
            data={
                "token": token,
                "client_id": s.casdoor_client_id,
                "client_secret": s.casdoor_client_secret,
            },
            timeout=5,
        )
    except Exception as e:
        logger.debug("[auth] Casdoor revoke 异常（忽略）: {}", e)
    # 清后端 token 验证缓存，避免登出用户继续用缓存
    _token_cache.pop(token, None)
    # 加入注销黑名单，让 token 立即失效（JWT 无状态，需后端维护黑名单）
    revoke_token(token)
    logger.info("[auth] 用户注销")
    return {"ok": True}


@router.get("/me", dependencies=[Depends(verify_auth)])
def me() -> dict:
    """获取当前登录用户信息（验证 token 有效性 + 返回角色）."""
    return {
        "user": get_current_user(),
        "roles": get_current_roles(),
    }
