"""Evidence retrieval over a resume.

The resume is split into passages (one bullet or sentence each) and indexed with
BM25. It is a LangChain ``BaseRetriever``, so it can be swapped for a vector
store retriever (for example Bedrock Titan embeddings) without touching the graph.
BM25 is the default because resumes are short, keyword-dense and the index costs
nothing to build.
"""

from __future__ import annotations

import re

from langchain_core.callbacks import CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import PrivateAttr
from rank_bm25 import BM25Okapi

_TOKEN = re.compile(r"[a-z0-9][a-z0-9+#/.\-]*")
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have in is it of on or our the to with you your "
    "we will this that experience years year strong excellent".split()
)


def tokenize(text: str) -> list[str]:
    tokens = (t.strip(".-/") for t in _TOKEN.findall(text.lower()))
    return [t for t in tokens if t and t not in _STOPWORDS]


def split_passages(text: str, max_chars: int = 300) -> list[str]:
    """Split a resume into short, quotable passages."""
    passages: list[str] = []
    for raw in text.splitlines():
        line = raw.strip().lstrip("-*• ").strip()
        if len(line) < 3:
            continue
        if len(line) <= max_chars:
            passages.append(line)
            continue
        passages.extend(s.strip() for s in re.split(r"(?<=[.;])\s+", line) if s.strip())
    return passages


class BM25EvidenceRetriever(BaseRetriever):
    passages: list[str]
    k: int = 4
    _index: BM25Okapi | None = PrivateAttr(default=None)

    def model_post_init(self, __context: object) -> None:
        corpus = [tokenize(p) or ["_"] for p in self.passages]
        self._index = BM25Okapi(corpus) if corpus else None

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> list[Document]:
        if self._index is None:
            return []
        scores = self._index.get_scores(tokenize(query))
        ranked = sorted(range(len(self.passages)), key=lambda i: scores[i], reverse=True)
        return [
            Document(page_content=self.passages[i], metadata={"passage": i, "score": scores[i]})
            for i in ranked[: self.k]
            if scores[i] > 0
        ]
