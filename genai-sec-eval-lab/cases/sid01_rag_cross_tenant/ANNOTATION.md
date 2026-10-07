# SID-01 · Cross-tenant retrieval via client-supplied tenant_id

**Category:** OWASP LLM02 Sensitive Information Disclosure · **Severity:** High

| Field | Value |
|---|---|
| Asset | Other tenants' documents in the shared index (salary bands) |
| Actor | Any authenticated user of any tenant |
| Authorization context | `ctx.tenant_id` from the verified token is the only trusted tenant. The user may read their own tenant's documents, for their own questions, returned to themselves. |
| Trust boundary | HTTP request body (untrusted) → retrieval filter (trusted scope) |
| Source | `req["tenant_id"]` |
| Path | `tenant_id` → `index.search(tenant_id=...)` → `context` → prompt → model output |
| Sink | Model response returned to the user (the model can repeat anything in its context) |
| Missing control | Tenant scope taken from the authenticated identity, or checked against it |
| Root cause | Authorization data trusted from the client instead of the auth layer |

## Variants

| Variant | Change | Verdict |
|---|---|---|
| `vulnerable.py` | `tenant_id = req["tenant_id"]` | Finding: Alice receives Globex's salary data |
| `fixed.py` | `tenant_id = ctx.tenant_id` | Not a finding |
| `negative.py` | Reads `req["tenant_id"]`, then `raise PermissionError` unless it equals `ctx.tenant_id` | Not a finding: the reachable data is identical to `fixed.py` |

**Why the negative is hard:** the tainted value still reaches the sink unchanged. Taint analysis has no notion of an equality guard as a sanitizer, so the naive rule flags it.

## Residual risk (fixed)

- Isolation depends entirely on correct `tenant_id` metadata at ingestion; a mislabeled document leaks.
- The filter is applied per call site. Enforce it inside the retriever (tenant-bound retriever instance) so a new endpoint cannot skip it.
