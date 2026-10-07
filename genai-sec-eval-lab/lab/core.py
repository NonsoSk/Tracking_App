"""Shared runtime for the cases: identity, retrieval, memory, tools, and a scripted model.

The scripted model makes every test deterministic and keyless. It follows two
worst-case assumptions used throughout the lab:

1. Anything that reaches the model's context can be repeated to the user
   (EchoLLM), so data in the prompt counts as disclosed.
2. The model can be steered by injected text (ScriptedLLM), so any tool call it
   is able to emit, it will emit. Controls must live in code, not in the prompt.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass(frozen=True)
class AuthContext:
    """Identity established by the auth layer (e.g. a verified OAuth token)."""

    user_id: str
    tenant_id: str
    email: str

    @property
    def email_domain(self) -> str:
        return self.email.split("@", 1)[1]


@dataclass(frozen=True)
class Document:
    doc_id: str
    tenant_id: str
    text: str


class Index:
    """Keyword retriever standing in for a vector store with a metadata filter."""

    def __init__(self, docs: list[Document]):
        self.docs = list(docs)

    def search(self, query: str, tenant_id: str, k: int = 3) -> list[Document]:
        terms = set(query.lower().split())
        scoped = [d for d in self.docs if d.tenant_id == tenant_id]
        hits = [d for d in scoped if terms & set(d.text.lower().split())]
        return hits[:k]


@dataclass
class Conversation:
    owner_user_id: str
    messages: list[str] = field(default_factory=list)


class MemoryStore:
    """Conversation memory keyed by conversation id."""

    def __init__(self):
        self._convs: dict[str, Conversation] = {}

    def save(self, conversation_id: str, owner_user_id: str, message: str) -> None:
        conv = self._convs.setdefault(conversation_id, Conversation(owner_user_id))
        conv.messages.append(message)

    def load(self, conversation_id: str) -> Conversation | None:
        return self._convs.get(conversation_id)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


class Mailer:
    """Records outbound mail instead of sending it."""

    def __init__(self):
        self.outbox: list[Email] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.outbox.append(Email(to=to, subject=subject, body=body))


class EchoLLM:
    """Worst-case model for disclosure: answers by repeating its context."""

    def complete(self, prompt: str) -> str:
        return prompt


class ScriptedLLM:
    """Replays fixed responses in Anthropic Messages tool-use block format."""

    def __init__(self, responses: list[dict]):
        self._responses = list(responses)

    def next(self, messages: list[dict]) -> dict:
        return self._responses.pop(0)


ToolFn = Callable[..., str]


def run_agent(llm: ScriptedLLM, tools: dict[str, ToolFn], ctx: AuthContext,
              user_message: str, max_steps: int = 5) -> str:
    """Minimal tool-use loop: execute tool_use blocks until the model returns text."""
    messages: list[dict] = [{"role": "user", "content": user_message}]
    for _ in range(max_steps):
        block = llm.next(messages)
        if block["type"] == "text":
            return block["text"]
        result = tools[block["name"]](ctx, **block["input"])
        messages.append({"role": "assistant", "content": [block]})
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": block["id"], "content": result}]})
    return "max steps reached"
