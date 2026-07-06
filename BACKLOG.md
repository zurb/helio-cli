# helio-cli — Capability Backlog

Known ceilings on what the CLI can do for test creation, classified by where the gap actually lives. Created 2026-07-06 as Item 9 of the test-creation improvement plan (see the Helio marketplace's state-of-test-creation docs).

**Classification method:** checked against the Helio Public API surface as documented in `mcps/helio-mcp/API_SPECIFICATION.md` and the endpoints the CLI already calls. "API gap" = the public API has no endpoint for this, so no CLI work can close it alone. "CLI gap" = the API supports it (or plausibly does) and the CLI just doesn't wrap it. Each API gap carries a product question for whoever owns the Public API.

Until items here are resolved, the user-facing disclosure lives in the marketplace: `helio-creating-test`'s UI-only boundary checklist and the "What the CLI can't do" section of the Helio CLI v1.3 doc.

---

## 1. Asset upload + asset listing

**Status:** API gap (no `/api/public/assets` endpoints in the spec).
**Today:** questions accept `--asset-id` / `--site-link`, but asset IDs must be fetched from the web app by hand — there isn't even a list call to find them.
**Smallest useful step:** a read-only `GET /api/public/assets` (id, name, type, thumbnail) would unlock `helio-cli assets list` and make `--asset-id` practical without touching upload. Upload can come later.
**Product question:** is an assets read endpoint on the Public API roadmap? Is upload deliberately excluded (abuse/size concerns)?

## 2. Click test / tree test / prototype task creation

**Status:** API gap (`POST /tests` marks these types non-creatable).
**Today:** the three usability section types — arguably Helio's signature sections — can't be created programmatically at all. Reports for them are fully readable.
**Dependency:** requires #1 (assets/hotspots) at minimum; prototype tasks also need Figma linkage.
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
