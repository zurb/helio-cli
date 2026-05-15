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

```bash
# Create a test (saved as draft)
helio-cli tests create \
    --project-id <uuid> \
    --name "My Survey" \
    --intro "Help us improve our product" \
    --target-audience-size 50 \
    --questions '[
      {"type": "MultipleChoice", "instructions": "How easy was signup?",
       "choices": ["Very easy", "Easy", "Neutral", "Difficult"]},
      {"type": "FreeResponse", "instructions": "What would you improve?"},
      {"type": "NPS", "instructions": "How likely are you to recommend us?"}
    ]'

# Validate without creating
helio-cli tests create --dry-run \
    --project-id <uuid> --name "Test" --intro "Hi" \
    --target-audience-size 50 --questions '[...]'

# Add questions one at a time
helio-cli tests add-question <test-uuid> \
    --type multiple_choice \
    --instructions "How did you pay?" \
    --choices "Credit card" "PayPal" "Apple Pay"

helio-cli tests add-question <test-uuid> \
    --type likert --instructions "Checkout was easy." \
    --scale-type agreement

helio-cli tests add-question <test-uuid> \
    --type nps --instructions "Would you recommend us?"

# Preview and launch
helio-cli tests preview <test-uuid>
helio-cli tests send <test-uuid>
```

### Question Types

`free_response`, `multiple_choice`, `likert`, `nps`, `ranking`, `preference`, `matrix`, `card_sort`, `point_allocation`, `max_diff`

PascalCase variants also accepted (e.g., `FreeResponse`, `MultipleChoice`).

Likert scales: `agreement`, `occurrence`, `importance`, `quality`, `comprehension`, `impression`, `expectations`, `usefulness`, `difficulty`, `likelihood`, `custom`

### UX Metrics

Auto-generate standardized measurement questions:

```bash
# Add metrics during test creation
helio-cli tests create \
    --project-id <uuid> \
    --name "UX Study" \
    --intro "Help us evaluate the experience" \
    --target-audience-size 50 \
    --questions '[{"type": "free_response", "instructions": "What did you think?"}]' \
    --ux-metrics sentiment loyalty

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

# Add/remove metrics on existing drafts
helio-cli tests add-ux-metrics <test-uuid> --metrics comprehension loyalty
helio-cli tests remove-ux-metrics <test-uuid> --metrics comprehension

# View available metric types
helio-cli tests ux-metric-types
```

Available types: `sentiment`, `feeling`, `appeal`, `reaction`, `comprehension`, `frequency`, `loyalty`, `intent`, `desirability`, `usefulness`, `expectations`

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
