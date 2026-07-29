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

| Situation | Metrics | Also |
| --- | --- | --- |
| First look, one screen | `comprehension desirability intent` | a click test for engagement |
| Findability, any stage | `success sentiment effort` | click tests |
| Iteration on a flow | `expectations success sentiment` | |

`success`, `effort`, `engagement`, `completion`, `usability`, `satisfaction` and `brand_score` are composites built from click tests or Figma prototypes — add those in the Helio web app; the CLI rejects them. See [UX Metrics](#ux-metrics) for the CLI-creatable list.

#### Custom questions — for what the metrics don't cover

Before hand-writing a question, check it isn't metric territory: recommend/NPS is `loyalty`, "how easy was X" is `usefulness`, overall impression is `appeal`, "did you understand" is `comprehension`, "what did you expect" is `expectations`.

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

`preview` is a structural summary (every question on one page). `walkthrough` renders each participant screen separately — intro, then each question with its own input UI (radio buttons, text box, NPS row, etc.) — so you can comprehend the experience step by step. Asset-heavy types (prototypes, click tests, tree tests) render a placeholder pointing to the Helio browser preview.

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
helio-cli tests remove-ux-metrics <test-uuid> --metrics comprehension

# View available metric types
helio-cli tests ux-metric-types
```

Available types: `sentiment`, `feeling`, `appeal`, `reaction`, `comprehension`, `frequency`, `loyalty`, `intent`, `desirability`, `usefulness`, `expectations`

Not creatable from the CLI: `brand_score`, `engagement`, `success`, `completion`, `usability`, `satisfaction`, `effort` — these are composites built from click tests or Figma prototypes, so add them in the Helio web app.

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
