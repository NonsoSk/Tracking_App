# Notes for Claude

IEFCL recruitment portal (Django). See README.md for setup, features and configuration.

## Open items the owner asked to be reminded about

The owner is reviewing the app and making corrections first. They asked **not** to be walked through these now, but to
be reminded, with step-by-step guidance, **when each one becomes relevant**, e.g. when they talk about demoing to the
hiring team, enabling AI, going live, hosting, sign-in or interview scheduling. Raise only the item(s) that apply, and
remove an item from this list once it is done.

1. **AI not tested live.** Claude features were only tested with mocked responses. When they get an API key, guide them
   through adding `ANTHROPIC_API_KEY` to `.env` and testing a typed CV, a scanned PDF and a phone photo. Without a key,
   scanned CVs need Tesseract OCR installed (`TESSERACT_CMD` on Windows).
2. **Data-protection sign-off for AI.** With AI on, CV content is sent to Anthropic. They need approval from IEFCL's
   data-protection/IT/legal owner before enabling it. With no key, everything stays in-house.
3. **Retirement rule.** It currently assumes age 60 or 35 years of service, whichever comes first. They need to confirm
   IEFCL's policy and set `RETIREMENT_AGE` / `RETIREMENT_MAX_SERVICE_YEARS` in `.env`.
4. **Not built yet:** automatic Microsoft Teams meeting creation (Microsoft Graph) and Microsoft 365 sign-in (Entra ID).
   Today, HR pastes a Teams link or a free video room is created, and staff use portal usernames.
5. **Hosting.** IEFCL IT has to host it: Docker Compose (Postgres + web + scheduler), HTTPS, SMTP via Microsoft 365, the
   recruitment mailbox (IMAP) and the scheduled jobs. Guide them through README → Deployment and Scheduled jobs.
