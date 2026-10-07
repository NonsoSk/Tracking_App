# genai-sec-eval-lab

A small benchmark for checking how well static analysis catches **Sensitive Information Disclosure** (OWASP LLM02) and **Excessive Agency** (OWASP LLM06) in LLM agent and RAG code.

Each case is a runnable Python app in three versions:

- **vulnerable**: has a real, code-reachable flaw.
- **fixed**: the smallest change that closes it.
- **negative**: a hard negative. It looks like the vulnerable version to a scanner but is safe.

Each case has an annotation (asset, actor, authorization context, source → path → sink, root cause, severity, residual risk). Deterministic tests prove each verdict, and two Semgrep rule sets are scored against the labels.

## Cases

| ID | Surface | Flaw | Hard negative |
|---|---|---|---|
| [SID-01](cases/sid01_rag_cross_tenant/ANNOTATION.md) | RAG retrieval | Tenant filter taken from the request body | Request tenant is used, but only after an equality check against the token |
| [SID-02](cases/sid02_memory_cross_user/ANNOTATION.md) | Agent memory | Any conversation loadable by id (IDOR) | Same unchecked load, but on a per-user store |
| [EA-01](cases/ea01_email_exfil/ANNOTATION.md) | Tool calling | Injected tool call emails confidential data externally | Tool sends without approval, but only to the authenticated user |

## Test model

Tests run offline with no API keys and give the same result every run. The model is replaced by two worst-case stand-ins:

- `EchoLLM` repeats its whole context. Anything that reaches the prompt counts as disclosed.
- `ScriptedLLM` replays tool calls in Anthropic Messages `tool_use` format. It plays a model that a prompt injection has already taken over, so a pass means the code stopped the action, not that the model behaved.

Every case has two kinds of test:

- The security test must flag the vulnerable version and clear the fixed and negative versions.
- A functional test confirms the fix still allows legitimate use.

## Run

```bash
pip install -r requirements.txt
pytest -q                          # 19 behavioral tests
python scripts/score_semgrep.py    # rule-set scoring table
```

## Semgrep results

| Rule set | Case | vulnerable | fixed | negative |
|---|---|---|---|---|
| naive | ea01_email_exfil | TP | FP | TN |
| naive | sid01_rag_cross_tenant | TP | TN | FP |
| naive | sid02_memory_cross_user | TP | FP | FP |
| refined | ea01_email_exfil | TP | TN | TN |
| refined | sid01_rag_cross_tenant | TP | TN | TN |
| refined | sid02_memory_cross_user | TP | TN | FP |

| Rule set | TP | FP | FN | TN | Precision | Recall |
|---|---|---|---|---|---|---|
| naive | 3 | 4 | 0 | 2 | 43% | 100% |
| refined | 3 | 1 | 0 | 5 | 75% | 100% |

**What this shows:**

- **Plain taint over-reports authorization fixes.** [`naive.yml`](semgrep/naive.yml) cannot treat an equality guard, a post-load owner check, or an approval gate as a sanitizer. It flags 4 of 6 safe variants.
- **Control-aware rules recover most of the gap.** [`refined.yml`](semgrep/refined.yml) adds `pattern-not-inside` exclusions for the controls in the fixed versions. Precision rises from 43% to 75% with no loss of recall.
- **One false positive is out of reach for this rule shape.** SID-02's negative is safe because of which store the call runs on (`stores[ctx.user_id]`), not because of the call itself. Clearing it means modeling the store's key as an authorization boundary. A more specific exclusion would only fit this sample.
- **The refined rules are tuned on these 9 samples.** Treat 75% as an upper bound until the rules are tested on unseen variants.

## Layout

```
lab/core.py              auth context, retriever, memory, mailer, scripted models, agent loop
cases/<id>/              vulnerable.py, fixed.py, negative.py, ANNOTATION.md
tests/                   one test module per case
semgrep/                 naive.yml, refined.yml
scripts/score_semgrep.py scores each rule set against labels
```

Built with Claude Code.
