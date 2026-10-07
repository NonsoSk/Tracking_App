import importlib

import pytest

from lab.core import AuthContext, Document, EchoLLM, Index

VARIANTS = {"vulnerable": True, "fixed": False, "negative": False}  # variant -> leaks?

ALICE = AuthContext(user_id="alice", tenant_id="acme", email="alice@acme.test")
INDEX = Index([
    Document("acme-1", "acme", "acme salary bands: engineer L3 95k"),
    Document("globex-1", "globex", "globex salary bands: SECRET-GLOBEX-L3-140k"),
])


def load(variant):
    return importlib.import_module(f"cases.sid01_rag_cross_tenant.{variant}")


def ask(variant, tenant_id):
    req = {"tenant_id": tenant_id, "question": "what are the salary bands"}
    try:
        return load(variant).answer(ALICE, req, INDEX, EchoLLM())
    except PermissionError:
        return ""


@pytest.mark.parametrize("variant,leaks", VARIANTS.items())
def test_cross_tenant_request_leaks_only_in_vulnerable(variant, leaks):
    assert ("SECRET-GLOBEX" in ask(variant, "globex")) is leaks


@pytest.mark.parametrize("variant", VARIANTS)
def test_own_tenant_request_still_answers(variant):
    assert "engineer L3 95k" in ask(variant, "acme")
