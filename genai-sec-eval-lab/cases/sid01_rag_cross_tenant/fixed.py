from lab.core import AuthContext, EchoLLM, Index


def answer(ctx: AuthContext, req: dict, index: Index, llm: EchoLLM) -> str:
    tenant_id = ctx.tenant_id
    docs = index.search(req["question"], tenant_id=tenant_id)
    context = "\n".join(d.text for d in docs)
    return llm.complete(f"Context:\n{context}\n\nQuestion: {req['question']}")
