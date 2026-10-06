from fastapi.testclient import TestClient

from recruiter_agent.api import create_app


def _client(settings) -> TestClient:
    return TestClient(create_app(settings))


def test_health(settings):
    response = _client(settings).get("/health")
    assert response.status_code == 200
    assert response.json()["engine"] == "heuristic"


def test_create_and_fetch_screening(settings, ai_job, resume):
    client = _client(settings)
    created = client.post(
        "/v1/screenings",
        json={"job_description": ai_job, "resume": resume("c01"), "candidate_id": "c01"},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["recommendation"] == "advance"
    assert body["candidate_id"] == "c01"
    assert all(a["evidence"] for a in body["assessments"] if a["verdict"] == "met")

    fetched = client.get(f"/v1/screenings/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == body


def test_unknown_screening_is_404(settings):
    assert _client(settings).get("/v1/screenings/nope").status_code == 404


def test_validation_rejects_tiny_inputs(settings):
    response = _client(settings).post(
        "/v1/screenings", json={"job_description": "short", "resume": "short"}
    )
    assert response.status_code == 422


def test_api_key_is_enforced_when_configured(settings, ai_job, resume):
    client = _client(settings.model_copy(update={"api_key": "s3cret"}))
    payload = {"job_description": ai_job, "resume": resume("c02")}
    assert client.post("/v1/screenings", json=payload).status_code == 401
    assert (
        client.post("/v1/screenings", json=payload, headers={"X-API-Key": "wrong"}).status_code
        == 401
    )
    ok = client.post("/v1/screenings", json=payload, headers={"X-API-Key": "s3cret"})
    assert ok.status_code == 201
    assert client.get("/health").status_code == 200  # health stays public
