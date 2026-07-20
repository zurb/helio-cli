import { Command } from 'commander';
import { isJsonMode, printJson } from '../output.js';

const GUIDE = `
\x1b[1mHelio CLI — Quick Start Guide\x1b[0m

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m1. AUTHENTICATION\x1b[0m

  Get your API ID and Token from \x1b[4mhttps://my.helio.app/account/organization\x1b[0m (scroll to API section).

  Log in interactively:
    $ helio-cli auth login

  Or set credentials directly:
    $ helio-cli config set api-id YOUR_API_ID
    $ helio-cli config set api-token YOUR_API_TOKEN

  Or use environment variables:
    $ export HELIO_API_ID=your_id
    $ export HELIO_API_TOKEN=your_token

  Verify everything works:
    $ helio-cli doctor

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m2. BROWSING YOUR ACCOUNT\x1b[0m

  List projects:
    $ helio-cli projects list
    $ helio-cli projects list --name "UX Research"
    $ helio-cli p list                     # shorthand alias

  List tests (with filters):
    $ helio-cli tests list
    $ helio-cli tests list --status running
    $ helio-cli tests list --status running complete --tags ux
    $ helio-cli t list                     # shorthand alias

  Get test details:
    $ helio-cli tests get <test-uuid>

  List and upload assets (images for question stimuli):
    $ helio-cli assets list --type image
    $ helio-cli assets upload ./homepage-mock.png
    $ helio-cli assets get <asset-id>          # check processing status + URLs
    $ helio-cli tests add-question <test-uuid> \\
        --type free_response --instructions "What stands out?" \\
        --asset-id <asset-id>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m3. CREATING & LAUNCHING TESTS\x1b[0m

  Create a test (saved as draft):
    $ helio-cli tests create \\
        --project-id <uuid> \\
        --name "My Survey" \\
        --intro "Help us improve our product" \\
        --target-audience-size 50 \\
        --questions '[
          {"type": "MultipleChoice", "instructions": "How easy was signup?",
           "choices": ["Very easy", "Easy", "Neutral", "Difficult"]},
          {"type": "FreeResponse", "instructions": "What would you improve?"},
          {"type": "NPS", "instructions": "How likely are you to recommend us?"}
        ]'

  Or use --project-name instead of UUID:
    $ helio-cli tests create --project-name "UX Research" ...

  Validate before creating (no API call):
    $ helio-cli tests create --dry-run \\
        --project-id <uuid> --name "Test" --intro "Hi" \\
        --target-audience-size 50 --questions '[...]'

  Add questions one at a time to a draft:
    $ helio-cli tests add-question <test-uuid> \\
        --type multiple_choice \\
        --instructions "How did you pay?" \\
        --choices "Credit card" "PayPal" "Apple Pay"
    $ helio-cli tests add-question <test-uuid> \\
        --type likert --instructions "Checkout was easy." \\
        --scale-type agreement
    $ helio-cli tests add-question <test-uuid> \\
        --type nps --instructions "Would you recommend us?"
    $ helio-cli tests add-question <test-uuid> \\
        --type ranking --instructions "Rank by importance" \\
        --choices "Speed" "Design" "Price" "Support"
    $ helio-cli tests add-question <test-uuid> \\
        --type matrix --instructions "Rate each feature" \\
        --choices "Speed" "Design" --categories "Poor" "Fair" "Good" "Excellent"
    $ helio-cli tests add-question <test-uuid> \\
        --type card_sort --instructions "Sort these items" \\
        --choices "Item A" "Item B" "Item C" --categories "Cat 1" "Cat 2"
    $ helio-cli tests add-question <test-uuid> \\
        --type point_allocation --instructions "Distribute 100 points" \\
        --choices "Speed" "Design" "Price" --points 100

  Edit or remove questions on a draft:
    $ helio-cli tests edit-question <test-uuid> <section-uuid> \\
        --type free_response --instructions "Updated question text"
    $ helio-cli tests remove-question <test-uuid> <section-uuid>

  Question types (snake_case or PascalCase):
    free_response (FreeResponse), multiple_choice (MultipleChoice),
    likert (Likert), nps (NPS), ranking (Ranking), preference (Preference),
    matrix (Matrix), card_sort (CardSort), point_allocation (PointAllocation),
    max_diff (MaxDiff)

  Likert scales: agreement, occurrence, importance, quality, comprehension,
                 impression, expectations, usefulness, difficulty, likelihood,
                 custom (provide --custom-choices)

  Add UX metrics (auto-generates standardized measurement questions):
    $ helio-cli tests create \\
        --project-id <uuid> \\
        --name "UX Study" \\
        --intro "Help us evaluate the experience" \\
        --target-audience-size 50 \\
        --questions '[{"type": "free_response", "instructions": "What did you think?"}]' \\
        --ux-metrics sentiment loyalty

  Customize metric instructions with --ux-metric-context (replaces generic nouns):
    $ helio-cli tests create \\
        --project-id <uuid> \\
        --name "Dashboard Pulse" \\
        --intro "Help us evaluate the dashboard" \\
        --target-audience-size 50 \\
        --ux-metrics sentiment loyalty \\
        --ux-metric-context "the Helio dashboard"

  Or create a metrics-only test (no custom questions):
    $ helio-cli tests create \\
        --project-id <uuid> \\
        --name "Quick Pulse" \\
        --intro "Quick feedback" \\
        --target-audience-size 50 \\
        --ux-metrics sentiment appeal usefulness

  Edit UX metric section instructions or assets (safe fields only):
    $ helio-cli tests edit-question <test-uuid> <section-uuid> \\
        --instructions "What impressions does the new design give you?"
    $ helio-cli tests edit-question <test-uuid> <section-uuid> \\
        --site-link "https://helio.app/dashboard"
    $ helio-cli tests edit-question <test-uuid> <section-uuid> \\
        --choices "Sign up" "Browse pricing" "Leave site" "Contact sales"  # intent only

  Available UX metric types:
    sentiment, feeling, appeal, reaction, comprehension, frequency,
    loyalty, intent, desirability, usefulness, expectations

  Add or remove UX metrics on an existing draft:
    $ helio-cli tests add-ux-metrics <test-uuid> --metrics comprehension loyalty
    $ helio-cli tests remove-ux-metrics <test-uuid> --metrics comprehension

  View current question/metric order:
    $ helio-cli tests order <test-uuid>

  Reorder questions and metric groups:
    $ helio-cli tests reorder <test-uuid> \\
        --order "metric:sentiment" "section:<q1-uuid>" "section:<q2-uuid>" "metric:loyalty"

  See details:
    $ helio-cli tests ux-metric-types
    $ helio-cli tests ux-metric-types --type sentiment

  Preview what you've built (flat structural summary):
    $ helio-cli tests preview <test-uuid>

  Walk through the test the way a participant sees it (one screen per page):
    $ helio-cli tests walkthrough <test-uuid>
    $ helio-cli tests walkthrough <test-uuid> --interactive   # advance one at a time (TTY required)
    $ helio-cli tests walkthrough <test-uuid> --output json   # structured screen list

  Launch the draft:
    $ helio-cli tests send <test-uuid>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m4. PULLING REPORT DATA\x1b[0m

  Summary results (default):
    $ helio-cli tests report <test-uuid>

  Full report with all data:
    $ helio-cli tests report <test-uuid> \\
        --include questions_summary,questions_responses,demographics,ux_metrics

  Filter by demographics:
    $ helio-cli tests report <test-uuid> \\
        --gender Female --age 25-34 35-44

  Paginate individual responses:
    $ helio-cli tests report <test-uuid> \\
        --include questions_responses --limit 50 --offset 100

  Raw response data:
    $ helio-cli tests responses <test-uuid>

  Read individual respondent journeys (answer + why + sentiment per section):
    $ helio-cli tests participants <test-uuid>
    $ helio-cli tests participants <test-uuid> --group-by cohort
    $ helio-cli tests participants <test-uuid> --sentiment negative --output json

  Available \x1b[4m--include\x1b[0m values:
    questions_summary      Aggregated results per question (default)
    questions_followups    Follow-up question summaries & sentiment
    questions_responses    Individual response data (paginated)
    audiences_summary      Audience segment breakdown
    demographics           Age, gender, income, education distributions
    ux_metrics             UX metric scores (ease of use, etc.)
    prototype_journeys     Screen-by-screen prototype navigation data
    participants           Per-respondent stitched journeys (answer + why + sentiment)
    filter_options         Available filter values for the test

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m5. MANAGING PARTICIPANTS & LISTS\x1b[0m

  List custom lists:
    $ helio-cli custom-lists list
    $ helio-cli cl list                    # shorthand alias

  Add participants to a list:
    $ helio-cli participants create \\
        --email user@example.com \\
        --customer-list-id <list-uuid> \\
        --full-name "Jane Doe"

  Bulk-add participants:
    $ helio-cli custom-lists add-participants <list-uuid> \\
        --data '[{"email": "a@b.com", "full_name": "A B"},
                 {"email": "c@d.com", "full_name": "C D"}]'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m6. JSON OUTPUT FOR AI AGENTS\x1b[0m

  Add \x1b[4m--output json\x1b[0m to any command for machine-readable output:
    $ helio-cli tests list --output json
    $ helio-cli tests report <id> --output json --include questions_summary

  Errors also return structured JSON:
    { "error": "message", "code": 401 }

  Pipe to jq for filtering:
    $ helio-cli tests report <id> --output json | jq '.questions_summary'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m7. COMMAND ALIASES\x1b[0m

  Save keystrokes with built-in aliases:
    t   → tests          p    → projects
    cl  → custom-lists   pt   → participants
    a   → audiences      ic   → intercepts
    r   → responses

  Examples:
    $ helio-cli t list --status running
    $ helio-cli p tests <project-uuid>
    $ helio-cli cl participants <list-uuid>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[1m8. TROUBLESHOOTING\x1b[0m

  Run diagnostics:
    $ helio-cli doctor

  Check authentication:
    $ helio-cli auth status

  Override the base URL (for staging or local dev):
    $ helio-cli --base-url http://localhost:3000 status
    $ HELIO_BASE_URL=https://staging.helio.app helio-cli status

  Credential precedence (first wins):
    1. CLI flags (--api-id, --api-token)
    2. Environment variables (HELIO_API_ID, HELIO_API_TOKEN)
    3. Config file (~/.helio-cli/config.json)
`;

