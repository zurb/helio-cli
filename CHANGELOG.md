# Changelog

## Unreleased

### Changed
- `guide` and the README now teach metrics-first. Previously both opened with a
  hand-written `{"type": "NPS", "instructions": "How likely are you to recommend
  us?"}` — which *is* the `loyalty` metric, built by hand and therefore scoring
  nothing — and introduced `--ux-metrics` last, as an optional additive. A tagged
  metric auto-builds its sections with validated, non-leading wording and returns
  a 0–100 score with a threshold label that is comparable across waves and feeds
  the Overall Score; its hand-written lookalike returns only an answer
  distribution. The guide ships with the binary, so it was quietly teaching the
  anti-pattern to every agent that runs `guide --output json` as onboarding.
  ([#21](https://github.com/zurb/helio-cli/issues/21))
  - `recommended_workflow` gains `helio-cli tests ux-metric-types` as step 3,
    before `create`.
  - §3's first `create` example leads with `--ux-metrics sentiment loyalty
    --ux-metric-context "the signup flow"` and keeps only a genuinely custom
    free-response question. The hand-written NPS is gone.
  - The UX-metrics block moved above the `add-question` examples, which are now
    framed as "for what the metrics don't cover". The `likert` example no
    longer restates usefulness/satisfaction.
  - The bare list of metric names is now an eleven-line list of what each metric
    already asks, at the point where you pick them. A short "metric territory"
    list would have read as exhaustive and sent anyone whose question wasn't on
    it straight back to hand-writing. "Genuinely custom" is defined positively
    instead: your own domain, or a type no metric emits (`ranking`, `matrix`,
    `card_sort`, `point_allocation`, `max_diff`).
  - Added empirical starting stacks (first look → `comprehension desirability
    intent`; findability → `success sentiment effort`; flow iteration →
    `expectations success sentiment`), flagging which members are web-app only.
  - Corrected why the seven excluded metrics are excluded. They are rejected by
    the Public API, not only client-side. `engagement`/`success`/`usability`
    build click-test sections, `completion`/`effort` build Figma-prototype
    directives, `satisfaction` is click test + Likert — but `brand_score` is
    none of those; it is a fixed brand composite whose scoring depends on
    choice flags the create path cannot set.
  - JSON guide gains `metrics_first`, `ux_metrics.why_metrics_first`,
    `ux_metrics.covers`, `ux_metrics.custom_question_territory`,
    `ux_metrics.starting_stacks`, and `commands.tests.create.recommended_shape`.

## 0.6.0

### Fixed
- The "update available" notice is no longer suppressed by `--output json` or by
  a non-TTY stderr. Those two conditions describe every scripted and agent-driven
  session, so the callers least able to notice a stale binary were the only ones
  guaranteed never to be told — and they went on reporting their own version's
  capability ceiling as a permanent limit of the tool. The notice has always gone
  to stderr only, so `--output json` on stdout stays parseable either way. Only
  `HELIO_NO_UPDATE_CHECK` and `CI` suppress it now. ([#18](https://github.com/zurb/helio-cli/issues/18))

### Changed
- **Minor rather than patch.** stdout is untouched, so `--output json | jq .`
  is unaffected — but a pipeline that folds stderr into stdout first, such as
  `helio-cli tests list --output json 2>&1 | jq .`, can now receive the notice
  and fail to parse. Read stdout on its own, or set `HELIO_NO_UPDATE_CHECK=1`.
- The update notice omits ANSI color codes when stderr is not a TTY, and names
  `HELIO_NO_UPDATE_CHECK=1` as the way to silence it.
- `HELIO_NO_UPDATE_CHECK` accepts any truthy value rather than the literal `1`
  only (`0`, `false`, and empty still mean "keep checking"), matching how `CI` is
  already read. It is now the only way to opt out, so it should not be
  fussy about spelling.

## 0.5.0

### Fixed
- Sections whose `type` the API returns as `null` no longer render as
  `[undefined]` in `tests order`, `tests preview`, `tests walkthrough`, and
  participant journeys. They now read `[unknown type]`, so degraded upstream
  data is not mistaken for a CLI bug. Any test containing a `click_test`
  currently comes back this way from `GET /tests/:id`.

### Changed
- **Breaking (`--output json`):** `tests order` replaces the `blocks[].position`
  field with two fields, because one number could not honestly serve both
  purposes:
  - `block_index` — 1-based position in the `--order` list.
  - `question_number` — 1-based number of the first question the block covers,
    matching `--position` and branching `question` targets.
  - `question_count` — how many questions the block covers (>1 only for
    multi-question metric blocks).

  These diverge whenever a UX metric block spans more than one question. The
  previous `position` field was the block index but was documented as matching
  `--position`; that was wrong. Text output annotates only the blocks where the
  two numberings actually part ways — `(Q3–Q4)` for a spanning metric, `(Q5)`
  for a block whose question number has drifted from its index.
- `add-question` no longer prints the API's `position` field in text mode when
  appending. On the append path the API returns a screen-based number
  (question number + 1, counting the intro card) that does not round-trip into
  `--position`. `--output json` remains a faithful passthrough. Tracked
  upstream against the helio API.

### Known upstream issues
- A single `click_test` section blanks `type`, `variations`, and `ux_metric`
  for **every** section of a test in `GET /api/public/tests/:id`. `tests
  preview` is unaffected (it reads `/report`). This supersedes the earlier
  belief that UI-built or completed tests return degraded data — the predictor
  is the click test, not the authoring surface.
- `add_question` append returns a screen-based `position`, and
  `--position = count + 1` clamps instead of appending, so "insert at the end"
  is not expressible via an explicit position. Interior inserts are exact.

## 0.4.0

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
- `tests order --output json` no longer leaks raw 0-based storage positions
  into scripted input.

### Changed
- Raw `tests get` section positions remain 0-based platform storage.
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
