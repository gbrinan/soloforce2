# Verification evidence — 2026-09-09

- npm run build: PASS. Server and client TypeScript checks plus Vite production build. Existing large chunk warning remains; no frontend code changed. First 60-second shell timeout was rerun successfully with a longer command allowance.
- npm run test:meeting-memory: PASS. Actual local HTTP upload, explicit Gemini provider, persisted remote job ID, Markdown/ontology files, authorized reads, unauthorized 403 and quota error without fallback. Provider responses in this test are fixtures.
- services/meeting-memory: bun run check PASS; bun test PASS (18 tests, 51 assertions); bun run build PASS. Added authenticated combined-result route covered by real HTTP assertions.
- bun src/manual-qa.ts: PASS. Real local HTTP source ingestion, meeting submission, SQLite pipeline, Markdown and ontology reads, human-review transition and database reopen. Summary generation is explicitly synthetic in this QA script.
- Private recording and API credentials excluded from repository changes. No external Groq/Gemini request was made in this repository integration pass.
- Operational prerequisites: service process, matching service token and valid provider keys. Groq live credential validation remains unresolved from the earlier standalone test. Drive/GAS deployment and full live provider flow are not claimed complete.
