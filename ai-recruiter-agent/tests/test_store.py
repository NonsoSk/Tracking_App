import boto3
import pytest
from moto import mock_aws

from recruiter_agent.schemas import Recommendation, ScreeningResult
from recruiter_agent.store import DynamoDBStore, InMemoryStore


def _result() -> ScreeningResult:
    return ScreeningResult(
        score=82.5,
        recommendation=Recommendation.ADVANCE,
        requires_human_review=False,
        review_reasons=[],
        requirements=[],
        assessments=[],
        interview_questions=["Tell me about your last project."],
        engine="heuristic",
        prompt_version="test",
        latency_ms=3,
    )


@pytest.fixture
def dynamodb(monkeypatch):
    for key, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_DEFAULT_REGION": "us-east-1",
    }.items():
        monkeypatch.setenv(key, value)
    with mock_aws():
        resource = boto3.resource("dynamodb", region_name="us-east-1")
        resource.create_table(
            TableName="screenings",
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield resource


def test_dynamodb_round_trip(dynamodb):
    store = DynamoDBStore("screenings", "us-east-1", client=dynamodb)
    result = _result()
    store.save(result)
    assert store.get(result.id) == result
    assert store.get("missing") is None


def test_in_memory_round_trip():
    store = InMemoryStore()
    result = _result()
    store.save(result)
    assert store.get(result.id) is result
