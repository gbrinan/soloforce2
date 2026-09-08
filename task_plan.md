# Meeting Memory integration

1. Completed: standalone service sources and existing meeting processing integration, excluding private data/secrets.
2. Completed: owner-authenticated Markdown/ontology routes, API provider selection and installation documentation.
3. Completed: build, 18 service tests, HTTP surface QA and diff inspection. Evidence: progress.md.
4. Completed: published implementation commit 61ea87d on origin/codex/meeting-memory-integration. Main and runtime deployment remain unchanged.

Private recordings and keys remain outside Git. Existing meeting data is preserved. See docs/meeting-memory.md for installation and operational limitations.

## Operating deployment

1. Completed: identified Ubuntu soloforce2.service, release updater, canonical key file and existing local Gmail overlays.
2. In progress: fast-forward GitHub main and prepare sidecar runtime using existing keys.
3. Pending: run release updater, restart services and verify live HTTP processing.
