# Verification evidence — 2026-09-09

- npm run build: PASS. Server and client TypeScript checks plus Vite production build. Existing large chunk warning remains; no frontend code changed. First 60-second shell timeout was rerun successfully with a longer command allowance.
- npm run test:meeting-memory: PASS. Actual local HTTP upload, explicit Gemini provider, persisted remote job ID, Markdown/ontology files, authorized reads, unauthorized 403 and quota error without fallback. Provider responses in this test are fixtures.
- services/meeting-memory: bun run check PASS; bun test PASS (18 tests, 51 assertions); bun run build PASS. Added authenticated combined-result route covered by real HTTP assertions.
- bun src/manual-qa.ts: PASS. Real local HTTP source ingestion, meeting submission, SQLite pipeline, Markdown and ontology reads, human-review transition and database reopen. Summary generation is explicitly synthetic in this QA script.
- Private recording and API credentials excluded from repository changes. No external Groq/Gemini request was made in this repository integration pass.
- Operational prerequisites: service process, matching service token and valid provider keys. Groq live credential validation remains unresolved from the earlier standalone test. Drive/GAS deployment and full live provider flow are not claimed complete.

- GitHub publication: implementation commit 61ea87d successfully pushed to codex/meeting-memory-integration. Main was not merged and no operating server was restarted.

## Operating deployment — 2026-09-09

- Main fast-forward merge and push: 1c345e896b76c44d8690259f3ecaf2eea69d64ad.
- Existing Ubuntu release updater preserved local Gmail overlays and completed npm build, meeting-memory 18 tests/51 assertions, adapter HTTP test, corpus tests, Google connection tests and Gmail tool regression.
- Soloforce2 and Meeting Memory systemd units are active and enabled; HTTP health checks pass. Canonical existing Groq and Gemini keys each returned HTTP 200; no keys copied into Git.
- Initial Bun launch path was corrected to the package-provided .bin/bun link. Original Downloads folder was unreadable from WSL; a private temporary copy enabled the authorized upload.
- Live recording upload accepted; Groq produced 271 segments ending at 1274.9199 seconds. Gemini summary was rejected by evidence/owner validation in all three attempts (invalid_action_evidence, unknown_owner, unknown_owner). No completed Markdown or ontology was falsely published. Transcription checkpoint remains for a later corrected retry.
- Operational health is verified, but full successful live generation is NOT verified. Automatic retries stopped at the configured cap. Requested human decision per workspace three-failure rule.

## Summary reliability repair

Captured real provider response reproduced failure deterministically: 6 proposed actions, 5 unsupported assignee labels, 2 quotations absent from every segment. Original validator failed; the grounded copy passed the unchanged validator with 4 evidenced actions, 3 unassigned owners, and 5 visible review issues. Four regression tests failed before the patch and passed after it. A resume regression failed with missing-recording ENOENT before the patch and passed afterward without uploading. No customer content or provider keys were placed in fixtures.

Final local verification before deployment: 25 tests/80 assertions PASS; server/client type checks and production build PASS; adapter resume HTTP test PASS. Only API-sized modules were added; no any/assertion escape hatches. Uncertain candidates remain explicit review data rather than asserted graph facts.

## Live repair acceptance — 2026-09-09 KST

- Main implementation d545e22c2c96933f471fdb0169707b61f29e147f deployed by the existing release updater; combined health passed and updater exited 0. Deployment checks included 25 service tests/80 assertions, bridge HTTP, corpus, Google readonly connection and Gmail regression checks.
- Retried the existing failed job using its persisted transcript, without audio re-upload or re-transcription. Actual Gemini response completed. Transcript hash unchanged across all 271 segments.
- Soloforce2 metadata resynchronized to ready with the same remote job ID and Groq engine; stale error cleared. Four grounded actions and two explicitly unverified proposals were preserved in their respective sections. The unchanged strict evidence validator passed all asserted data.
- Live Markdown: HTTP 200, 40,514 bytes, all four sections, collapsed transcript, unreviewed status. Ontology: HTTP 200, four Action entities and reviewed=false. HTML: HTTP 200 with visible review warning text. Private receipt is stored in the runtime state directory; no customer text or access token is committed.
- Remaining boundary: this verifies direct-upload processing and recovery. Google Drive/GAS installation and automatic folder detection are still separate infrastructure work. Provider outages/quota errors remain explicit errors; uncertain model content no longer fails the entire draft.

- Real headed Chromium QA PASS: warning text visible, four action items present, transcript initially collapsed and opens on click, no browser page errors. The bundled browser version was absent, so the installed Chromium executable was used. An initial text-length probe incorrectly counted only collapsed-page visible text; the corrected acceptance checks assert action count and actual transcript disclosure behavior.
- Cleanup: no production instrumentation was added. Temporary candidate JSON and local diagnostic journal are removed after verification; the runtime keeps only the normal meeting data and a private content-free verification receipt.
