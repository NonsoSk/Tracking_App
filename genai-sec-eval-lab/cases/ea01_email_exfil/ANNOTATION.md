# EA-01 · Email tool exfiltrates data after indirect prompt injection

**Category:** OWASP LLM06 Excessive Agency (enables LLM02) · **Severity:** High

| Field | Value |
|---|---|
| Asset | Confidential content in the agent's context (board memo) |
| Actor | External attacker who can place text in a document the agent reads |
| Authorization context | Alice may email colleagues in her own domain. Sending outside `acme.test` requires her explicit approval. The model is not a principal and cannot grant approval. |
| Trust boundary | Retrieved document (untrusted) → model → tool arguments → mail system |
| Source | Model-chosen `to` argument of the `send_email` tool call |
| Path | Injected instruction → `tool_use` block → `send_email(to=...)` → `mailer.send` |
| Sink | Outbound email to an attacker-controlled address |
| Missing control | Recipient restriction plus human approval for external recipients |
| Root cause | Tool granted more authority (any recipient, no approval) than the task needs |

Tests assume the injection succeeds: the scripted model always emits the attacker's tool call. The question is only whether the code stops it.

## Variants

| Variant | Change | Verdict |
|---|---|---|
| `vulnerable.py` | `mailer.send(to=to, ...)` with no check | Finding: memo sent to `drop@attacker.test` |
| `fixed.py` | Denies external domains unless `approve(...)` returns True (default deny) | Not a finding |
| `negative.py` | Tool has no `to` parameter; always sends to `ctx.email` | Not a finding: the model controls only subject and body, and the user is already entitled to that data |

**Why the negative is hard:** model-controlled data still flows into `mailer.send` with no approval step. That is excessive agency only if the recipient is outside the user's entitlement, and here it never is.

## Residual risk (fixed)

- Internal exfiltration remains: an injection can still mail the memo to any `acme.test` colleague. Add recipient purpose limits or per-message approval for sensitive content.
- `to.split("@")[-1]` is not an RFC 5322 parser. Parse addresses strictly with the same library the mail transport uses, to avoid parser-differential bypasses.
- Approval prompts must show the full recipient and body, or users will approve blindly.
