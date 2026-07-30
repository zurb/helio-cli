# Changelog

## 0.7.0

### Breaking
- **`tests ux-metric-types --output json` changed shape.** It used to print the
  metric table at the top level (`{"sentiment": {...}, "loyalty": {...}}`); it
  now prints `{"metrics": {...}, "excluded": {...}}`. The nesting is what makes
  room for `excluded`, which carries the per-type reason a metric can't be
  created — the thing an agent needs in order to pick a different one rather
  than retry. Scripts reading the old shape need `.metrics` added to the path:
  `helio-cli tests ux-metric-types --output json | jq '.metrics'`.

  Every other JSON change in this release is additive: `tests order` gains
  `reorderable` (plus `ambiguous_metric_types` and `blocks[].ambiguous` when
  relevant), `tests preview` gains `audience` / `branching` / `hotspots`,
  `walkthrough` screens gain `branching` / `hotspots`, and `tests create` /
  `add-ux-metrics` gain `warnings` when a metric would score zero.

### Added
- **Five UX metric types are now creatable**, matching the 2026-07-30 Public API
  release ([helio#5006](https://github.com/zurb/helio/pull/5006)). `engagement`,
  `success`, `usability` and `satisfaction` build click sections and became
  creatable once `click_test` did; `brand_score` never needed click tests at
  all. Only `completion` and `effort` remain excluded, and the CLI now names the
  actual reason per type (a Figma prototype section the API can't create)
  instead of a blanket "requires click tests or prototypes".
- **Per-section overrides `hotspots`, `choices` and `brand_choice`** on the UX
  metric object form (`--ux-metrics-json` / `--metrics-json`), and
  `--hotspots` / `--brand-choice` on `edit-question` for metric sections.
  `hotspots` takes the same shape and validation as a `click_test` question;
  `brand_choice` is a 0-based index marking which choice is your brand.
- **`create` and `add-ux-metrics` warn when a metric will score zero** — a
  click-backed metric whose click sections have no hotspots, or a `brand_score`
  with no brand marked. Warnings rather than errors: the API accepts both, and
  you can fill the gap in with `edit-question` before sending. `tests validate`
  is the gate that refuses.
- **Read-back of audience, branching and hotspots.** `preview` shows the
  audience configuration, per-question branching in the vocabulary writes take,
  and click-test hotspots; `--output json` adds `audience`, `branching` and
  `hotspots` blocks, and `walkthrough` screens carry `branching` and `hotspots`.
  A click section with no hotspots is called out, since on a hotspot-scored
  metric that means it scores zero.
  - Two question-numbering systems meet here and are kept apart deliberately.
    Everything the CLI prints numbers sections in position order **including**
    UX metric sections; a branch's `question` counts researcher questions
    **only**. Rather than replicate that counting, branch targets are resolved
    through the branch's `section_id`, so `skip to Q3` always names the Q the
    CLI just printed. In JSON, `from_question_number` / `target_question_number`
    (and `target_q_number` on walkthrough screens) are CLI-listing numbers,
    while the API's own `question` is passed through untouched.
- Hotspot geometry now rejects a rectangle that hangs off the image
  (`x + width` or `y + height` above 1), matching the API. Applies to
  `click_test` questions and to metric section overrides, which share one
  validator.

### Changed
- **A UX metric type may now appear on a test more than once.** The duplicate
  check is gone: every instance owns its own sections and is scored
  independently, which is what a multi-screen flow measuring `expectations` on
  each screen needs. Consequences:
  - `tests order` emits one block per metric **instance** rather than
    collapsing a type into one block, so a repeated type no longer reports the
    wrong question count.
  - `reorder` identifies a repeated type by `metric:<uuid>`. `tests order`
    flags those blocks and withholds the paste-ready command, because
    `GET /tests/:id` does not expose metric uuids — see *Known gap* below.
  - `remove-ux-metrics --metrics` accepts a metric id as well as a type: a type
    removes every instance, an id removes the one it names.

### Known gap
- **`tests order` cannot produce a working `reorder` command for a repeated
  metric type.** `reorder` needs `metric:<uuid>` to tell instances apart, but
  `GET /tests/:id` returns only the metric's numeric `id` (via the section's
  `ux_metric` block) and no `ux_metrics` summary — the uuids appear solely in
  the response to the `create`/`add-ux-metrics` call that created them. A client
  that builds a test in one process and reorders it in another has no way to
  discover them. `order` says so rather than printing a command that 400s.
  Raised on [helio#5006](https://github.com/zurb/helio/pull/5006); the fix is
  API-side (expose the uuid on read, or accept `metric:<numeric id>`).

### Documentation
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
  - The bare list of metric names is now a list of what each metric already
    asks, at the point where you pick them — all sixteen, including the five
    that became creatable in this same release. A short "metric territory" list
    would have read as exhaustive and sent anyone whose question wasn't on it
    straight back to hand-writing. "Genuinely custom" is defined positively
    instead: your own domain, or a type no metric emits (`ranking`, `matrix`,
    `card_sort`, `point_allocation`, `max_diff`).
  - Added empirical starting stacks (first look → `comprehension desirability
    intent engagement`; findability → `success sentiment`; flow iteration →
    `expectations success sentiment`), marking which members need an image and
    hotspots and which are still web-app only.
  - Corrected why the excluded metrics are excluded: they are rejected by the
    Public API, not only client-side, and the reason is per type. With this
    release only `completion` and `effort` remain, both built from a Figma
    prototype section the API cannot create.
  - JSON guide gains `metrics_first`, `ux_metrics.why_metrics_first`,
    `ux_metrics.covers`, `ux_metrics.custom_question_territory`,
    `ux_metrics.repeated_types`, `ux_metrics.section_overrides`,
    `ux_metrics.scores_zero_without_overrides`, `ux_metrics.starting_stacks`,
    and `commands.tests.create.recommended_shape`.

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
