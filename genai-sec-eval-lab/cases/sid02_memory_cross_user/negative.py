from lab.core import AuthContext, EchoLLM, MemoryStore


def chat(ctx: AuthContext, req: dict, stores: dict[str, MemoryStore], llm: EchoLLM) -> str:
    memory = stores.setdefault(ctx.user_id, MemoryStore())
    conv = memory.load(req["conversation_id"])
    history = "\n".join(conv.messages) if conv else ""
    return llm.complete(f"History:\n{history}\n\nUser: {req['message']}")
