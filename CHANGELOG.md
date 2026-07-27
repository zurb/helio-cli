# Changelog

## 0.4.0 (unreleased)

Requires the helio API changes merged in [helio #4995](https://github.com/zurb/helio/pull/4995)
for the audience, click-test, and branching features; older servers ignore the
new params and 404 the new routes.

### Added
- `helio` bin alias alongside `helio-cli`.
- `tests clone <id>` — new draft in the same project; copies questions, UX
  metrics, branching, and the last audience. The scripted route to branched
  tests beyond what `--branching` covers.
- `audiences list --name <partial> --recent` with richer columns
  (`participants_count`, `tests_count`, `last_used_at`); `audiences clone <id>`.
- `click_test` is creatable: requires an image `--asset-id`, optional
  `--hotspots <json|@file>` (`[{name?, x, y, width, height, priority?}]`,
  relative 0–1 coordinates). Omit hotspots for an engagement heatmap, include
  them for a success click test.
- Branching on single-select `multiple_choice` via `branching` in payloads or
  `--branching <json|@file>`: `skip_to_question` (forward-only, 1-based
  question numbers or `section_id`) and `end_test` (optional
  `message`/`redirect_url` for custom disqualification). Requires a Helio
  Enterprise account; mutually exclusive with follow-ups. Client-side
  validation mirrors the API.
- `assets list/get/upload --account-id <id>`, for tokens with access to more
  than one account, so the asset lands in the account whose test will use it
  (assets are account-scoped).

### Fixed
- Server error messages surface in text mode: `HelioApiError` now reads the
  `{error: ...}` body Helio actually returns (previously only `{message: ...}`,
  so failures printed a bare `HTTP 400`).
- Legacy followup attrs (`enable_followup`, `followup_question`,
  `followup_required`, `choice_required_followup`) copied from GET responses
  are rejected client-side with the correct `followup: {...}` shape instead of
  being silently dropped server-side.
- `tests preview` no longer labels the first question "Q0". The report
  serializer passes `section.position` through raw and platform storage is
  0-based, so questions are now numbered by sorted order.
- `tests order --output json` reports 1-based `position` values matching the
  `--position` flag, instead of leaking raw 0-based storage positions into
  scripted input.

### Changed
- Mutation responses' `position` field is now a 1-based question number
  (matching the `--position` flag), so it round-trips safely. Raw `tests get`
  section positions remain 0-based platform storage.
- `--dry-run` catches more branching errors before they reach the API:
  backward and self-targeting skips, skips past the last question, and
  `section_id` on create (the API takes question numbers only there, since
  sections do not exist yet). On `add-question`/`edit-question` the forward-only
  check applies only when `--position` makes the question's number knowable.
- `--dry-run` warns when a payload uses branching, since the Helio Enterprise
  requirement cannot be checked client-side and otherwise surfaces only as a
  400 on create.
- `remove-ux-metrics` warns when the test had branching: removing sections
  silently resets any branch targeting them.
