"""
Thin wrapper around the Claude API.

All AI features are optional: when no ``ANTHROPIC_API_KEY`` is configured (or
a call fails) callers get ``None`` and fall back to the built-in rule-based
logic, so the portal keeps working offline.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from django.conf import settings

logger = logging.getLogger(__name__)

SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"


def ai_enabled() -> bool:
    return bool(settings.AI_ENABLED and settings.ANTHROPIC_API_KEY)


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=180.0, max_retries=2)


def pdf_block(data: bytes) -> dict:
    return {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": base64.standard_b64encode(data).decode()},
    }


def image_block(data: bytes, media_type: str) -> dict:
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()},
    }


def structured_request(
    *,
    system: str,
    content: list[dict] | str,
    schema: dict,
    max_tokens: int = 8000,
    effort: str = "low",
) -> dict[str, Any] | None:
    """Ask Claude for JSON that matches ``schema``. Returns ``None`` on any failure."""
    if not ai_enabled():
        return None

    import anthropic

    kwargs: dict[str, Any] = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    }
    if settings.AI_SERVER_FALLBACK:
        kwargs["betas"] = [SERVER_FALLBACK_BETA]
        kwargs["fallbacks"] = "default"

    try:
        response = _client().beta.messages.create(**kwargs)
    except anthropic.AuthenticationError:
        logger.error("Claude API key rejected; check ANTHROPIC_API_KEY.")
        return None
    except anthropic.BadRequestError as exc:
        logger.error("Claude rejected the request: %s", exc.message)
        return None
    except anthropic.RateLimitError:
        logger.warning("Claude rate limit reached; falling back to rule-based processing.")
        return None
    except anthropic.APIStatusError as exc:
        logger.warning("Claude API error %s: %s", exc.status_code, exc.message)
        return None
    except anthropic.APIConnectionError:
        logger.warning("Could not reach the Claude API; falling back to rule-based processing.")
        return None

    if response.stop_reason == "refusal":
        logger.warning("Claude declined the request (request id %s).", response._request_id)
        return None
    if response.stop_reason == "max_tokens":
        logger.warning("Claude response was cut off at max_tokens (request id %s).", response._request_id)
        return None

    text = next((block.text for block in response.content if block.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Claude returned invalid JSON (request id %s).", response._request_id)
        return None


def text_request(*, system: str, prompt: str, max_tokens: int = 4000, effort: str = "low") -> str | None:
    """Plain-text completion (used for job adverts and fit summaries)."""
    if not ai_enabled():
        return None

    import anthropic

    kwargs: dict[str, Any] = {
        "model": settings.ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
        "output_config": {"effort": effort},
    }
    if settings.AI_SERVER_FALLBACK:
        kwargs["betas"] = [SERVER_FALLBACK_BETA]
        kwargs["fallbacks"] = "default"
    try:
        response = _client().beta.messages.create(**kwargs)
    except anthropic.APIStatusError as exc:
        logger.warning("Claude API error %s: %s", exc.status_code, exc.message)
        return None
    except anthropic.APIConnectionError:
        logger.warning("Could not reach the Claude API.")
        return None
    if response.stop_reason == "refusal":
        return None
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return text or None
