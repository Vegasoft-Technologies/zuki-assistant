# Replace the intermediate Vapi LLM with deterministic server routing

Base: `sude/vapi-lookup-every-turn` (PR #9).

Vapi split combined questions into multiple lookups and removed the pound sign
before speech. Add `/api/vapi/chat/completions` to send each factual caller turn
unchanged to the existing knowledge-safe service once, then return OpenAI SSE or
JSON with spoken prices or a `transferCall` tool call. Route greetings, reservation
offers and human requests deterministically. Preserve `/api/lookup`, the knowledge
service, transcription, voice and the configured transfer tool.

Validation: `npm test` and `npm run typecheck` pass. Tests cover routing, full-turn
lookup, price conversion, transfer fallback, silent turns, text parts and HTTP
contracts. Provisioning tests use fake HTTP; no live provisioning was run.

Out of scope / known limits:
- Clarification replies still reach lookup without context, as before.
- The `transferCall` argument shape and post-transfer request require a live call
  for confirmation.
- Deploy order: merge → Railway redeploy (new route) → `npm run vapi:provision` →
  web test → phone test. Deploy the backend before provisioning.

No push, live provisioning or Railway changes were performed.
