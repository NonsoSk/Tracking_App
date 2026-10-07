import importlib

import pytest

from lab.core import AuthContext, EchoLLM, MemoryStore

VARIANTS = {"vulnerable": True, "fixed": False, "negative": False}  # variant -> leaks?

ALICE = AuthContext(user_id="alice", tenant_id="acme", email="alice@acme.test")
BOB_SECRET = "my SSN is 123-45-6789"


def setup_memory(variant):
    """Bob's conversation c-bob and Alice's conversation c-alice, in the variant's store layout."""
    if variant == "negative":
        stores = {"bob": MemoryStore(), "alice": MemoryStore()}
        stores["bob"].save("c-bob", "bob", BOB_SECRET)
        stores["alice"].save("c-alice", "alice", "my favourite colour is teal")
        return stores
    memory = MemoryStore()
    memory.save("c-bob", "bob", BOB_SECRET)
    memory.save("c-alice", "alice", "my favourite colour is teal")
    return memory


def chat(variant, conversation_id):
    module = importlib.import_module(f"cases.sid02_memory_cross_user.{variant}")
    req = {"conversation_id": conversation_id, "message": "summarise our chat"}
    return module.chat(ALICE, req, setup_memory(variant), EchoLLM())


@pytest.mark.parametrize("variant,leaks", VARIANTS.items())
def test_other_users_conversation_leaks_only_in_vulnerable(variant, leaks):
    assert (BOB_SECRET in chat(variant, "c-bob")) is leaks


@pytest.mark.parametrize("variant", VARIANTS)
def test_own_conversation_history_still_loads(variant):
    assert "teal" in chat(variant, "c-alice")
