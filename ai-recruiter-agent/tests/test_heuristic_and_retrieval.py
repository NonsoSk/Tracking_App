from recruiter_agent.analyzers import HeuristicAnalyzer
from recruiter_agent.retrieval import BM25EvidenceRetriever, split_passages
from recruiter_agent.schemas import Priority, Verdict
from recruiter_agent.skills import expand_query


def test_extracts_only_qualification_sections(ai_job):
    reqs = HeuristicAnalyzer().extract_requirements(ai_job)
    assert [r.priority for r in reqs] == [Priority.MUST] * 5 + [Priority.NICE] * 3
    texts = " ".join(r.text for r in reqs)
    assert "Remote-first" not in texts  # benefits are ignored
    assert "Build and improve agent capabilities" not in texts  # responsibilities too
    assert reqs[4].keywords == ["cloud"]  # "AWS, GCP or Azure" is one concept


def test_retriever_finds_synonyms_through_query_expansion(resume):
    passages = split_passages(resume("c10"))
    retriever = BM25EvidenceRetriever(passages=passages, k=2)
    query = expand_query("Hands-on experience with LangChain, LangGraph or LlamaIndex.", [])
    docs = retriever.invoke(query)
    assert "LlamaIndex" in docs[0].page_content


def test_alternatives_satisfy_requirement(ai_job, resume):
    analyzer = HeuristicAnalyzer()
    cloud = analyzer.extract_requirements(ai_job)[4]
    passages = split_passages(resume("c10"))  # GCP, not AWS
    assert analyzer.assess(cloud, passages).verdict is Verdict.MET


def test_empty_resume_has_no_evidence():
    assert BM25EvidenceRetriever(passages=[]).invoke("python") == []
