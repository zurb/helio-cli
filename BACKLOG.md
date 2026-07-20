# helio-cli — Capability Backlog

Known ceilings on what the CLI can do for test creation, classified by where the gap actually lives. Created 2026-07-06 as Item 9 of the test-creation improvement plan (see the Helio marketplace's state-of-test-creation docs).

**Classification method:** checked against the Helio Public API surface as documented in `mcps/helio-mcp/API_SPECIFICATION.md` and the endpoints the CLI already calls. "API gap" = the public API has no endpoint for this, so no CLI work can close it alone. "CLI gap" = the API supports it (or plausibly does) and the CLI just doesn't wrap it. Each API gap carries a product question for whoever owns the Public API.

Until items here are resolved, the user-facing disclosure lives in the marketplace: `helio-creating-test`'s UI-only boundary checklist and the "What the CLI can't do" section of the Helio CLI v1.3 doc.

---

## 1. Asset upload + asset listing — RESOLVED (2026-07-19)

**Status:** closed. The Public API added `GET /assets`, `GET /assets/:id`, and `POST /assets` (multipart image upload: jpg/jpeg/png/gif, 10MB cap), and the CLI now wraps all three as `assets list | get | upload`, with `HelioClient#postMultipart` for the upload path.
**Remaining scope:** upload is images-only (video/audio are listable but not uploadable), and uploads return `status: "processing"` with no webhook — poll `assets get <id>` until `complete`. Asset ids are numeric, unlike test/project uuids.

## 2. Click test / tree test / prototype task creation

**Status:** API gap (`POST /tests` marks these types non-creatable).
**Today:** the three usability section types — arguably Helio's signature sections — can't be created programmatically at all. Reports for them are fully readable.
**Dependency:** #1 (assets) is now resolved, so click tests have their asset half; the remaining blocker is hotspot creation (and Figma linkage for prototype tasks).
**Product question:** is creation UI-only *by design* (hotspot drawing is inherently visual), or is a "create with asset_id + hotspot coordinates" API plausible? If by design, we document it as permanent and stop tracking.

## 3. Branching / skip logic / conditional follow-ups

**Status:** API gap (no branch endpoints; branches configure at the choice level in the UI).
**Today:** any test with routing must be finished in the web app after the CLI builds the sections.
**Product question:** same by-design-or-backlog question as #2. Branch rules are structured data (choice → action → target), so an API is technically plausible.

## 4. Audience segment creation / screeners

**Status:** API gap (the CLI can list audiences and attach IDs via `--audiences`; no create endpoints).
**Today:** segment and screener setup is UI-side; the CLI attaches existing IDs.
**Product question:** is programmatic segment creation wanted at all? (Screeners interact with panel economics — may be deliberately gated.)

## 5. Scheduled launch

**Status:** API gap (`send_test` fires immediately).
**Today:** cron around `helio-cli tests send` is the workaround, and honestly a decent one.
**Priority:** low. Document the cron pattern instead unless demand appears.

## 6. Reorder/metrics parity note (informational)

`tests reorder`, `add-ux-metrics`, `remove-ux-metrics` exist in the CLI as separate commands; the MCP bundles them into `update_test`, and the MCP additionally supports `ux_metric_assets` (per-metric asset attachment) on create. **CLI gap:** `--ux-metric-assets` support in `tests create` would restore parity with the MCP. Small, purely CLI-side.

## 7. Tests (engineering, not capability)

**Status:** CLI gap — tracked as Item 7 of the improvement plan.
Zero test coverage on ~370 lines of validation logic and ~1,100 lines of walkthrough rendering. Plan: vitest; phase 1 extracts validation into `src/lib/validate.ts` with table-driven cases per question type; phase 2 snapshot-tests `walkthrough --output json`; phase 3 mocks the client and asserts endpoints per command.

---

## Routing

- API gaps (#1–#5) → questions for the Public API owner; revisit this file when answers land. "Won't do — by design" is a fine resolution; it just needs to be written down so the marketplace docs can say "by design" instead of "not yet."
- CLI gaps (#6, #7) → normal repo work, PR-sized.
