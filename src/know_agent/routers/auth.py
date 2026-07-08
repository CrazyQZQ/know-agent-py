"""Authentication routes for login, logout, and current-user checks."""

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
    """Fetch user profile from Casdoor."""
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
        logger.warning("[auth] failed to fetch Casdoor userinfo: {}", e)
    return {}


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    """Login by proxying Casdoor's password grant."""
    s = get_settings()
    if not s.casdoor_enabled:
        raise HTTPException(500, "Casdoor is not enabled; login is unavailable")

    missing = []
    if not s.casdoor_endpoint:
        missing.append("CASDOOR_ENDPOINT")
    if not s.casdoor_client_id:
        missing.append("CASDOOR_CLIENT_ID")
    if not s.casdoor_client_secret:
        missing.append("CASDOOR_CLIENT_SECRET")
    if missing:
        raise HTTPException(
            500,
            f"Casdoor OAuth client config missing: {', '.join(missing)}",
        )

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
        raise HTTPException(502, f"Casdoor is unreachable: {e}")

    if resp.status_code != 200:
        try:
            err_data = resp.json()
        except ValueError:
            err_data = {"error": resp.text}
        upstream_error = (
            err_data.get("error_description")
            or err_data.get("error")
            or resp.text
        )
        logger.warning(
            "[auth] Casdoor password grant failed: status={} error={}",
            resp.status_code,
            upstream_error,
        )
        raise HTTPException(401, f"Casdoor login failed: {upstream_error}")

    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise HTTPException(
            401, f"Casdoor login failed: {data.get('error_description', data)}"
        )
    info = _fetch_userinfo(token)
    roles = info.get(s.casdoor_roles_field) or []
    logger.info(
        "[auth] user logged in: {} roles={}",
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
    """Best-effort token revoke plus local cache cleanup."""
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
        logger.debug("[auth] ignoring Casdoor revoke error: {}", e)
    _token_cache.pop(token, None)
    revoke_token(token)
    logger.info("[auth] user logged out")
    return {"ok": True}


@router.get("/me", dependencies=[Depends(verify_auth)])
def me() -> dict:
    """Return the current authenticated user and roles."""
    return {
        "user": get_current_user(),
        "roles": get_current_roles(),
    }
