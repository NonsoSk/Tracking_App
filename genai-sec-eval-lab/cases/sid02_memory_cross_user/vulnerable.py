from lab.core import AuthContext, EchoLLM, MemoryStore


def chat(ctx: AuthContext, req: dict, memory: MemoryStore, llm: EchoLLM) -> str:
    conv = memory.load(req["conversation_id"])
    history = "\n".join(conv.messages) if conv else ""
    return llm.complete(f"History:\n{history}\n\nUser: {req['message']}")
