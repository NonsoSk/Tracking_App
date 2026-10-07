# SID-02 · Cross-user conversation memory

**Category:** OWASP LLM02 Sensitive Information Disclosure · **Severity:** High (Medium if conversation ids are unguessable)

| Field | Value |
|---|---|
| Asset | Another user's chat history (here, Bob's SSN) |
| Actor | Authenticated user who knows or guesses a conversation id |
| Authorization context | A user may load only conversations where `owner_user_id == ctx.user_id`. |
| Trust boundary | Request body (`conversation_id`) → memory store → prompt |
| Source | `req["conversation_id"]` |
| Path | `memory.load(id)` → `conv.messages` → `history` → prompt → model output |
| Sink | Model response returned to the requester |
| Missing control | Object-level ownership check on the loaded conversation (IDOR) |
| Root cause | Memory keyed by a global id with no owner binding at read time |

## Variants

| Variant | Change | Verdict |
|---|---|---|
| `vulnerable.py` | `memory.load(req["conversation_id"])`, used directly | Finding: Alice reads Bob's SSN |
| `fixed.py` | Drops the conversation if `conv.owner_user_id != ctx.user_id` | Not a finding |
| `negative.py` | Same unchecked `load(req["conversation_id"])`, but on `stores[ctx.user_id]`, a per-user namespace | Not a finding: the id can only select among Alice's own conversations |

**Why the negative is hard:** the line matching the vulnerable pattern is byte-for-byte the same. The safety comes from which store the call runs on, which is set by the authenticated identity one line earlier. Both rule sets flag it.

## Residual risk (fixed)

- The owner check lives in the caller. A second endpoint that calls `memory.load` can repeat the bug. Move the check into the store (`load(owner, id)`).
- The fixed variant returns empty history for both "not yours" and "does not exist", so it does not confirm whether an id exists.
