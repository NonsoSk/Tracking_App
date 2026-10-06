from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from recruiter_agent.config import Settings

DATA = Path(__file__).resolve().parents[1] / "evals" / "data"


class ScriptedChatModel(BaseChatModel):
    """A fake chat model that answers by task, so batch order does not matter.

    ``handlers`` maps the task name in a prompt's ``# Task:`` header to a function
    that receives the full prompt text and returns the raw model output.
    Every prompt is recorded in ``prompts`` for assertions.
    """

    handlers: dict[str, Callable[[str], str]]
    prompts: list[str] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs):
        text = "\n".join(str(m.content) for m in messages)
        self.prompts.append(text)
        task = next(t for t in self.handlers if f"# Task: {t}" in text)
        content = self.handlers[task](text)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=content))])


def as_json(obj: dict) -> str:
    return json.dumps(obj)


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, engine="heuristic", store="memory", api_key=None)


@pytest.fixture
def ai_job() -> str:
    return (DATA / "jobs" / "ai_engineer.md").read_text()


@pytest.fixture
def analyst_job() -> str:
    return (DATA / "jobs" / "data_analyst.md").read_text()


@pytest.fixture
def resume():
    return lambda cid: (DATA / "resumes" / f"{cid}.md").read_text()
