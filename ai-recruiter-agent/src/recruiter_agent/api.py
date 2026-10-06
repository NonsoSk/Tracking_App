"""FastAPI service.

Run locally with ``uvicorn recruiter_agent.api:app --reload``; on AWS Lambda the
same app is wrapped by Mangum in ``lambda_handler.py``.
"""

from __future__ import annotations

import logging
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, status

from . import __version__
from .analyzers import build_analyzer
from .config import Settings, get_settings
from .graph import ScreeningAgent
from .schemas import ScreeningRequest, ScreeningResult
from .store import ScreeningStore, build_store

log = logging.getLogger("recruiter_agent")


def create_app(
    settings: Settings | None = None,
    agent: ScreeningAgent | None = None,
    store: ScreeningStore | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    agent = agent or ScreeningAgent(build_analyzer(settings), settings)
    store = store or build_store(settings)

    app = FastAPI(
        title="AI Recruiter Agent",
        version=__version__,
        description="Evidence-grounded candidate screening. Recommendations are advisory; "
        "a person makes the hiring decision.",
    )

    def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
        if settings.api_key and not (
            x_api_key and secrets.compare_digest(x_api_key, settings.api_key)
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing API key")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__, "engine": agent.analyzer.name}

    @app.post(
        "/v1/screenings",
        response_model=ScreeningResult,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(require_api_key)],
    )
    def create_screening(request: ScreeningRequest) -> ScreeningResult:
        result = agent.screen(request)
        store.save(result)
        # Log ids and outcomes only, never resume content.
        log.info(
            "screening id=%s engine=%s recommendation=%s score=%s review=%s latency_ms=%s",
            result.id,
            result.engine,
            result.recommendation.value,
            result.score,
            result.requires_human_review,
            result.latency_ms,
        )
        return result

    @app.get(
        "/v1/screenings/{screening_id}",
        response_model=ScreeningResult,
        dependencies=[Depends(require_api_key)],
    )
    def get_screening(screening_id: str) -> ScreeningResult:
        result = store.get(screening_id)
        if result is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Screening not found")
        return result

    return app


app = create_app()
