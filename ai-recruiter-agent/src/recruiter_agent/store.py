"""Persistence for screening results.

Hiring decisions need an audit trail, so every screening is stored with its
evidence, engine, model and prompt version. DynamoDB is used on AWS (the table
fits in the always-free tier); an in-memory store is used locally and in tests.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Protocol

from .config import Settings
from .schemas import ScreeningResult


class ScreeningStore(Protocol):
    def save(self, result: ScreeningResult) -> None: ...

    def get(self, screening_id: str) -> ScreeningResult | None: ...


class InMemoryStore:
    def __init__(self) -> None:
        self._items: dict[str, ScreeningResult] = {}

    def save(self, result: ScreeningResult) -> None:
        self._items[result.id] = result

    def get(self, screening_id: str) -> ScreeningResult | None:
        return self._items.get(screening_id)


class DynamoDBStore:
    def __init__(self, table_name: str, region: str, client=None) -> None:
        if client is None:
            import boto3

            client = boto3.resource("dynamodb", region_name=region)
        self._table = client.Table(table_name)

    def save(self, result: ScreeningResult) -> None:
        self._table.put_item(
            Item={
                "id": result.id,
                "created_at": result.created_at.isoformat(),
                "candidate_id": result.candidate_id or "",
                "recommendation": result.recommendation.value,
                "score": Decimal(str(result.score)),
                "requires_human_review": result.requires_human_review,
                "payload": result.model_dump_json(),
            }
        )

    def get(self, screening_id: str) -> ScreeningResult | None:
        item = self._table.get_item(Key={"id": screening_id}).get("Item")
        return ScreeningResult.model_validate_json(item["payload"]) if item else None


def build_store(settings: Settings) -> ScreeningStore:
    if settings.store == "dynamodb":
        return DynamoDBStore(settings.dynamodb_table, settings.aws_region)
    return InMemoryStore()
