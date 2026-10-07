from lab.core import AuthContext, EchoLLM, MemoryStore


def chat(ctx: AuthContext, req: dict, memory: MemoryStore, llm: EchoLLM) -> str:
    conv = memory.load(req["conversation_id"])
    if conv and conv.owner_user_id != ctx.user_id:
        conv = None
    history = "\n".join(conv.messages) if conv else ""
    return llm.complete(f"History:\n{history}\n\nUser: {req['message']}")
