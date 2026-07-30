# helio-cli

Command-line interface for the [Helio](https://helio.app) Public API. Create tests, pull reports, manage participants, and automate workflows from the terminal.

## Installation

```bash
# Run without installing
npx @zurb/helio-cli --help

# Or install globally
npm install -g @zurb/helio-cli
```

Requires Node.js >= 22.

## Updating

The CLI checks the npm registry for new versions at most once a day and prints a notice on **stderr** when one is available. Because the notice never touches stdout, it shows up in `--output json` and in piped or redirected output too — `--output json` stays parseable, and scripts and agents can still find out the tool has moved. ANSI colors are used only when stderr is a TTY. To update:

```bash
helio-cli update
```

`helio-cli update --check` reports whether a newer version exists without installing. If the CLI was installed with pnpm, Yarn, Volta, or run via npx, `update` prints the matching command instead of using npm. Set `HELIO_NO_UPDATE_CHECK=1` (any value other than `0`, `false`, or empty) to disable the background check entirely; it is also skipped when `CI` is set.

## Authentication

Get your API ID and Token from [my.helio.app/account/organization](https://my.helio.app/account/organization) (scroll to the API section).

```bash
# Interactive login
helio-cli auth login

# Or set credentials directly
helio-cli config set api-id YOUR_API_ID
helio-cli config set api-token YOUR_API_TOKEN

# Or use environment variables
export HELIO_API_ID=your_id
export HELIO_API_TOKEN=your_token

# Verify everything works
helio-cli doctor
```

Credential precedence (first wins):

1. CLI flags (`--api-id`, `--api-token`)
2. Environment variables (`HELIO_API_ID`, `HELIO_API_TOKEN`)
3. Config file (`~/.helio-cli/config.json`)

## Recommended workflow

```bash
helio-cli auth login                              # authenticate
helio-cli projects list --output json             # find your project
helio-cli tests ux-metric-types --output json     # pick metrics FIRST — they build validated, scored sections
helio-cli tests create --dry-run ...              # validate before creating
helio-cli tests create ...                        # create draft (--ux-metrics first, --questions for the rest)
helio-cli tests preview <id>                      # verify structure
helio-cli tests walkthrough <id>                  # see what a participant experiences, step by step
helio-cli tests send <id>                         # launch
helio-cli tests report <id> --output json         # get results
```

`helio-cli guide` prints this and the rest of the walkthrough from the binary itself; `helio-cli guide --output json` is the machine-readable version for agents.

## Commands

### Browsing

```bash
# Projects
helio-cli projects list
helio-cli projects list --name "UX Research"
helio-cli projects get <project-uuid>
helio-cli projects tests <project-uuid>

# Tests
helio-cli tests list
helio-cli tests list --status running
helio-cli tests list --status running complete --tags ux
helio-cli tests get <test-uuid>
```

### Creating Tests

**Pick your UX metrics first.** A tagged metric auto-builds its sections with validated, non-leading wording and returns a **0–100 score with a threshold label** — comparable across waves and rolled into the test's Overall Score. A question you hand-write to resemble a metric returns only an answer distribution and scores nothing. Use `--questions` for what no metric covers.

```bash
# See what's available before writing anything
helio-cli tests ux-metric-types
helio-cli tests ux-metric-types --type sentiment

# Create a test (saved as draft) — metrics first, custom questions for the rest
helio-cli tests create \
    --project-id <uuid> \
    --name "My Study" \
    --intro "Help us improve our product" \
    --target-audience-size 50 \
    --ux-metrics sentiment loyalty \
    --ux-metric-context "the signup flow" \
    --questions '[{"type":"free_response","instructions":"What would you improve?"}]'

# Validate without creating
helio-cli tests create --dry-run \
    --project-id <uuid> --name "Test" --intro "Hi" \
    --target-audience-size 50 --ux-metrics sentiment loyalty
```

No hand-written NPS in that example on purpose: `--ux-metrics loyalty` builds it, and unlike a typed-out NPS it scores.

**Starting stacks** — from the Helio test corpus, if you don't know which metrics to pick:

| Situation | Metrics | Note |
| --- | --- | --- |
| First look, one screen | `comprehension desirability intent engagement` | `engagement` needs an image + hotspots |
| Findability, any stage | `success sentiment` | `success` needs an image + hotspots; the corpus pairs this with `effort`, still web-app only |
| Iteration on a flow | `expectations success sentiment` | `success` needs an image + hotspots |

Only `completion` and `effort` are still web-app only — both are built from a Figma prototype section the API can't create. Everything else, including the click-backed metrics and `brand_score`, is CLI-creatable as of the 2026-07-30 API release. See [UX Metrics](#ux-metrics).

**The same metric type may appear more than once.** Each instance owns its own sections and is scored separately — what a multi-screen flow measuring `expectations` on every screen needs:

```bash
helio-cli tests create ... --ux-metrics expectations sentiment expectations
```

#### Custom questions — for what the metrics don't cover

That gap is narrower than it looks, and it narrowed further on 2026-07-30 when five more metrics became creatable. Read the whole [coverage list](#ux-metrics) before deciding a question is custom — the overlap is usually with a metric you skipped, not the one you checked. `completion` and `effort` are the only web-app-only metrics left; don't approximate those with a hand-written question either.

Genuinely custom means your own domain — pricing, features, workflow specifics, "how did you pay", "which plan fits you" — or a question type no metric emits: `ranking`, `matrix`, `card_sort`, `point_allocation`, `max_diff`.

```bash
# Add questions one at a time
helio-cli tests add-question <test-uuid> \
    --type multiple_choice \
    --instructions "How did you pay?" \
    --choices "Credit card" "PayPal" "Apple Pay"

helio-cli tests add-question <test-uuid> \
    --type likert --instructions "How important is same-day delivery to you?" \
    --scale-type importance

# Preview and launch
helio-cli tests preview <test-uuid>
helio-cli tests send <test-uuid>

# Walk through the test the way a participant sees it
helio-cli tests walkthrough <test-uuid>                 # one screen per page, all at once
helio-cli tests walkthrough <test-uuid> --interactive   # advance one screen at a time (TTY required)
helio-cli tests walkthrough <test-uuid> --output json   # structured screen list

# Read what real respondents actually answered, one journey at a time
helio-cli tests participants <test-uuid>                      # transcript per respondent
helio-cli tests participants <test-uuid> --group-by cohort    # cluster by cohort
helio-cli tests participants <test-uuid> --sentiment negative --output json
```

`preview` is a structural summary (every question on one page), and since the 2026-07-30 API release it also shows the test's **audience** configuration, per-question **branching**, and click-test **hotspots** — everything a scripted build writes is now readable back, so a pre-launch review can verify its own work. `--output json` emits those as `audience`, `branching` and `hotspots` blocks; `walkthrough` carries `branching` and `hotspots` on each screen. A click section with no hotspots is called out, since on a hotspot-scored metric that means it scores zero. `walkthrough` renders each participant screen separately — intro, then each question with its own input UI (radio buttons, text box, NPS row, etc.) — so you can comprehend the experience step by step. Asset-heavy types (prototypes, click tests, tree tests) render a placeholder pointing to the Helio browser preview.

`participants` is the report seen one respondent at a time: where `walkthrough` shows the empty test structure and `tests report` shows aggregates, `participants` stitches each person's answers together in order — the rating, the follow-up "why", and that answer's sentiment, plus demographics, audience type, and cohorts. It accepts the same demographic/segment/sentiment filters as `report`, supports `--group-by cohort|audience_type`, and emits flat `{ study, participants: [...] }` JSON for piping into `jq`. It's a convenience wrapper over `tests report --include participants`. Note: `cohorts` is empty for non-enroll recruits, and `sentiment` / prototype grade are eventually consistent — a `null` means "not computed yet" (shown as *pending*), never neutral.

### Assets

```bash
# Upload an image (jpg, jpeg, png, gif; max 10MB)
helio-cli assets upload ./homepage-mock.png

# Find asset ids to use with --asset-id
helio-cli assets list
helio-cli assets list --type image --name homepage

# Check processing status and get signed URLs
helio-cli assets get <asset-id>

# Attach an image as a question stimulus
helio-cli tests add-question <test-uuid> \
    --type free_response \
    --instructions "What stands out on this page?" \
    --asset-id <asset-id>
```

Uploads return immediately with `status: "processing"`; poll `assets get <asset-id>` until `status` is `complete` to get dimensions and URLs. Asset ids are numeric (unlike test/project uuids).

### Question Types

`free_response`, `multiple_choice`, `likert`, `nps`, `ranking`, `preference`, `matrix`, `card_sort`, `point_allocation`, `max_diff`

PascalCase variants also accepted (e.g., `FreeResponse`, `MultipleChoice`).

Likert scales: `agreement`, `occurrence`, `importance`, `quality`, `comprehension`, `impression`, `expectations`, `usefulness`, `difficulty`, `likelihood`, `custom`

### UX Metrics

Auto-generate standardized measurement questions. Each tagged metric produces a 0–100 score with a threshold label that is comparable across waves and feeds the test's Overall Score — which is why they come first, before any hand-written question (see [Creating Tests](#creating-tests)).

```bash
# Add metrics during test creation
helio-cli tests create \
    --project-id <uuid> \
    --name "UX Study" \
    --intro "Help us evaluate the experience" \
    --target-audience-size 50 \
    --ux-metrics sentiment loyalty \
    --questions '[{"type": "free_response", "instructions": "What did you think?"}]'

# Customize metric wording
helio-cli tests create ... \
    --ux-metrics sentiment loyalty \
    --ux-metric-context "the Helio dashboard"

# Metrics-only test (no custom questions)
helio-cli tests create \
    --project-id <uuid> \
    --name "Quick Pulse" \
    --intro "Quick feedback" \
    --target-audience-size 50 \
    --ux-metrics sentiment appeal usefulness

# Object form: per-metric context and per-section overrides (instructions, assets, follow-ups)
helio-cli tests create ... \
    --ux-metrics-json '[{"type":"sentiment","context":"the checkout flow","sections":[{"followup":{"question":"Why?","required":true}}]}]'

# Add/remove metrics on existing drafts
helio-cli tests add-ux-metrics <test-uuid> --metrics comprehension loyalty
helio-cli tests add-ux-metrics <test-uuid> --position 2 --metrics-json '[{"type":"sentiment","context":"the checkout flow"}]'

# A TYPE removes every instance of it; a metric id removes just that one
helio-cli tests remove-ux-metrics <test-uuid> --metrics comprehension
helio-cli tests remove-ux-metrics <test-uuid> --metrics <metric-uuid>

# View available metric types
helio-cli tests ux-metric-types
```

**Available types, and what each one already asks.** Read all eleven before hand-writing a question — the overlap is usually with a metric you skipped, not the one you checked.

| Metric | Covers |
| --- | --- |
| `sentiment` | which words describe their impression |
| `feeling` | which emotions it evokes |
| `appeal` | overall impression (Likert) |
| `reaction` | overall impression (Likert) — `appeal`'s twin |
| `comprehension` | how well they understood it |
| `frequency` | how often they use it |
| `loyalty` | would they recommend it (NPS) |
| `intent` | what they'd most likely do next |
| `desirability` | impression words + how likely to purchase |
| `usefulness` | is it useful + does it make things easier to get done |
| `expectations` | what they expected + how well it was met |
| `engagement` | where they would go first — **click test: image + hotspots** |
| `success` | can they find the one thing — **click test: image + hotspots** |
| `usability` | three find-it tasks in a row — **3 click tests: image + hotspots each** |
| `satisfaction` | a find-it task plus how completing it felt — **click test: image + hotspots** |
| `brand_score` | do they know you, what impressions you give, would they recommend you — **needs `brand_choice`** |

`helio-cli tests ux-metric-types --type <name>` prints the exact wording a metric generates.

#### Metrics that score zero without overrides

The five bolded types launch fine and measure nothing unless you supply the missing piece. A click-backed metric scores clicks that land **inside a hotspot**, and `brand_score` reads its recognition score off the choice you flag as your brand.

```bash
helio-cli tests create ... --ux-metrics-json '[
  {"type":"success","sections":[
    {"asset_id":"<image asset>",
     "instructions":"Click where you would check out.",
     "hotspots":[{"name":"Checkout","x":0.4,"y":0.5,"width":0.2,"height":0.1}]}]},
  {"type":"brand_score","sections":[
    {"choices":["Helio","UserTesting","Maze","Other"],"brand_choice":0}]}
]'

# Or fill them in on an existing draft
helio-cli tests edit-question <test-uuid> <section-uuid> \
    --hotspots '[{"name":"Checkout","x":0.4,"y":0.5,"width":0.2,"height":0.1}]'
helio-cli tests edit-question <test-uuid> <section-uuid> --brand-choice 0

# Catch what still scores zero before you spend answers on it
helio-cli tests validate <test-uuid>
```

Hotspot coordinates are relative to the image (0–1); `x`/`y` are the top-left corner, and `x + width` / `y + height` must each stay within 1. `create` and `add-ux-metrics` warn when a metric is missing its overrides; `validate` refuses to pass one.

Per-section override keys: `instructions`, `asset_id`, `site_link`, `followup`, `hotspots`, `choices`, `brand_choice`. Overrides apply in template order, so `sections[0]` is the metric's first section. Most metric choice lists are fixed length; `brand_score`'s market recognition list (`sections[0]`) is resizable down to 2.

**Not creatable from the CLI** — and rejected by the Public API too, not just client-side: `completion` and `effort`. Each is built from a Figma prototype section the API cannot create, so build them in the Helio web app. As of the 2026-07-30 API release these are the only two left out; `engagement`, `success`, `usability`, `satisfaction` and `brand_score` used to be excluded and no longer are.

### Reports

```bash
# Summary results
helio-cli tests report <test-uuid>

# Full report
helio-cli tests report <test-uuid> \
    --include questions_summary,questions_responses,demographics,ux_metrics

# Filter by demographics
helio-cli tests report <test-uuid> \
    --gender Female --age 25-34 35-44

# Paginate responses
helio-cli tests report <test-uuid> \
    --include questions_responses --limit 50 --offset 100

# Raw response data
helio-cli tests responses <test-uuid>
```

**`--include` values:** `questions_summary`, `questions_followups`, `questions_responses`, `audiences_summary`, `demographics`, `ux_metrics`, `prototype_journeys`, `filter_options`

### Participants & Custom Lists

```bash
# Custom lists
helio-cli custom-lists list
helio-cli custom-lists participants <list-uuid>

# Add participants
helio-cli participants create \
    --email user@example.com \
    --customer-list-id <list-uuid> \
    --full-name "Jane Doe"

# Bulk add
helio-cli custom-lists add-participants <list-uuid> \
    --data '[{"email": "a@b.com", "full_name": "A B"},
             {"email": "c@d.com", "full_name": "C D"}]'
```

### Question & Section Management

```bash
# Edit a question on a draft
helio-cli tests edit-question <test-uuid> <section-uuid> \
    --type free_response --instructions "Updated question"

# Insert a question at a specific position, with a follow-up
helio-cli tests add-question <test-uuid> \
    --type multiple_choice --instructions "Pick one" --choices "A" "B" "C" \
    --position 2 --followup "Why?" --followup-for-choices 0 2

# Safe edits on UX metric sections (omit --type): instructions, assets,
# choice text (count must match the template; intent may resize down to 3),
# randomize, follow-ups
helio-cli tests edit-question <test-uuid> <metric-section-uuid> \
    --choices "Sign up" "Browse pricing" "Leave site" \
    --followup "What drove your answer?"
helio-cli tests edit-question <test-uuid> <metric-section-uuid> --remove-followup

# Remove a question
helio-cli tests remove-question <test-uuid> <section-uuid>

# View and reorder questions
helio-cli tests order <test-uuid>
helio-cli tests reorder <test-uuid> \
    --order "metric:sentiment" "section:<q1-uuid>" "section:<q2-uuid>"
```

`order` lists one block per UX metric **instance**, not per type. A metric type that is on the test more than once must be addressed as `metric:<uuid>` — `metric:<type>` can't say which instance you mean and is rejected. `order` flags those blocks and does not print a paste-ready command for them; the uuids come from the `ux_metrics` summary in the response to the `create` or `add-ux-metrics` call that added them, since `tests get` does not return metric uuids.

## Command Aliases

| Alias | Command |
|-------|---------|
| `t` | `tests` |
| `p` | `projects` |
| `cl` | `custom-lists` |
| `pt` | `participants` |
| `a` | `audiences` |
| `ic` | `intercepts` |
| `r` | `responses` |

```bash
helio-cli t list --status running
helio-cli p tests <project-uuid>
helio-cli cl participants <list-uuid>
```

## JSON Output

Add `--output json` to any command for machine-readable output:

```bash
helio-cli tests list --output json
helio-cli tests report <id> --output json | jq '.questions_summary'
```

Errors also return structured JSON: `{ "error": "message", "code": 401 }`

## Global Options

| Option | Description |
|--------|-------------|
| `--output <format>` | `json` or `text` (default: `text`) |
| `--api-id <id>` | API ID (overrides config/env) |
| `--api-token <token>` | API token (overrides config/env) |
| `--base-url <url>` | Base URL (default: `https://my.helio.app`) |

## Troubleshooting

```bash
# Run diagnostics
helio-cli doctor

# Check auth status
helio-cli auth status

# Use staging or local dev
helio-cli --base-url http://localhost:3000 status
HELIO_BASE_URL=https://staging.helio.app helio-cli status
```

## Built-in Guide

Run `helio-cli guide` for a complete getting-started guide, or `helio-cli guide --output json` for a machine-readable version with full command schemas.

## Requirements

- Node.js >= 22
- [@helio-app/sdk](https://www.npmjs.com/package/@helio-app/sdk) (installed automatically)

## License

Private
