from fastapi.testclient import TestClient

from custodian.main import app


def test_health_reports_ok() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
