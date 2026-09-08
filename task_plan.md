# Meeting Memory integration

1. Completed: standalone service sources and existing meeting processing integration, excluding private data/secrets.
2. Completed: owner-authenticated Markdown/ontology routes, API provider selection and installation documentation.
3. Completed: build, 18 service tests, HTTP surface QA and diff inspection. Evidence: progress.md.
4. Completed: published implementation commit 61ea87d on origin/codex/meeting-memory-integration. Main and runtime deployment remain unchanged.

Private recordings and keys remain outside Git. Existing meeting data is preserved. See docs/meeting-memory.md for installation and operational limitations.

## Operating deployment

1. Completed: identified Ubuntu soloforce2.service, release updater, canonical key file and existing local Gmail overlays.
2. Completed: fast-forwarded main to 1c345e8; canonical Groq/Gemini keys both returned HTTP 200. Installed sidecar and updated release hooks.
3. Resolved by the repair below: initial live summary failed three attempts (invalid_action_evidence, unknown_owner, unknown_owner); the existing recording is now recovered.

## Repeated summary failure repair
1. Completed: captured real candidate; reproduced 5 unsupported owners and 2 unmatched quotations.
2. Completed: content grounding plus visible review issues; 25 tests/80 assertions and resume-without-upload HTTP check pass.
3. Completed: deployed d545e22; recovered the existing failed recording with unchanged 271-segment transcript. Live Markdown, ontology and HTML passed; 4 actions plus 2 review issues stored as an unreviewed draft. See progress.md.
