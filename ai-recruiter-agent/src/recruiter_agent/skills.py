"""A small skills taxonomy.

Each concept maps to the phrases that count as evidence for it. Alternatives in a
job description ("AWS, GCP or Azure") collapse into one concept, so a candidate
with any of them satisfies it. The taxonomy drives the heuristic baseline and
expands retrieval queries for both engines.
"""

from __future__ import annotations

import re
from functools import cache

SKILL_CONCEPTS: dict[str, tuple[str, ...]] = {
    "python": ("python", "pandas", "numpy"),
    "llm": (
        "llm",
        "llms",
        "large language model",
        "large language models",
        "gpt",
        "openai",
        "anthropic",
        "claude",
        "bedrock",
        "gemini",
        "ai apis",
        "prompt engineering",
    ),
    "agent_framework": ("langchain", "langgraph", "llamaindex", "llama index", "langchain.js"),
    "web_api": ("fastapi", "flask", "django", "rest api", "rest apis", "restful"),
    "cloud": (
        "aws",
        "amazon web services",
        "lambda",
        "sagemaker",
        "ec2",
        "ecs",
        "s3",
        "gcp",
        "google cloud",
        "cloud run",
        "azure",
    ),
    "rag": (
        "rag",
        "retrieval-augmented",
        "retrieval augmented",
        "vector database",
        "vector store",
        "pgvector",
        "pinecone",
        "faiss",
        "chroma",
        "embeddings",
    ),
    "llm_evaluation": ("evals", "evaluation", "llm-as-judge", "llm-as-a-judge", "ragas"),
    "devops": ("docker", "kubernetes", "ci/cd", "github actions", "terraform"),
    "sql": ("sql", "postgres", "postgresql", "mysql"),
    "bi_tool": ("tableau", "looker", "power bi", "powerbi"),
    "experimentation": (
        "a/b test",
        "a/b tests",
        "a/b testing",
        "ab testing",
        "experiment",
        "experiments",
        "experimentation",
    ),
    "data_modeling": ("dbt", "data modeling", "data modelling", "dimensional model"),
    "warehouse": ("snowflake", "bigquery", "redshift", "databricks"),
    "communication": (
        "stakeholder",
        "stakeholders",
        "presented",
        "presenting",
        "communication",
        "communicated",
        "storytelling",
    ),
    "machine_learning": ("machine learning", "scikit-learn", "pytorch", "tensorflow", "xgboost"),
}


@cache
def _pattern(alias: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])")


def concepts_in(text: str) -> list[str]:
    """Return the concepts mentioned in ``text``, in taxonomy order."""
    lowered = text.lower()
    return [
        concept
        for concept, aliases in SKILL_CONCEPTS.items()
        if any(_pattern(a).search(lowered) for a in aliases)
    ]


def mentions(text: str, concept: str) -> bool:
    lowered = text.lower()
    aliases = SKILL_CONCEPTS.get(concept, (concept,))
    return any(_pattern(a).search(lowered) for a in aliases)


def expand_query(text: str, keywords: list[str]) -> str:
    """Append every alias of the matched concepts so BM25 can find synonyms."""
    concepts = set(concepts_in(text)) | {k for k in keywords if k in SKILL_CONCEPTS}
    extra = [alias for c in sorted(concepts) for alias in SKILL_CONCEPTS[c]]
    return " ".join([text, *keywords, *extra])
