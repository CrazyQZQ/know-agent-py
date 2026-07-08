from fastapi.testclient import TestClient

from know_agent.configuration import get_settings
from know_agent.main import create_app


def test_login_reports_missing_casdoor_oauth_client(monkeypatch):
    monkeypatch.setenv("CASDOOR_ENABLED", "true")
    monkeypatch.setenv("CASDOOR_ENDPOINT", "http://casdoor.example")
    monkeypatch.setenv("CASDOOR_CLIENT_ID", "")
    monkeypatch.setenv("CASDOOR_CLIENT_SECRET", "")
    get_settings.cache_clear()

    client = TestClient(create_app())
    response = client.post(
        "/api/auth/login",
        json={"username": "lxqq", "password": "secret"},
    )

    assert response.status_code == 500
    assert "CASDOOR_CLIENT_ID" in response.json()["detail"]
    assert "CASDOOR_CLIENT_SECRET" in response.json()["detail"]