const GUIDE_JSON = {
  overview: 'Helio CLI wraps the Helio Public API. All commands accept --output json for machine-readable output.',
  recommended_workflow: [
    '1. helio-cli auth login                              # authenticate',
    '2. helio-cli projects list --output json              # find your project',
    '3. helio-cli tests create --dry-run ...               # validate before creating',
    '4. helio-cli tests create ...                         # create draft',
    '5. helio-cli tests preview <id>                       # verify structure',
    '6. helio-cli tests walkthrough <id>                   # see what a participant experiences, step by step',
    '7. helio-cli tests send <id>                          # launch',
    '8. helio-cli tests report <id> --output json          # get results',
  ],
  commands: {
    auth: {
      login: { description: 'Set up API credentials', args: '--api-id <id> --api-token <token>' },
      status: { description: 'Check authentication status' },
      logout: { description: 'Remove stored credentials' },
    },
    config: {
      set: { description: 'Set config value', args: '<key> <value>', keys: ['api-id', 'api-token', 'base-url'] },
      get: { description: 'Get config value', args: '<key>' },
      show: { description: 'Show all config' },
    },
    tests: {
      list: {
        description: 'List tests',
        options: {
          '--status': 'paused | running | complete | draft | stopped (multiple allowed)',
          '--tags': 'Filter by tags (multiple allowed)',
          '--min-responses': 'Minimum response count',
          '--max-responses': 'Maximum response count',
          '--created-after': 'YYYY-MM-DD',
          '--created-before': 'YYYY-MM-DD',
          '--limit': 'Results per page (max 100, default 25)',
          '--offset': 'Pagination offset',
        },
      },
      get: { description: 'Get test details', args: '<id>' },
      preview: {
        description: 'Human-readable summary of a test with questions, choices, and results',
        args: '<id>',
        note: 'Use this to verify a test looks correct before launching.',
      },
      walkthrough: {
        description: 'Step through a test screen-by-screen the way a participant sees it',
        args: '<id>',
        options: {
          '--interactive': 'Prompt one screen at a time, capture answers, print recap (TTY required). Type "back" / "quit" to navigate.',
        },
        note: 'Complements preview: preview is a flat structural summary, walkthrough renders each participant screen separately (intro + per-question UI). Asset-heavy types (prototype_task, click_test, tree_test) render a placeholder pointing to the Helio browser preview. With --output json, emits { test, screens: [...] }.',
      },
      participants: {
        description: "Per-respondent journeys — each person's answers stitched together in order, with the follow-up why and its sentiment attached to each rating",
        args: '<id>',
        options: {
          '--participant <rsp_id>': 'Show only one respondent (matches participant_id)',
          '--group-by <field>': 'Group respondents by cohort or audience_type',
          '--limit <n>': 'Show at most N respondents (applied client-side)',
          '--offset <n>': 'Skip the first N respondents (applied client-side)',
          'demographic/segment/sentiment filters': 'Same as `report` (--age, --gender, --country, --sentiment, --segment-id, --flagged, --hidden, …) — applied server-side',
        },
        note: 'Convenience wrapper over `report --include participants`. Where walkthrough shows the empty test structure and report shows aggregates, participants shows what real people actually answered. Text mode renders a readable transcript; --output json emits { study, participants: [...] }. Caveats: cohorts is 0..n (empty for non-enroll recruits); sentiment / prototype grade+duration are eventually consistent, so null means "not computed yet" (rendered "pending"), never neutral.',
      },
      create: {
        description: 'Create a new test (saved as draft)',
        required: ['--name <name>', '--intro <text>', '--target-audience-size <n>'],
        one_of_required: ['--questions <json>', '--ux-metrics <types...>'],
        project: 'Provide either --project-id <uuid> or --project-name <name> (resolved to UUID)',
        optional: ['--audience-type <type> (default: open)', '--audiences <ids...>', '--ux-metrics <types...>', '--ux-metric-context <text>', '--dry-run'],
        dry_run: 'Validates questions and ux-metrics locally and shows estimated answer spend without creating the test.',
        questions_format: 'JSON array or @path/to/file.json',
        ux_metrics_note: 'Auto-generates standardized measurement questions. Can be used with or without --questions.',
        ux_metric_context_note: 'Replaces generic nouns (e.g. "this page", "this product") in auto-generated instructions with your context string.',
        validation: 'Client-side validation runs automatically. Errors return {valid: false, errors: [...]} with exit code 0.',
      },
      'ux-metric-types': {
        description: 'Show all UX metric types that can be auto-generated via the API',
        options: { '--type <type>': 'Show detail for one type' },
      },
      'add-ux-metrics': {
        description: 'Add UX metrics to an existing draft test',
        args: '<test-id>',
        required: ['--metrics <types...>'],
      },
      'remove-ux-metrics': {
        description: 'Remove UX metrics from an existing draft test',
        args: '<test-id>',
        required: ['--metrics <types...>'],
      },
      order: {
        description: 'Show current question/metric block order (use before reorder)',
        args: '<test-id>',
        note: 'Outputs block keys in the format reorder expects, with a copy-pasteable command.',
      },
      reorder: {
        description: 'Reorder questions and UX metric groups on a draft test',
        args: '<test-id>',
        required: ['--order <blocks...>'],
        block_format: 'Each block is "section:<uuid>" for a question or "metric:<type>" for a UX metric group. All blocks must be included.',
      },
      'add-question': {
        description: 'Add a question to an existing draft test (one at a time)',
        args: '<test-id>',
        required: ['--type <type>', '--instructions <text>'],
        type_specific: {
          multiple_choice: ['--choices <items...> (min 2)', '--allow-multiple', '--randomize-choices'],
          likert: ['--scale-type <scale>', '--custom-choices <items...> (when scale-type=custom)'],
          nps: [],
          free_response: [],
          ranking: ['--choices <items...> (min 3)'],
          preference: ['--choices <items...> (min 2)'],
          matrix: ['--choices <items...> (min 1, row labels)', '--categories <items...> (min 2, column labels)'],
          card_sort: ['--choices <items...> (min 2, cards)', '--categories <items...> (min 2)', '--random-category-order', '--can-skip-cards'],
          point_allocation: ['--choices <items...> (min 2)', '--points <n>', '--points-label <label>'],
          max_diff: ['--choices <items...> (min 4)'],
        },
        note: 'Validates the question before sending. Easier than building a full JSON array.',
      },
      'edit-question': {
        description: 'Replace a question on a draft test (keeps same position), or update safe fields on a UX metric section',
        args: '<test-id> <section-id>',
        modes: {
          regular_question: {
            description: 'Full question replacement (provide --type)',
            required: ['--type <type>', '--instructions <text>'],
          },
          ux_metric_section: {
            description: 'Safe edit on a UX metric section (omit --type)',
            allowed: ['--instructions <text>', '--asset-id <id>', '--site-link <url>', '--choices <items...> (intent only, min 3)'],
            note: 'Structural flags (--scale-type, --categories, --points, etc.) are rejected.',
          },
        },
        type_specific: {
          multiple_choice: ['--choices <items...> (min 2)', '--allow-multiple', '--randomize-choices'],
          likert: ['--scale-type <scale>', '--custom-choices <items...> (when scale-type=custom)'],
          nps: [],
          free_response: ['--asset-id <id>', '--site-link <url>'],
          ranking: ['--choices <items...> (min 3)'],
          preference: ['--choices <items...> (min 2)'],
          matrix: ['--choices <items...> (min 1, row labels)', '--categories <items...> (min 2, column labels)'],
          card_sort: ['--choices <items...> (min 2, cards)', '--categories <items...> (min 2)', '--random-category-order', '--can-skip-cards'],
          point_allocation: ['--choices <items...> (min 2)', '--points <n>', '--points-label <label>'],
          max_diff: ['--choices <items...> (min 4)'],
        },
        note: 'Destroys and recreates the section at the same position.',
      },
      'remove-question': {
        description: 'Remove a question from a draft test',
        args: '<test-id> <section-id>',
        note: 'Subsequent questions shift down to fill the gap.',
      },
      send: { description: 'Launch a draft test', args: '<id>' },
      responses: { description: 'Get all responses', args: '<id>' },
      report: {
        description: 'Get aggregated report data',
        args: '<id>',
        options: {
          '--include': 'Comma-separated list (default: questions_summary)',
          '--limit': 'Pagination for questions_responses',
          '--offset': 'Pagination offset',
          '--section-id': 'Filter to specific question',
          '--age': 'Filter by age brackets',
          '--gender': 'Filter by gender',
          '--country': 'Filter by country',
          '--income': 'Filter by income',
          '--education': 'Filter by education',
          '--company': 'Filter by company',
          '--segment-id': 'Filter by audience segment ID',
          '--response-time': 'Filter by response time',
        },
        include_values: {
          questions_summary: 'Aggregated results per question (default)',
          questions_followups: 'Follow-up question summaries and sentiment',
          questions_responses: 'Individual response data (paginated)',
          audiences_summary: 'Audience segment breakdown',
          demographics: 'Age, gender, income, education distributions',
          ux_metrics: 'UX metric scores',
          prototype_journeys: 'Screen-by-screen prototype navigation data',
          participants: 'Per-respondent stitched journeys (answer + why + sentiment per section)',
          filter_options: 'Available filter values for the test',
        },
      },
      'question-types': {
        description: 'Show all question types with schemas and examples',
        options: { '--type <type>': 'Show detail for one type', '--creatable': 'Only creatable types' },
      },
    },
    projects: {
      list: { description: 'List all projects', options: { '--name': 'Filter by name (case-insensitive partial match)' } },
      get: { description: 'Get project details', args: '<id>' },
      tests: { description: 'List tests in a project', args: '<project-id>' },
    },
    participants: {
      list: { description: 'List participants', options: { '--page': 'Page', '--per': 'Per page', '--with-views': '', '--with-responses': '' } },
      get: { description: 'Get participant', args: '<id> (UUID, email, or c_id)' },
      create: { description: 'Create participant', required: ['--email', '--customer-list-id'], optional: ['--full-name', '--c-id'] },
      update: { description: 'Update participant', args: '<id>', optional: ['--email', '--full-name', '--c-id'] },
      delete: { description: 'Delete participant', args: '<id>' },
    },
    'custom-lists': {
      list: { description: 'List custom lists' },
      get: { description: 'Get custom list details', args: '<id>' },
      participants: { description: 'List participants in a list', args: '<id>' },
      'add-participants': { description: 'Bulk-add participants', args: '<id>', required: ['--data <json>'] },
    },
    audiences: {
      list: { description: 'List audiences' },
      get: { description: 'Get audience details', args: '<id>' },
    },
    intercepts: {
      get: { description: 'Get intercept details (authenticated)', args: '<id>' },
      list: { description: 'List active intercepts (unauthenticated)', args: '<account-id>' },
      track: { description: 'Increment view count (unauthenticated)', args: '<id>' },
    },
    responses: {
      create: {
        description: 'Submit a response (Enterprise)',
        required: ['--test-id', '--c-id'],
        optional: ['--email', '--name', '--company', '--age', '--gender', '--education', '--income', '--country', '--state', '--city', '--zip', '--section-responses <json>'],
      },
    },
    assets: {
      list: {
        description: 'List account assets (images, video, audio)',
        options: {
          '--type': 'image | video | audio',
          '--name': 'Filter by filename (case-insensitive partial match)',
          '--limit': 'Results per page (max 100, default 25)',
          '--offset': 'Pagination offset',
        },
        note: 'Use an asset id as --asset-id on tests add-question / edit-question to attach an image stimulus.',
      },
      get: { description: 'Get asset details, including signed URLs', args: '<id>' },
      upload: {
        description: 'Upload an image asset (jpg, jpeg, png, gif; max 10MB)',
        args: '<file>',
        note: 'Returns the new asset with status "processing"; poll assets get <id> until status is "complete".',
      },
    },
  },
  question_types: {
    creatable: {
      free_response: { also_accepts: 'FreeResponse', required: ['type', 'instructions'], optional: ['asset_id', 'site_link'] },
      multiple_choice: { also_accepts: 'MultipleChoice', required: ['type', 'instructions', 'choices (min 2)'], optional: ['allow_multiple', 'randomize_choices'] },
      likert: {
        also_accepts: 'Likert',
        required: ['type', 'instructions', 'scale_type'],
        optional: ['custom_choices (required when scale_type=custom)'],
        scale_types: ['agreement', 'occurrence', 'importance', 'quality', 'comprehension', 'impression', 'expectations', 'usefulness', 'difficulty', 'likelihood', 'custom'],
      },
      nps: { also_accepts: 'NPS', required: ['type', 'instructions'] },
      ranking: { also_accepts: 'Ranking', required: ['type', 'instructions', 'choices (min 3)'] },
      preference: { also_accepts: 'Preference', required: ['type', 'instructions', 'choices (min 2)'] },
      matrix: { also_accepts: 'Matrix', required: ['type', 'instructions', 'choices (min 1)', 'categories (min 2)'] },
      card_sort: { also_accepts: 'CardSort', required: ['type', 'instructions', 'choices (min 2)', 'categories (min 2)'], optional: ['random_category_order', 'can_skip_cards'] },
      point_allocation: { also_accepts: 'PointAllocation', required: ['type', 'instructions', 'choices (min 2)'], optional: ['points', 'points_label'] },
      max_diff: { also_accepts: 'MaxDiff', required: ['type', 'instructions', 'choices (min 4)'] },
    },
    read_only: ['click_test', 'tree_test', 'prototype_task'],
  },
  ux_metrics: {
    description: 'UX metrics auto-generate standardized measurement questions when added to a test via --ux-metrics.',
    valid_types: ['sentiment', 'feeling', 'appeal', 'reaction', 'comprehension', 'frequency', 'loyalty', 'intent', 'desirability', 'usefulness', 'expectations'],
    excluded_types: {
      types: ['brand_score', 'engagement', 'success', 'completion', 'usability', 'satisfaction', 'effort'],
      reason: 'Require click tests, Figma prototypes, or complex multi-section composites',
    },
    example: 'helio-cli tests create --project-id <uuid> --name "UX Study" --intro "Evaluate this" --target-audience-size 50 --questions \'[{"type":"free_response","instructions":"Thoughts?"}]\' --ux-metrics sentiment loyalty',
    context_example: 'helio-cli tests create --project-id <uuid> --name "Dashboard Pulse" --intro "Evaluate" --target-audience-size 50 --ux-metrics sentiment loyalty --ux-metric-context "the Helio dashboard"',
    metrics_only_example: 'helio-cli tests create --project-id <uuid> --name "Quick Pulse" --intro "Feedback" --target-audience-size 50 --ux-metrics sentiment appeal usefulness',
    edit_metric_example: 'helio-cli tests edit-question <test-uuid> <section-uuid> --instructions "What impressions does the new design give you?"',
  },
  aliases: { t: 'tests', p: 'projects', cl: 'custom-lists', pt: 'participants', a: 'audiences', ic: 'intercepts', r: 'responses' },
  credential_precedence: ['1. CLI flags (--api-id, --api-token)', '2. Environment variables (HELIO_API_ID, HELIO_API_TOKEN)', '3. Config file (~/.helio-cli/config.json)'],
};

export function registerGuideCommand(program: Command): void {
  program
    .command('guide')
    .description('Show the getting-started guide')
    .action(() => {
      if (isJsonMode()) {
        printJson(GUIDE_JSON);
      } else {
        console.log(GUIDE);
      }
    });
}
