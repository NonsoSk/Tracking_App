# Design notes

Short records of the decisions that shaped this project, written so a reviewer
can disagree with a specific choice rather than the whole design.

## 1. The model judges evidence; code makes the decision

**Decision.** The LLM only answers "is this requirement met, and where does the
resume say so?". A deterministic rule in `scoring.py` turns verdicts into a score
(must-haves weigh 2, nice-to-haves 1) and a recommendation (a missing must-have
caps the outcome at *hold*; two cap it at *reject*).

**Why.** Hiring outcomes have to be explainable to candidates, recruiters and
auditors. A rule can be read, unit-tested and tuned by changing a threshold rather
than a prompt. Asking a model for an overall score directly gives numbers that
drift between model versions and cannot be explained.

**Cost.** The rule cannot weigh context ("no Kubernetes, but ran ECS at scale").
That nuance has to come through partial verdicts.

## 2. Citations are verified in code, not trusted

**Decision.** Assessment prompts require verbatim quotes. `verify_citations`
checks each quote against the redacted resume (case, whitespace, quote marks and
elisions are normalised). A *met* verdict whose quote is not found becomes
*partial*, and the screening is flagged for review.

**Why.** Invented experience is the most damaging failure for a screener, and it
is cheap to detect without another model call. The `citation_validity` metric in
the evals tracks how often a model tries it.

## 3. BM25 retrieval, behind a LangChain retriever interface

**Decision.** Resumes are split into bullet- or sentence-sized passages and ranked
with BM25. Queries are expanded with synonyms from a skill taxonomy ("LangChain,
LangGraph or LlamaIndex" also searches "llama index", "langchain.js").

**Why.** A resume is about 30 passages of keyword-dense text. Exact skill names
matter more than semantic similarity, and BM25 has no embedding cost, no index to
host and no cold start on Lambda. Because the retriever is a `BaseRetriever`,
swapping in Bedrock Titan embeddings with a vector store is a one-line change if
evals show it helps (for example on resumes that describe skills without naming
them).

## 4. Parse with `PydanticOutputParser` rather than native structured output

**Decision.** Every chain is `prompt | model | PydanticOutputParser` with
`.with_retry(stop_after_attempt=2)`.

**Why.** It behaves the same on small local models (no tool calling needed) and on
Bedrock, and it lets the test suite drive the whole graph with a scripted fake
model. With a single provider in production, switching to
`with_structured_output` would be reasonable.

## 5. Degrade per requirement, never per request

**Decision.** Assessments run concurrently with `Runnable.batch(...,
return_exceptions=True)`. A requirement whose output still fails after the retry
falls back to the heuristic analyzer, and the screening is flagged. If requirement
extraction fails, the heuristic parser reads the job description instead.

**Why.** A single bad generation should cost one verdict's quality, not the
recruiter's request. The flag makes sure a person sees it.

## 6. A no-model baseline is a first-class engine

**Decision.** `HeuristicAnalyzer` implements the same interface as the LLM
analyzer and is the default engine.

**Why.** It is the bar any model has to beat in the evals, the fallback above, and
a zero-cost mode for demos and CI. Without a baseline you cannot tell whether a
prompt change helped.

## 7. Redact before the model, and treat resumes as untrusted input

**Decision.** Contact details and labelled protected attributes are removed in the
first graph node. Prompts fence resume text as data and tell the model to ignore
instructions inside it. A regex detector flags injection attempts.

**Why.** The model cannot be influenced by what it never sees, which is a stronger
guarantee than an instruction to ignore it. Injection detection is a flag rather
than a block, because a false positive should not silently drop a candidate.

## 8. Serverless on AWS, defaulting to the free tier

**Decision.** One FastAPI app runs locally, in Docker, and on Lambda through
Mangum, behind an HTTP API, with results in DynamoDB. The SAM template defaults to
the heuristic engine and uses provisioned 5/5 capacity on the table.

**Why.** Screening traffic is bursty and low volume per customer, which suits
Lambda. Every resource stays inside the always-free or 12-month free tier until
Bedrock is switched on. Results are stored as a JSON payload plus a few top-level
attributes, so the schema can evolve without migrations.

## 9. Prompts are versioned and stored with results

`PROMPT_VERSION` is saved with every screening, next to the engine and model id.
When a recruiter questions an outcome, you can tell which prompts and model
produced it, and the evals can be re-run on that exact configuration.
