import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling, parseJsonOrFile } from '../output.js';
import { HelioApiError } from '../types.js';
import type { GlobalOptions, FollowupInput } from '../types.js';

function makeClient(program: Command): HelioClient {
  const opts = program.opts<GlobalOptions>();
  return new HelioClient(resolveCredentials(opts));
}

// Keys match the `type` field returned in report JSON — 1:1 with the API.
// The create endpoint accepts both snake_case and PascalCase (e.g. "free_response" or "FreeResponse").
const QUESTION_TYPES = {
  // ── Creatable via POST /tests ──────────────────────────────────
  free_response: {
    description: 'Open-ended text response',
    creatable: true,
    also_accepts: 'FreeResponse',
    required: ['type', 'instructions'],
    optional: ['asset_id', 'site_link'],
    example: {
      type: 'free_response',
      instructions: 'What would you improve about our product?',
    },
    summary_fields: 'sentiment_breakdown (positive/neutral/negative %), top_phrases',
    response_fields: 'text, sentiment',
  },
  multiple_choice: {
    description: 'Select one or more options from a list',
    creatable: true,
    also_accepts: 'MultipleChoice',
    required: ['type', 'instructions', 'choices'],
    optional: ['allow_multiple', 'randomize_choices', 'branching'],
    example: {
      type: 'multiple_choice',
      instructions: 'How did you hear about us?',
      choices: ['Search engine', 'Social media', 'Friend', 'Other'],
      allow_multiple: false,
      randomize_choices: false,
    },
    notes:
      'branching (single-select only, mutually exclusive with followup, requires a Helio Enterprise plan): [{choice: 0, action: "skip_to_question", question: 3}, {choice: 1, action: "end_test", message: "...", redirect_url: "..."}]. choice is a 0-based index; question is a 1-based question number and must be a LATER question (forward-only skips, matching the editor); on add/edit-question, section_id is also accepted (uuid or numeric id). end_test with message/redirect disqualifies with a custom end screen.',
    summary_fields: 'results: [{id, text, percent, count}]',
    response_fields: 'selected: [{id, text}], text (if follow-up)',
  },
  likert: {
    description: 'Agreement/satisfaction scale',
    creatable: true,
    also_accepts: 'Likert',
    required: ['type', 'instructions', 'scale_type'],
    optional: ['custom_choices'],
    scale_types: [
      'agreement',
      'occurrence',
      'importance',
      'quality',
      'comprehension',
      'impression',
      'expectations',
      'usefulness',
      'difficulty',
      'likelihood',
      'custom',
    ],
    example: {
      type: 'likert',
      instructions: 'The checkout process was easy to complete.',
      scale_type: 'agreement',
    },
    custom_example: {
      type: 'likert',
      instructions: 'Rate the visual design.',
      scale_type: 'custom',
      custom_choices: ['Love it', 'Like it', 'Neutral', 'Dislike it'],
    },
    summary_fields: 'scale (e.g. "5-point"), average_score, results: [{id, text, value, percent, count}]',
    response_fields: 'selected: [{id, text, value}], text (if follow-up)',
  },
  nps: {
    description: 'Net Promoter Score (0-10 scale)',
    creatable: true,
    also_accepts: 'NPS',
    required: ['type', 'instructions'],
    optional: [],
    example: {
      type: 'nps',
      instructions: 'How likely are you to recommend us to a friend?',
    },
    summary_fields:
      'nps_score (-100 to 100), breakdown: {promoters, passives, detractors} (each has percent, count), distribution: [{rating, percent, count}]',
    response_fields: 'rating (0-10), selected: [{id, text, value}], text (if follow-up)',
  },

  ranking: {
    description: 'Rank items in order of preference',
    creatable: true,
    also_accepts: 'Ranking',
    required: ['type', 'instructions', 'choices'],
    optional: [],
    example: {
      type: 'ranking',
      instructions: 'Rank these features by importance',
      choices: ['Speed', 'Design', 'Price', 'Support'],
    },
    summary_fields: 'results: [{id, text, average_rank}] sorted by rank',
    response_fields: 'rankings: [{choice: {id, text}, rank}] sorted by rank',
  },
  preference: {
    description: 'Choose a preferred option (text-only via API, images via UI)',
    creatable: true,
    also_accepts: 'Preference',
    required: ['type', 'instructions', 'choices'],
    optional: [],
    example: {
      type: 'preference',
      instructions: 'Which option do you prefer?',
      choices: ['Option A', 'Option B', 'Option C'],
    },
    summary_fields: 'results: [{id, text, percent, count, image_url?}]',
    response_fields: 'selected_variation: {id, name}',
  },
  matrix: {
    description: 'Rate multiple items on the same scale (grid)',
    creatable: true,
    also_accepts: 'Matrix',
    required: ['type', 'instructions', 'choices', 'categories'],
    optional: [],
    example: {
      type: 'matrix',
      instructions: 'Rate each feature',
      choices: ['Speed', 'Design', 'Price'],
      categories: ['Poor', 'Fair', 'Good', 'Excellent'],
    },
    summary_fields: 'scale: [column labels], rows: [{id, text, distribution: [{text, percent}]}]',
    response_fields: 'selected: [{id, text}], text',
  },
  click_test: {
    description: 'Click on an image to identify areas of interest',
    creatable: true,
    also_accepts: 'ClickTest',
    required: ['type', 'instructions', 'asset_id'],
    optional: ['hotspots', 'site_link'],
    example: {
      type: 'click_test',
      instructions: 'Where would you click to start a return?',
      asset_id: 123,
      hotspots: [{ name: 'Returns link', x: 0.1, y: 0.2, width: 0.3, height: 0.05, priority: 'Primary' }],
    },
    notes:
      'asset_id is required (upload via `assets upload`). Omit hotspots for an engagement click test (heatmap only); include them for a success click test. Coordinates are relative (0-1). priority: Primary | Secondary | Tertiary (default Primary).',
    summary_fields: 'results: [{id, text, percent, count}]',
    response_fields: 'clicks: [{x, y}] (relative coordinates)',
  },
  card_sort: {
    description: 'Sort cards into categories',
    creatable: true,
    also_accepts: 'CardSort',
    required: ['type', 'instructions', 'choices', 'categories'],
    optional: ['random_category_order', 'can_skip_cards'],
    example: {
      type: 'card_sort',
      instructions: 'Sort these items into categories',
      choices: ['Item A', 'Item B', 'Item C', 'Item D'],
      categories: ['Category 1', 'Category 2', 'Category 3'],
    },
    summary_fields: 'results: [{id, text, percent, count}]',
    response_fields: 'sorted: [{choice: {id, text}, category: {id, text}}]',
  },
  tree_test: {
    description: 'Navigate a tree hierarchy to find items',
    creatable: false,
    summary_fields: 'results: [{id, text, percent, count}]',
    response_fields: 'selected: [{id, text, path?}]',
  },
  max_diff: {
    description: 'Choose most and least preferred from a set',
    creatable: true,
    also_accepts: 'MaxDiff',
    required: ['type', 'instructions', 'choices'],
    optional: [],
    example: {
      type: 'max_diff',
      instructions: 'Choose the most and least important',
      choices: ['Feature A', 'Feature B', 'Feature C', 'Feature D'],
    },
    summary_fields: 'results: [{id, text, percent, count}]',
    response_fields: 'most: [{id, text}], least: [{id, text}]',
  },
  point_allocation: {
    description: 'Distribute points across options',
    creatable: true,
    also_accepts: 'PointAllocation',
    required: ['type', 'instructions', 'choices'],
    optional: ['points', 'points_label'],
    example: {
      type: 'point_allocation',
      instructions: 'Distribute 100 points across these features',
      choices: ['Speed', 'Design', 'Price'],
      points: 100,
      points_label: 'points',
    },
    summary_fields: 'results: [{id, text, percent, count}]',
    response_fields: 'allocations: [{choice: {id, text}, points}]',
  },
  prototype_task: {
    description: 'Navigate a Figma prototype to complete a task',
    creatable: false,
    summary_fields:
      'results: {direct_success, indirect_success, failed} (each has count, percent), expected_path_length, flows?: [{variation_id, name, expected_path_length, results}]',
    response_fields:
      'grade ("Direct Success" | "Indirect Success" | "Fail"), duration_seconds, journey?: {screens: [{node_id, timestamp_ms, duration_ms}], clicks: [{node_id, position, timestamp_ms}]} (requires include=prototype_journeys), flow_grades?: [{variation_id, name, grade}]',
  },
};

// ── Types for preview ────────────────────────────────────────────────

export interface TestShowResponse {
  // Header fields are optional: API versions before helio#4990 omit them
  // and return the internal numeric project_id (see resolveTestMeta).
  id?: string;
  name?: string;
  status?: string;
  responses_count?: number;
  project_id?: string | number;
  project_name?: string;
  account_id?: string;
  account_name?: string;
  introduction: string;
  sections: SectionData[];
  /** Present since the 2026-07-30 API release; null when the test has no quota. */
  audience?: AudienceData | null;
  [key: string]: unknown;
}

export interface TestMeta {
  id: string;
  name: string | null;
  status: string | null;
  responses_count: number | null;
  project_id: string | number | null;
  project_name: string | null;
  account_id: string | number | null;
  account_name: string | null;
}

// Since helio#4990 the tests/:id show response carries the full header
// (name/status/counts plus project/account ULIDs). Older API versions omit
// most of those fields and return the internal numeric project_id, so the
// report endpoint's study object backfills whatever the show response
// lacks. Falls back to the id the user asked for.
export function resolveTestMeta(
  requestedId: string,
  test: TestShowResponse,
  study?: Record<string, unknown> | null,
  account?: { id?: unknown; name?: unknown } | null,
): TestMeta {
  const s = study ?? {};
  const projectId =
    typeof test.project_id === 'string'
      ? test.project_id
      : ((s.project_id as string | undefined) ?? test.project_id ?? null);
  return {
    id: test.id ?? (s.id as string | undefined) ?? requestedId,
    name: test.name ?? (s.name as string | undefined) ?? null,
    status: test.status ?? (s.status as string | undefined) ?? null,
    responses_count: test.responses_count ?? (s.total_responses as number | undefined) ?? null,
    project_id: projectId,
    project_name: test.project_name ?? (s.project_name as string | undefined) ?? null,
    account_id:
      test.account_id ??
      (s.account_id as string | undefined) ??
      (account?.id as string | number | undefined) ??
      null,
    account_name:
      test.account_name ??
      (s.account_name as string | undefined) ??
      (account?.name as string | undefined) ??
      null,
  };
}

export interface SectionData {
  id: string;
  type: string;
  position: number;
  instructions: string;
  stripped_instructions: string;
  likert_type: string;
  variations: VariationData[];
  /** Read-back of what `branching` writes. Omitted when the section has none. */
  branching?: BranchingData[];
  /** Click sections only. Empty array = engagement heatmap, no hotspot scoring. */
  hotspots?: HotspotData[];
  [key: string]: unknown;
}

/**
 * Branch definitions in the vocabulary writes take, not the model's
 * (`action: "target"`, `target_id`). Present since the 2026-07-30 API release.
 */
export interface BranchingData {
  /** What the branch hangs off. The editor branches off all three. */
  source: 'choice' | 'variation' | 'hotspot';
  /** 0-based within its own list; for source "choice" this is the index writes take. */
  index: number;
  label: string | null;
  action: string;
  /** 1-based question number, counting researcher questions only. */
  question: number | null;
  section_id: number | null;
  message: string | null;
  redirect_url: string | null;
  [key: string]: unknown;
}

export interface HotspotData {
  id: number;
  variation_id: number;
  name: string | null;
  number: number;
  priority: string | null;
  /** All four are relative to the image (0-1); x/y are the top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

/** Audience config of the test's current (most recent) quota. */
export interface AudienceData {
  type: string;
  target_size: number | null;
  status: string | null;
  segments: { id: string; name: string; source: string }[];
  customer_lists: { id: string; name: string }[];
  demographics: Record<string, unknown>;
  screener: { id: string; name: string } | null;
  allow_retake: boolean;
  exclude_test_ids: string[];
  [key: string]: unknown;
}

interface VariationData {
  id: string;
  name: string;
  type: string;
  choices: ChoiceData[];
  asset_id?: number | string | null;
  has_asset?: boolean;
  asset_type?: string | null;
  asset_status?: string | null;
  screenshot_url?: string | null;
  thumb_url?: string | null;
  site_link?: string | null;
  [key: string]: unknown;
}

interface ChoiceData {
  id: string;
  text: string;
  position: number;
  [key: string]: unknown;
}

interface ReportQuestion {
  id: string;
  position: number;
  type: string;
  question: string;
  response_count: number;
  has_followup: boolean;
  results: unknown;
  nps_score?: number;
  breakdown?: { promoters: CountPercent; passives: CountPercent; detractors: CountPercent };
  average_score?: number;
  scale?: string;
  [key: string]: unknown;
}

interface CountPercent {
  count: number;
  percent: number;
}

interface ReportResponse {
  study: Record<string, unknown>;
  questions_summary: ReportQuestion[];
  [key: string]: unknown;
}

// ── Types for the `participants` report include ──────────────────────

interface JourneyStep {
  section_id: string;
  question_type: string;
  metric?: string | null;
  why?: string | null;
  sentiment?: string | null;
  selected?: { text?: string | null; value?: number | string | null }[];
  grade?: string | null;
  duration_seconds?: number | null;
  [key: string]: unknown;
}

interface ReportParticipant {
  participant_id: string;
  response_index?: number;
  response_time_ms?: number | null;
  flagged?: boolean;
  hidden?: boolean;
  demographics?: Record<string, unknown>;
  audience_type?: string;
  cohorts?: { id: string; name: string }[];
  journey?: JourneyStep[];
  [key: string]: unknown;
}

interface ParticipantsReportResponse {
  study?: Record<string, unknown>;
  participants?: ReportParticipant[];
  [key: string]: unknown;
}

// ── Preview helpers ──────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  FreeResponseDirectiveSection: 'Free Response',
  MultipleChoiceDirectiveSection: 'Multiple Choice',
  LikertDirectiveSection: 'Likert',
  NpsDirectiveSection: 'NPS',
  PreferenceDirectiveSection: 'Preference',
  RankingDirectiveSection: 'Ranking',
  MatrixDirectiveSection: 'Matrix',
  ClickTestDirectiveSection: 'Click Test',
  CardSortDirectiveSection: 'Card Sort',
  TreeTestDirectiveSection: 'Tree Test',
  MaxDiffDirectiveSection: 'Max Diff',
  PointAllocationDirectiveSection: 'Point Allocation',
  PrototypeDirectiveSection: 'Prototype Task',
  // Report types (snake_case)
  free_response: 'Free Response',
  multiple_choice: 'Multiple Choice',
  likert: 'Likert',
  nps: 'NPS',
  preference: 'Preference',
  ranking: 'Ranking',
  matrix: 'Matrix',
  click_test: 'Click Test',
  card_sort: 'Card Sort',
  tree_test: 'Tree Test',
  max_diff: 'Max Diff',
  point_allocation: 'Point Allocation',
  prototype_task: 'Prototype Task',
};

// The API can return a null/absent section `type` — notably for every section
// of a test that contains a click_test (zurb/helio). Echoing that straight into
// a label renders "[undefined]"/"[null]", which reads like a CLI bug rather
// than missing upstream data, so name the condition instead.
function typeLabel(type: string | null | undefined, fallback?: string | null): string {
  if (type) return TYPE_LABELS[type] ?? type;
  if (fallback) return TYPE_LABELS[fallback] ?? fallback;
  return 'unknown type';
}

export interface OrderBlock {
  key: string;
  label: string;
  /** 1-based question number of the FIRST question this block covers. */
  question_number: number;
  /** How many questions this block covers (>1 only for multi-question metrics). */
  question_count: number;
  /** Present on metric blocks only. */
  metric_type?: string;
  /**
   * This metric type is on the test more than once, so `key` cannot identify
   * the block — reorder needs `metric:<uuid>`, which GET /tests/:id does not
   * expose. Set only on metric blocks.
   */
  ambiguous?: true;
}

/**
 * Group a test's sections into reorderable blocks. One block per UX metric
 * INSTANCE, not per type — a type may legitimately appear on a test more than
 * once (a multi-screen flow measuring `expectations` on every screen), and each
 * instance owns its own sections and score.
 *
 * Blocks and questions are DIFFERENT numbering systems: a metric block is one
 * block but may span several questions, so a block's index is NOT the question
 * number that `--position` and branching `question` take. Callers must keep
 * them distinct — block index drives `--order`, `question_number` is what a
 * human acts on.
 *
 * `ambiguous` marks an instance whose type is on the test more than once. The
 * API needs `metric:<uuid>` for those, and GET /tests/:id exposes only the
 * metric's numeric id — so the key here is not directly usable and the caller
 * has to say so rather than print a command that will 400.
 */
export function buildOrderBlocks(rawSections: SectionData[]): OrderBlock[] {
  const sections = [...rawSections].sort((a, b) => a.position - b.position);
  const blocks: OrderBlock[] = [];
  const seenMetrics = new Set<string | number>();

  const metricOf = (sec: SectionData) =>
    (sec as Record<string, unknown>).ux_metric as { metric_type: string; id?: string | number } | null;

  // Instances are told apart by the metric's own id; fall back to the type when
  // a payload omits it, which collapses instances but never invents blocks.
  const instanceKey = (m: { metric_type: string; id?: string | number }) => m.id ?? m.metric_type;

  const typeCounts = new Map<string, Set<string | number>>();
  for (const sec of sections) {
    const m = metricOf(sec);
    if (!m?.metric_type) continue;
    const set = typeCounts.get(m.metric_type) ?? new Set();
    set.add(instanceKey(m));
    typeCounts.set(m.metric_type, set);
  }

  for (let qi = 0; qi < sections.length; qi++) {
    const s = sections[qi];
    const uxMetric = metricOf(s);
    if (uxMetric?.metric_type) {
      const metricType = uxMetric.metric_type;
      const key = instanceKey(uxMetric);
      if (seenMetrics.has(key)) continue;
      seenMetrics.add(key);
      const count = sections.filter(sec => {
        const m = metricOf(sec);
        return m?.metric_type && instanceKey(m) === key;
      }).length;
      const repeated = (typeCounts.get(metricType)?.size ?? 1) > 1;
      const instanceNumber = repeated
        ? [...(typeCounts.get(metricType) ?? [])].indexOf(key) + 1
        : undefined;
      blocks.push({
        key: `metric:${metricType}`,
        label:
          `${metricType} metric` +
          (instanceNumber ? ` #${instanceNumber}` : '') +
          ` (${count} question${count === 1 ? '' : 's'})`,
        question_number: qi + 1,
        question_count: count,
        metric_type: metricType,
        ambiguous: repeated || undefined,
      });
    } else {
      blocks.push({
        key: `section:${s.id}`,
        label: `[${typeLabel(s.type)}] ${s.stripped_instructions || s.instructions || ''}`.trim(),
        question_number: qi + 1,
        question_count: 1,
      });
    }
  }

  return blocks;
}

function formatStatus(status: string): string {
  const colors: Record<string, string> = {
    draft: '\x1b[33m',     // yellow
    running: '\x1b[32m',   // green
    complete: '\x1b[36m',  // cyan
    paused: '\x1b[33m',    // yellow
    stopped: '\x1b[31m',   // red
  };
  const color = colors[status] ?? '\x1b[90m';
  return `${color}(${status})\x1b[0m`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function printReportQuestions(questions: ReportQuestion[]): void {
  const sorted = [...questions].sort((a, b) => a.position - b.position);
  // The report serializer passes section.position through raw, and platform
  // storage is 0-based — printing it directly labels the first question "Q0".
  // Number by sorted order instead, matching printSectionQuestions.
  for (let i = 0; i < sorted.length; i++) {
    const q = sorted[i];
    const label = typeLabel(q.type);
    const countStr = q.response_count != null ? ` (${q.response_count} responses)` : '';
    console.log(`  \x1b[1mQ${i + 1}.\x1b[0m [${label}] ${q.question}${countStr}`);

    const results = q.results as Record<string, unknown>[] | undefined;

    if (q.type === 'nps' && q.nps_score != null) {
      console.log(`      NPS Score: \x1b[1m${q.nps_score}\x1b[0m`);
      if (q.breakdown) {
        const b = q.breakdown;
        console.log(`      Promoters: ${b.promoters.percent}%  Passives: ${b.passives.percent}%  Detractors: ${b.detractors.percent}%`);
      }
    } else if (q.type === 'likert' && q.average_score != null) {
      console.log(`      Scale: ${q.scale ?? '5-point'}  Average: \x1b[1m${q.average_score}\x1b[0m`);
      if (Array.isArray(results)) {
        for (const r of results as { text: string; percent: number; count: number }[]) {
          const bar = progressBar(r.percent);
          console.log(`      ${bar} ${String(r.percent).padStart(5)}%  ${r.text}`);
        }
      }
    } else if (Array.isArray(results) && results.length > 0) {
      for (const r of results as { text: string; percent: number; count: number }[]) {
        if (r.text == null || r.percent == null) continue;
        const bar = progressBar(r.percent);
        console.log(`      ${bar} ${String(r.percent).padStart(5)}%  ${r.text}`);
      }
    }

    console.log();
  }
}

function printSectionQuestions(sections: SectionData[]): void {
  const sorted = [...sections].sort((a, b) => a.position - b.position);
  const qIndex = buildQuestionNumberIndex(sections);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const label = typeLabel(s.type);
    const question = s.stripped_instructions || stripHtml(s.instructions || '');
    console.log(`  \x1b[1mQ${i + 1}.\x1b[0m [${label}] ${question}`);

    if (s.likert_type) {
      console.log(`      Scale: ${s.likert_type}`);
    }

    // Show choices from first variation
    const variation = s.variations?.[0];
    if (variation?.choices?.length) {
      const choices = [...variation.choices].sort((a, b) => a.position - b.position);
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      for (let c = 0; c < choices.length; c++) {
        console.log(`      ${letters[c] ?? c + 1}) ${choices[c].text}`);
      }
    }

    printHotspots(s);
    printBranching(s, qIndex);

    console.log();
  }
}

/**
 * Hotspots are what a click-backed metric scores against, so "none" is the
 * finding worth surfacing: on a metric-owned click section it means the metric
 * scores zero, while on a standalone click test it just means engagement.
 */
function printHotspots(s: SectionData): void {
  if (!Array.isArray(s.hotspots)) return;

  const metricType = (s as { ux_metric?: { metric_type?: string } }).ux_metric?.metric_type;
  if (s.hotspots.length === 0) {
    const scored = metricType && UX_METRIC_TYPES[metricType]?.hotspot_scored;
    console.log(
      scored
        ? `      \x1b[33m⚠ No hotspots\x1b[0m — ${metricType} scores clicks inside hotspots, so this section scores zero`
        : `      \x1b[90mNo hotspots (engagement heatmap)\x1b[0m`,
    );
    return;
  }

  console.log(`      Hotspots (${s.hotspots.length}):`);
  for (const h of [...s.hotspots].sort((a, b) => a.number - b.number)) {
    const name = h.name || `hotspot ${h.number}`;
    const priority = h.priority ? ` [${h.priority}]` : '';
    console.log(
      `        ${h.number}. ${name}${priority}  \x1b[90m${fmtBox(h)}\x1b[0m`,
    );
  }
}

function fmtBox(h: HotspotData): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `x ${pct(h.x)}, y ${pct(h.y)}, ${pct(h.width)}×${pct(h.height)}`;
}

/**
 * Section id → the Q number the CLI prints for it.
 *
 * TWO numbering systems are in play and they are not the same. Everything the
 * CLI prints (`printSectionQuestions`, `printReportQuestions`, `OrderBlock`)
 * numbers sections in position order including UX metric sections. A branch's
 * `question` counts researcher questions ONLY — `decorate_sections!` builds it
 * from `ordered.reject { |s| s.ux_metric_id.present? }` — so on any test with a
 * metric the two drift apart by the number of metric sections before the
 * target. Resolving the branch's `section_id` against this index sidesteps the
 * counting entirely and is exact.
 */
export function buildQuestionNumberIndex(sections: SectionData[] | undefined): Map<number, number> {
  const ordered = [...(sections ?? [])].sort((a, b) => a.position - b.position);
  const index = new Map<number, number>();
  ordered.forEach((s, i) => {
    // Section ids are numeric on the wire even though the type says string.
    const numericId = Number(s.id);
    if (Number.isFinite(numericId)) index.set(numericId, i + 1);
  });
  return index;
}

/** The CLI-listing Q number a branch points at, or null if it can't be resolved. */
function branchTargetQNumber(b: BranchingData, qIndex: Map<number, number>): number | null {
  if (b.section_id == null) return null;
  return qIndex.get(Number(b.section_id)) ?? null;
}

function printBranching(s: SectionData, qIndex: Map<number, number>): void {
  if (!Array.isArray(s.branching) || s.branching.length === 0) return;

  console.log(`      Branching:`);
  for (const b of s.branching) {
    const from = b.label ? `"${b.label}"` : `${b.source} ${b.index}`;
    const target = branchTargetQNumber(b, qIndex);
    const to =
      b.action === 'end_test'
        ? b.message
          ? `end test — "${b.message}"`
          : b.redirect_url
            ? `end test → ${b.redirect_url}`
            : 'end test'
        : target != null
          ? `skip to Q${target}`
          : `skip to section ${b.section_id ?? '?'}`;
    console.log(`        ${from} → ${to}`);
  }
}

/**
 * Branching and hotspots for a launched test, where report data supplies the
 * questions and carries neither. Only sections that have something to say.
 */
function printStructureNotes(sections: SectionData[] | undefined): void {
  const withNotes = [...(sections ?? [])]
    .sort((a, b) => a.position - b.position)
    .filter(s => Array.isArray(s.branching) || Array.isArray(s.hotspots));
  if (!withNotes.length) return;

  const ordered = [...(sections ?? [])].sort((a, b) => a.position - b.position);
  const qIndex = buildQuestionNumberIndex(sections);
  console.log(`\x1b[1mStructure\x1b[0m`);
  for (const s of withNotes) {
    const q = ordered.indexOf(s) + 1;
    console.log(`  \x1b[1mQ${q}.\x1b[0m ${s.stripped_instructions || stripHtml(s.instructions || '')}`);
    printHotspots(s);
    printBranching(s, qIndex);
  }
  console.log();
}

/**
 * Flat branching for JSON consumers. Both numbering systems are present and
 * each is named for the space it lives in: `from_question_number` and
 * `target_question_number` are CLI-listing numbers (metric sections counted),
 * while the spread-in `question` is the API's own field and counts researcher
 * questions only. `target_question_number` is null for end_test branches and
 * whenever the target section isn't in this payload.
 */
export function buildBranchingSummary(sections: SectionData[] | undefined): unknown[] {
  const ordered = [...(sections ?? [])].sort((a, b) => a.position - b.position);
  const qIndex = buildQuestionNumberIndex(sections);
  // `section_id` on a branch is its TARGET, not the section it hangs off, so
  // the source section is named separately rather than shadowing it.
  return ordered.flatMap((s, i) =>
    (s.branching ?? []).map(b => ({
      from_question_number: i + 1,
      from_section_id: s.id,
      target_question_number: branchTargetQNumber(b, qIndex),
      ...b,
    })),
  );
}

export function buildHotspotSummary(sections: SectionData[] | undefined): unknown[] {
  const ordered = [...(sections ?? [])].sort((a, b) => a.position - b.position);
  return ordered
    .filter(s => Array.isArray(s.hotspots))
    .map((s, _i) => {
      const metricType = (s as { ux_metric?: { metric_type?: string } }).ux_metric?.metric_type ?? null;
      return {
        question_number: ordered.indexOf(s) + 1,
        section_id: s.id,
        ux_metric: metricType,
        // A hotspot-scored metric with no hotspots scores zero — the one thing
        // a pre-launch reviewer needs to catch here.
        scores_zero: Boolean(metricType && UX_METRIC_TYPES[metricType]?.hotspot_scored && s.hotspots?.length === 0),
        hotspots: s.hotspots ?? [],
      };
    });
}

/** Audience config of the current quota, in the vocabulary POST /tests takes. */
function printAudience(audience: AudienceData | null | undefined): void {
  if (!audience) return;

  console.log(`\x1b[1mAudience\x1b[0m`);
  const size = audience.target_size != null ? `, ${audience.target_size} participants` : '';
  const status = audience.status ? ` (${audience.status})` : '';
  console.log(`  ${audience.type}${size}${status}`);

  for (const segment of audience.segments ?? []) {
    console.log(`  segment: ${segment.name} \x1b[90m[${segment.source}]\x1b[0m`);
  }
  for (const list of audience.customer_lists ?? []) {
    console.log(`  customer list: ${list.name}`);
  }

  const demographics = Object.entries(audience.demographics ?? {}).filter(
    ([, v]) => v != null && (!Array.isArray(v) || v.length > 0),
  );
  for (const [key, value] of demographics) {
    console.log(`  ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }

  if (audience.screener) console.log(`  screener: ${audience.screener.name}`);
  if (audience.allow_retake) console.log(`  retakes allowed`);
  if (audience.exclude_test_ids?.length) {
    console.log(`  excludes participants from ${audience.exclude_test_ids.length} test(s)`);
  }
  console.log();
}

function buildQuestionsFromSections(sections: SectionData[] | undefined): unknown[] {
  if (!sections?.length) return [];
  return [...sections]
    .sort((a, b) => a.position - b.position)
    .map((s, i) => ({
      position: i + 1,
      type: s.type,
      display_type: TYPE_LABELS[s.type] ?? s.type,
      question: s.stripped_instructions || stripHtml(s.instructions || ''),
      choices: s.variations?.[0]?.choices
        ?.sort((a, b) => a.position - b.position)
        .map(c => c.text) ?? [],
    }));
}

// Parses a JSON array from an inline string or @path/to/file.json, prefixing
// parseJsonOrFile's specific error (invalid JSON, file not found, etc.) with the
// flag name so the original message reaches the user instead of being swallowed.
export function parseJsonArrayFlag(value: string, flagName: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = parseJsonOrFile(value);
  } catch (err) {
    throw new Error(`${flagName}: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${flagName} must be a JSON array.`);
  }
  return parsed;
}

export function parsePositiveInt(value: string | undefined, flagName: string): number {
  if (value === undefined || value === '') {
    throw new Error(`${flagName} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${flagName} must be a positive integer, got "${value}"`);
  }
  return n;
}

function progressBar(percent: number, width = 15): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `\x1b[36m${'█'.repeat(filled)}${'░'.repeat(empty)}\x1b[0m`;
}

// ── Project name resolver ────────────────────────────────────────────

async function resolveProjectByName(client: HelioClient, name: string): Promise<string> {
  const data = (await client.get('projects', { name })) as {
    projects: { id: string; name: string }[];
  };
  const lower = name.toLowerCase();
  const exact = data.projects.find(p => p.name.toLowerCase() === lower);
  if (exact) return exact.id;

  const partial = data.projects.filter(p => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0].id;
  if (partial.length > 1) {
    const names = partial.map(p => `  - ${p.name} (${p.id})`).join('\n');
    throw new Error(`Multiple projects match "${name}":\n${names}\nUse --project-id to specify exactly.`);
  }
  throw new Error(`No project found matching "${name}". Run \`helio-cli projects list\` to see available projects.`);
}

// ── Client-side question validation ──────────────────────────────────

interface QuestionInput {
  type?: string;
  instructions?: string;
  choices?: unknown[];
  scale_type?: string;
  custom_choices?: unknown[];
  allow_multiple?: boolean;
  randomize_choices?: boolean;
  asset_id?: string;
  site_link?: string;
  categories?: unknown[];
  points?: number;
  points_label?: string;
  random_category_order?: boolean;
  can_skip_cards?: boolean;
  position?: number;
  followup?: FollowupInput;
  hotspots?: unknown[];
  branching?: unknown[];
  [key: string]: unknown;
}

// UX metric object form: {type, context, sections: [{instructions, asset_id, site_link, followup}]}
interface UxMetricSectionOverride {
  instructions?: string;
  asset_id?: string;
  site_link?: string;
  followup?: FollowupInput;
  [key: string]: unknown;
}

export interface UxMetricObjectInput {
  type: string;
  context?: string;
  sections?: UxMetricSectionOverride[];
  [key: string]: unknown;
}

export type UxMetricEntry = string | UxMetricObjectInput;

export interface ValidationError {
  question: number;
  field: string;
  message: string;
}

// Map PascalCase aliases to canonical snake_case
const TYPE_ALIASES: Record<string, string> = {
  FreeResponse: 'free_response',
  MultipleChoice: 'multiple_choice',
  Likert: 'likert',
  NPS: 'nps',
  Ranking: 'ranking',
  Preference: 'preference',
  Matrix: 'matrix',
  CardSort: 'card_sort',
  PointAllocation: 'point_allocation',
  MaxDiff: 'max_diff',
  ClickTest: 'click_test',
};

const HOTSPOT_PRIORITIES = ['Primary', 'Secondary', 'Tertiary'];

const BRANCH_ACTIONS = ['skip_to_question', 'end_test'];

// Read-only model attrs leaked by GET responses; the API rejects them on
// write, so fail fast client-side with the correct shape.
const LEGACY_FOLLOWUP_KEYS = ['enable_followup', 'followup_question', 'followup_required', 'choice_required_followup'];

const VALID_SCALE_TYPES = [
  'agreement', 'occurrence', 'importance', 'quality', 'comprehension',
  'impression', 'expectations', 'usefulness', 'difficulty', 'likelihood', 'custom',
];

// UX metric types that can be auto-generated via the API.
//
// `click_sections` lists the 0-based indexes of sections the template builds as
// click tests — those are the ones that take an `asset_id` and `hotspots`
// override. `hotspot_scored` marks metrics whose score comes from clicks landing
// inside a hotspot, so a click section with none scores zero however
// participants behave; the API refuses to launch those.
const UX_METRIC_TYPES: Record<string, {
  description: string;
  section_count: number;
  section_types: string;
  default_instructions: string;
  click_sections?: number[];
  hotspot_scored?: boolean;
  /** 0-based section index carrying the "this choice is my brand" flag. */
  brand_choice_section?: number;
  /** Section index -> minimum length, for sections whose choice list you may resize. */
  resizable_choice_sections?: Record<number, number>;
}> = {
  sentiment: {
    description: 'Measures users\' emotional reactions and satisfaction',
    section_count: 1,
    section_types: 'MultipleChoice (8 words, randomized)',
    default_instructions: 'Which of these words best describe your impression of the [product]?',
  },
  feeling: {
    description: 'Measures emotions that a design or product evokes',
    section_count: 1,
    section_types: 'MultipleChoice (8 emotions, max 3 selections, randomized)',
    default_instructions: 'Which of these feelings best describe how you feel about this [product]?',
  },
  appeal: {
    description: 'Captures users\' immediate emotional response to a design',
    section_count: 1,
    section_types: 'Likert (impression)',
    default_instructions: 'What is your overall impression of this [product]?',
  },
  reaction: {
    description: 'Captures users\' immediate emotional response to a design',
    section_count: 1,
    section_types: 'Likert (impression)',
    default_instructions: 'What is your overall impression of this [product]?',
  },
  comprehension: {
    description: 'Measures users\' understanding of product features',
    section_count: 1,
    section_types: 'Likert (comprehension, 4 choices)',
    default_instructions: 'How well did you understand the [product]?',
  },
  frequency: {
    description: 'Measures how often users engage with a product',
    section_count: 1,
    section_types: 'Likert (occurrence)',
    default_instructions: 'How often do you use [product]?',
  },
  loyalty: {
    description: 'Measures likelihood of continued use and recommendations (NPS)',
    section_count: 1,
    section_types: 'NPS (0-10)',
    default_instructions: 'How likely are you to recommend this [product] to a friend or colleague?',
  },
  intent: {
    description: 'Measures likelihood of users taking desired actions',
    section_count: 1,
    section_types: 'MultipleChoice (4 action choices, randomized)',
    default_instructions: 'Imagine you need to do [some action]. What would you most likely do next?',
  },
  desirability: {
    description: 'Measures users\' level of interest in a product or feature',
    section_count: 2,
    section_types: 'MultipleChoice (8 words, randomized) + Likert (likelihood)',
    default_instructions: 'What impressions does this product give you? + How likely would you be to purchase this [product]?',
  },
  usefulness: {
    description: 'Evaluates how well a product serves its purpose',
    section_count: 2,
    section_types: 'Likert (agreement) + Likert (agreement)',
    default_instructions: 'This [product] is useful. + This [product] makes the things I want to accomplish easier to get done.',
  },
  expectations: {
    description: 'Measures alignment between experience and user expectations',
    section_count: 2,
    section_types: 'FreeResponse + Likert (expectations)',
    default_instructions: 'What did you expect [product] to do before using it? + How well did [product] meet your expectations?',
  },
  engagement: {
    description: 'Measures active and meaningful product interactions',
    section_count: 1,
    section_types: 'ClickTest',
    default_instructions: 'Click where you would go first on this page.',
    click_sections: [0],
    hotspot_scored: true,
  },
  success: {
    description: 'Measures achievement of intended user goals',
    section_count: 1,
    section_types: 'ClickTest',
    default_instructions: 'Click where you would go to [take action] on this page.',
    click_sections: [0],
    hotspot_scored: true,
  },
  usability: {
    description: 'Measures ease of learning and effective product usage',
    section_count: 3,
    section_types: 'ClickTest x3 (one task per section)',
    default_instructions: 'Click where you would go to [take action] on this page. (x3)',
    click_sections: [0, 1, 2],
    hotspot_scored: true,
  },
  satisfaction: {
    description: 'Measures satisfaction after completing specific tasks',
    section_count: 2,
    section_types: 'ClickTest + Likert (impression)',
    default_instructions: 'Click where you would go to find the contact information for this company. + How did you feel about completing this task?',
    click_sections: [0],
    hotspot_scored: true,
  },
  brand_score: {
    description: 'Measures brand recognition and customer advocacy',
    section_count: 3,
    section_types: 'MultipleChoice (market recognition, resizable) + MultipleChoice (8 impressions, fixed) + NPS',
    default_instructions: 'Which of these apps do you currently have downloaded on your device? + What impressions does this page give you? + How likely is it that you would recommend our product to a friend or colleague?',
    brand_choice_section: 0,
    resizable_choice_sections: { 0: 2 },
  },
};

const VALID_UX_METRIC_TYPE_NAMES = Object.keys(UX_METRIC_TYPES);

// Types the API still can't build, with the reason each one is out. Mirrors
// EXCLUDED_UX_METRIC_TYPES in Api::Public::V1::GenericTestsController.
const EXCLUDED_UX_METRIC_TYPES: Record<string, string> = {
  completion: 'is built from a Figma prototype section, which cannot be created via the API',
  effort: 'is built from a Figma prototype section, which cannot be created via the API',
};

export function validateUxMetrics(metrics: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(metrics)) {
    errors.push({ question: 0, field: 'ux_metrics', message: 'Must be an array of metric type strings' });
    return errors;
  }

  for (let i = 0; i < metrics.length; i++) {
    const entry = metrics[i];
    const m: unknown = typeof entry === 'string' ? entry : (entry as { type?: unknown } | null)?.type;

    if (typeof m !== 'string' || !m) {
      errors.push({
        question: 0,
        field: `ux_metrics[${i}]`,
        message: 'Each entry must be a string or an object with a "type"',
      });
      continue;
    }

    // Own-property checks: a bare `OBJ[m]` lookup treats inherited keys
    // ("constructor", "toString", "__proto__") as present and garbles the error.
    const excludedReason = Object.hasOwn(EXCLUDED_UX_METRIC_TYPES, m) ? EXCLUDED_UX_METRIC_TYPES[m] : undefined;
    if (excludedReason) {
      errors.push({
        question: 0,
        field: `ux_metrics[${i}]`,
        message: `"${m}" ${excludedReason}. Valid types: ${VALID_UX_METRIC_TYPE_NAMES.join(', ')}`,
      });
      continue;
    }

    const spec = Object.hasOwn(UX_METRIC_TYPES, m) ? UX_METRIC_TYPES[m] : undefined;
    if (!spec) {
      errors.push({
        question: 0,
        field: `ux_metrics[${i}]`,
        message: `Unknown metric type "${m}". Valid types: ${VALID_UX_METRIC_TYPE_NAMES.join(', ')}`,
      });
      continue;
    }

    if (typeof entry === 'object' && entry !== null) {
      validateUxMetricSectionOverrides(
        (entry as UxMetricObjectInput).sections,
        m,
        spec,
        `ux_metrics[${i}]`,
        errors,
      );
    }
  }

  // Repeated metric types are deliberately allowed: every instance owns its own
  // sections and is scored independently, which is what a multi-screen flow
  // measuring `expectations` on each screen needs. The web editor has always
  // permitted this; the API used to reject it and no longer does.

  return errors;
}

/**
 * Metrics that will launch but measure nothing as configured. Not errors: the
 * API accepts them at create, and you can still fill in the missing piece with
 * `edit-question` before sending. `tests validate` is what finally refuses.
 *
 * The bare string form (`--ux-metrics success`) is the easy way to hit this —
 * it looks complete and scores zero.
 */
export function uxMetricWarnings(metrics: unknown): string[] {
  if (!Array.isArray(metrics)) return [];

  const warnings: string[] = [];
  for (const entry of metrics) {
    const type = typeof entry === 'string' ? entry : (entry as { type?: unknown } | null)?.type;
    if (typeof type !== 'string') continue;
    if (!Object.hasOwn(UX_METRIC_TYPES, type)) continue;
    const spec = UX_METRIC_TYPES[type];

    const sections = (typeof entry === 'object' && entry !== null
      ? (entry as UxMetricObjectInput).sections
      : undefined) ?? [];

    if (spec.hotspot_scored) {
      const missing = (spec.click_sections ?? []).filter(idx => {
        const o = sections[idx] as Record<string, unknown> | undefined;
        return !Array.isArray(o?.hotspots) || (o.hotspots as unknown[]).length === 0;
      });
      if (missing.length) {
        warnings.push(
          `${type} scores clicks that land inside a hotspot — sections[${missing.join('], sections[')}] have none and will score zero. Add hotspots (and an image asset_id) via --ux-metrics-json, or with edit-question --hotspots before sending.`,
        );
      }
    }

    if (spec.brand_choice_section !== undefined) {
      const o = sections[spec.brand_choice_section] as Record<string, unknown> | undefined;
      if (o?.brand_choice === undefined) {
        warnings.push(
          `${type} reads its recognition score off the choice flagged as your brand — none is marked, so it will score zero. Set brand_choice on sections[${spec.brand_choice_section}], or use edit-question --brand-choice before sending.`,
        );
      }
    }
  }
  return warnings;
}

/**
 * Per-section overrides on the UX metric object form. Beyond shape, these catch
 * the two ways an override silently produces a metric that scores zero: a
 * hotspot-scored click section with no hotspots, and a brand_score whose brand
 * choice is never marked.
 */
function validateUxMetricSectionOverrides(
  sections: unknown,
  metricType: string,
  spec: (typeof UX_METRIC_TYPES)[string],
  field: string,
  errors: ValidationError[],
): void {
  if (sections === undefined) return;

  if (!Array.isArray(sections)) {
    errors.push({ question: 0, field: `${field}.sections`, message: 'Must be an array of section override objects' });
    return;
  }

  if (sections.length > spec.section_count) {
    errors.push({
      question: 0,
      field: `${field}.sections`,
      message: `${sections.length} section overrides supplied but ${metricType} has ${spec.section_count} section${spec.section_count === 1 ? '' : 's'}`,
    });
    return;
  }

  const clickSections = spec.click_sections ?? [];

  for (let s = 0; s < sections.length; s++) {
    const overrides = sections[s] as Record<string, unknown> | null;
    const sectionField = `${field}.sections[${s}]`;

    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      errors.push({ question: 0, field: sectionField, message: 'Must be an object' });
      continue;
    }

    if (overrides.hotspots !== undefined) {
      if (!clickSections.includes(s)) {
        errors.push({
          question: 0,
          field: `${sectionField}.hotspots`,
          message: clickSections.length
            ? `hotspots only apply to click test sections — on ${metricType} those are sections[${clickSections.join('], sections[')}]`
            : `hotspots only apply to click test sections, and ${metricType} has none`,
        });
      } else if (!Array.isArray(overrides.hotspots)) {
        errors.push({ question: 0, field: `${sectionField}.hotspots`, message: 'Must be an array of hotspot objects' });
      } else {
        validateHotspots(overrides.hotspots, 0, `${sectionField}.hotspots`, errors);
      }
    }

    if (overrides.choices !== undefined) {
      if (!Array.isArray(overrides.choices)) {
        errors.push({ question: 0, field: `${sectionField}.choices`, message: 'Must be an array of strings' });
      } else {
        validateStringItems(overrides.choices, `${sectionField}.choices`, 0, errors);
        const min = spec.resizable_choice_sections?.[s];
        if (min !== undefined && overrides.choices.length < min) {
          errors.push({
            question: 0,
            field: `${sectionField}.choices`,
            message: `Needs at least ${min} choices`,
          });
        }
      }
    }

    if (overrides.brand_choice !== undefined) {
      if (spec.brand_choice_section !== s) {
        errors.push({
          question: 0,
          field: `${sectionField}.brand_choice`,
          message: spec.brand_choice_section === undefined
            ? `brand_choice only applies to brand_score, not ${metricType}`
            : `brand_choice only applies to the ${metricType} market recognition section (sections[${spec.brand_choice_section}])`,
        });
      } else if (!Number.isInteger(overrides.brand_choice)) {
        errors.push({ question: 0, field: `${sectionField}.brand_choice`, message: 'Must be a 0-based choice index' });
      } else {
        const idx = overrides.brand_choice as number;
        const choiceCount = Array.isArray(overrides.choices) ? overrides.choices.length : undefined;
        if (idx < 0 || (choiceCount !== undefined && idx >= choiceCount)) {
          errors.push({
            question: 0,
            field: `${sectionField}.brand_choice`,
            message: choiceCount === undefined
              ? 'Must be a 0-based index into the section\'s choices'
              : `Must be a 0-based index into this section's ${choiceCount} choices`,
          });
        }
      }
    }
  }

  // Missing hotspots / brand_choice are NOT errors here — the API accepts a
  // metric without them and you can fill them in with edit-question before
  // sending. uxMetricWarnings() surfaces them; `tests validate` is the gate.
}

function validateStringItems(items: unknown[], field: string, questionNum: number, errors: ValidationError[]): void {
  for (let i = 0; i < items.length; i++) {
    if (typeof items[i] !== 'string' || !(items[i] as string).trim()) {
      errors.push({
        question: questionNum,
        field: `${field}[${i}]`,
        message: 'Each item must be a non-empty string',
      });
    }
  }
}

// `standalone` marks a single question being added or edited on an existing
// test, where the array index says nothing about the question's real number.
// Forward-only branching can only be checked when that number is known — from
// the array position on create, or an explicit --position on add-question.
export function validateQuestions(
  questions: unknown,
  opts: { standalone?: boolean } = {},
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(questions)) {
    errors.push({ question: 0, field: 'questions', message: 'Must be a JSON array' });
    return errors;
  }

  if (questions.length === 0) {
    errors.push({ question: 0, field: 'questions', message: 'At least one question is required' });
    return errors;
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] as QuestionInput;
    const num = i + 1;

    if (!q || typeof q !== 'object') {
      errors.push({ question: num, field: 'question', message: 'Must be an object' });
      continue;
    }

    // Type validation
    if (!q.type) {
      errors.push({ question: num, field: 'type', message: 'Required' });
      continue;
    }

    const canonical = TYPE_ALIASES[q.type] ?? q.type;
    const schema = QUESTION_TYPES[canonical as keyof typeof QUESTION_TYPES];

    if (!schema) {
      const creatableTypes = Object.entries(QUESTION_TYPES)
        .filter(([, s]) => s.creatable)
        .map(([k]) => k)
        .join(', ');
      errors.push({
        question: num,
        field: 'type',
        message: `Unknown type "${q.type}". Creatable types: ${creatableTypes}`,
      });
      continue;
    }

    if (!schema.creatable) {
      errors.push({
        question: num,
        field: 'type',
        message: `"${q.type}" can only be created via the UI, not the API`,
      });
      continue;
    }

    // Instructions validation
    if (!q.instructions || typeof q.instructions !== 'string' || !q.instructions.trim()) {
      errors.push({ question: num, field: 'instructions', message: 'Required (non-empty string)' });
    }

    // Legacy followup attrs copied from GET responses don't work on write
    for (const key of LEGACY_FOLLOWUP_KEYS) {
      if (key in q) {
        errors.push({
          question: num,
          field: key,
          message: 'Read-only report field. Use followup: {"question": "...", "required": true, "for_choices": [0]} instead',
        });
      }
    }

    // Type-specific validation
    if (canonical === 'multiple_choice') {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 2 choice strings',
        });
      } else {
        for (let c = 0; c < q.choices.length; c++) {
          if (typeof q.choices[c] !== 'string' || !(q.choices[c] as string).trim()) {
            errors.push({
              question: num,
              field: `choices[${c}]`,
              message: 'Each choice must be a non-empty string',
            });
          }
        }
      }
    }

    if (canonical === 'likert') {
      if (!q.scale_type) {
        errors.push({ question: num, field: 'scale_type', message: `Required. Valid values: ${VALID_SCALE_TYPES.join(', ')}` });
      } else if (!VALID_SCALE_TYPES.includes(q.scale_type)) {
        errors.push({
          question: num,
          field: 'scale_type',
          message: `Invalid "${q.scale_type}". Valid values: ${VALID_SCALE_TYPES.join(', ')}`,
        });
      } else if (q.scale_type === 'custom') {
        if (!Array.isArray(q.custom_choices) || ![4, 5].includes(q.custom_choices.length)) {
          errors.push({
            question: num,
            field: 'custom_choices',
            message: 'Required when scale_type is "custom": array of exactly 4 or 5 labels',
          });
        } else if (!q.custom_choices.every(c => typeof c === 'string' && (c as string).trim())) {
          errors.push({
            question: num,
            field: 'custom_choices',
            message: 'Each custom choice must be a non-empty string',
          });
        }
      }
    }

    if (canonical === 'ranking') {
      if (!Array.isArray(q.choices) || q.choices.length < 3) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 3 choice strings',
        });
      } else {
        validateStringItems(q.choices, 'choices', num, errors);
      }
    }

    if (canonical === 'preference') {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 2 choice strings',
        });
      } else {
        validateStringItems(q.choices, 'choices', num, errors);
      }
    }

    if (canonical === 'matrix') {
      if (!Array.isArray(q.choices) || q.choices.length < 1) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 1 choice string (row labels)',
        });
      } else {
        validateStringItems(q.choices, 'choices', num, errors);
      }
      if (!Array.isArray(q.categories) || q.categories.length < 2) {
        errors.push({
          question: num,
          field: 'categories',
          message: 'Required: array of at least 2 category strings (column labels)',
        });
      } else {
        validateStringItems(q.categories, 'categories', num, errors);
      }
    }

    if (canonical === 'card_sort') {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 2 choice strings (cards)',
        });
      } else {
        validateStringItems(q.choices, 'choices', num, errors);
      }
      if (!Array.isArray(q.categories) || q.categories.length < 2) {
        errors.push({
          question: num,
          field: 'categories',
          message: 'Required: array of at least 2 category strings',
        });
      } else {
        validateStringItems(q.categories, 'categories', num, errors);
      }
    }

    if (canonical === 'point_allocation') {
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 2 choice strings',
        });
      } else {
        validateStringItems(q.choices, 'choices', num, errors);
      }
    }

    if (canonical === 'max_diff') {
      if (!Array.isArray(q.choices) || q.choices.length < 4) {
        errors.push({
          question: num,
          field: 'choices',
          message: 'Required: array of at least 4 choice strings',
        });
      } else {
        validateStringItems(q.choices, 'choices', num, errors);
      }
    }

    if (q.branching !== undefined) {
      const ownNumber = opts.standalone
        ? typeof q.position === 'number'
          ? q.position
          : undefined
        : num;
      validateBranching(q, num, errors, {
        ownNumber,
        // On create, questions are identified by number only and the whole set
        // is known, so both ends of the valid target range are checkable.
        totalQuestions: opts.standalone ? undefined : questions.length,
        allowSectionId: opts.standalone === true,
      });
    }

    if (canonical === 'click_test') {
      if (q.asset_id === undefined || q.asset_id === null || q.asset_id === '') {
        errors.push({
          question: num,
          field: 'asset_id',
          message: 'Required: image asset id (upload via `assets upload`)',
        });
      }
      if (q.hotspots !== undefined) {
        if (!Array.isArray(q.hotspots)) {
          errors.push({ question: num, field: 'hotspots', message: 'Must be an array of hotspot objects' });
        } else {
          validateHotspots(q.hotspots, num, 'hotspots', errors);
        }
      }
    }
  }

  return errors;
}

/**
 * Hotspot geometry, shared by click_test questions and by the click sections a
 * UX metric template generates, so both reject the same malformed rectangles.
 * Coordinates are relative to the image (0-1) and x/y are the top-left corner.
 */
function validateHotspots(
  hotspots: unknown[],
  questionNum: number,
  field: string,
  errors: ValidationError[],
): void {
  for (let h = 0; h < hotspots.length; h++) {
    const hotspot = hotspots[h] as Record<string, unknown>;
    if (!hotspot || typeof hotspot !== 'object' || Array.isArray(hotspot)) {
      errors.push({ question: questionNum, field: `${field}[${h}]`, message: 'Must be an object' });
      continue;
    }

    for (const key of ['x', 'y', 'width', 'height']) {
      const value = hotspot[key];
      if (typeof value !== 'number') {
        errors.push({
          question: questionNum,
          field: `${field}[${h}].${key}`,
          message: 'Required: number relative to the image (0-1)',
        });
      } else if (key === 'x' || key === 'y' ? value < 0 || value > 1 : value <= 0 || value > 1) {
        errors.push({
          question: questionNum,
          field: `${field}[${h}].${key}`,
          message: key === 'x' || key === 'y' ? 'Must be between 0 and 1' : 'Must be greater than 0 and at most 1',
        });
      }
    }

    // The editor confines dragging and resizing to the image, so a rectangle
    // hanging off the edge is a caller error rather than something to clamp.
    const { x, y, width, height } = hotspot as Record<string, number>;
    if ([x, y, width, height].every(v => typeof v === 'number')) {
      if (x + width > 1 || y + height > 1) {
        errors.push({
          question: questionNum,
          field: `${field}[${h}]`,
          message: 'Extends past the image — x + width and y + height must each be at most 1',
        });
      }
    }

    if (hotspot.priority !== undefined && !HOTSPOT_PRIORITIES.includes(hotspot.priority as string)) {
      errors.push({
        question: questionNum,
        field: `${field}[${h}].priority`,
        message: `Must be one of: ${HOTSPOT_PRIORITIES.join(', ')}`,
      });
    }
  }
}

interface BranchingContext {
  ownNumber?: number;
  totalQuestions?: number;
  allowSectionId: boolean;
}

function validateBranching(
  q: QuestionInput,
  num: number,
  errors: ValidationError[],
  ctx: BranchingContext,
): void {
  const { ownNumber, totalQuestions, allowSectionId } = ctx;
  const canonical = TYPE_ALIASES[q.type ?? ''] ?? q.type;
  if (canonical !== 'multiple_choice') {
    errors.push({ question: num, field: 'branching', message: 'Only supported on multiple_choice questions' });
    return;
  }
  if (q.allow_multiple === true) {
    errors.push({ question: num, field: 'branching', message: 'Requires single-select (remove allow_multiple)' });
    return;
  }
  if (q.followup !== undefined) {
    errors.push({ question: num, field: 'branching', message: 'Branching and followup are mutually exclusive' });
    return;
  }
  if (!Array.isArray(q.branching)) {
    errors.push({ question: num, field: 'branching', message: 'Must be an array of branch objects' });
    return;
  }

  const choicesCount = Array.isArray(q.choices) ? q.choices.length : 0;
  const seen = new Set<number>();
  for (let b = 0; b < q.branching.length; b++) {
    const entry = q.branching[b] as Record<string, unknown>;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ question: num, field: `branching[${b}]`, message: 'Must be an object' });
      continue;
    }
    const choice = entry.choice;
    if (typeof choice !== 'number' || choice < 0 || choice >= choicesCount) {
      errors.push({
        question: num,
        field: `branching[${b}].choice`,
        message: `Must be a 0-based choice index (0-${choicesCount - 1})`,
      });
    } else if (seen.has(choice)) {
      errors.push({ question: num, field: `branching[${b}].choice`, message: `Duplicate branch for choice ${choice}` });
    } else {
      seen.add(choice);
    }

    if (!BRANCH_ACTIONS.includes(entry.action as string)) {
      errors.push({
        question: num,
        field: `branching[${b}].action`,
        message: `Must be one of: ${BRANCH_ACTIONS.join(', ')}`,
      });
      continue;
    }
    if (entry.action === 'skip_to_question') {
      const hasQuestion = entry.question !== undefined;
      const hasSectionId = entry.section_id !== undefined;
      if (hasSectionId && !allowSectionId) {
        // Sections don't exist yet at create time, so the API takes question
        // numbers only there.
        errors.push({
          question: num,
          field: `branching[${b}].section_id`,
          message: 'Use question numbers (not section_id) when creating a test',
        });
      } else if (hasQuestion === hasSectionId) {
        errors.push({
          question: num,
          field: `branching[${b}]`,
          message: allowSectionId
            ? 'skip_to_question needs exactly one of question (1-based number) or section_id'
            : 'skip_to_question needs a question (1-based number)',
        });
      } else if (hasQuestion && (typeof entry.question !== 'number' || entry.question < 1)) {
        errors.push({
          question: num,
          field: `branching[${b}].question`,
          message: 'Must be a positive 1-based question number',
        });
      } else if (hasQuestion && ownNumber !== undefined && (entry.question as number) <= ownNumber) {
        const upper = totalQuestions !== undefined ? `${ownNumber + 1}-${totalQuestions}` : `after ${ownNumber}`;
        errors.push({
          question: num,
          field: `branching[${b}].question`,
          message: `Skips are forward-only: must target a later question (${upper}), got ${entry.question}`,
        });
      } else if (
        hasQuestion &&
        totalQuestions !== undefined &&
        (entry.question as number) > totalQuestions
      ) {
        errors.push({
          question: num,
          field: `branching[${b}].question`,
          message: `No question ${entry.question} — this test has ${totalQuestions}`,
        });
      }
      if (entry.message !== undefined || entry.redirect_url !== undefined) {
        errors.push({
          question: num,
          field: `branching[${b}]`,
          message: 'message/redirect_url only apply to end_test',
        });
      }
    }
    if (entry.action === 'end_test' && (entry.question !== undefined || entry.section_id !== undefined)) {
      errors.push({
        question: num,
        field: `branching[${b}]`,
        message: 'question/section_id only apply to skip_to_question',
      });
    }
  }
}

function parseFollowupForChoices(items: string[] | undefined): number[] | undefined {
  if (!items) return undefined;
  return items.map(p => {
    const n = Number(p);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(`--followup-for-choices must be non-negative integers, got "${p}"`);
    }
    return n;
  });
}

interface FollowupFlagOpts {
  followup?: string;
  followupRequired?: boolean;
  followupForChoices?: string[];
}

export function buildFollowupFromFlags(cmdOpts: FollowupFlagOpts): FollowupInput | undefined {
  if (!cmdOpts.followup) {
    if (cmdOpts.followupRequired || cmdOpts.followupForChoices) {
      throw new Error('The --followup-required and --followup-for-choices flags require --followup.');
    }
    return undefined;
  }
  const followup: FollowupInput = { question: cmdOpts.followup };
  if (cmdOpts.followupRequired) followup.required = true;
  const forChoices = parseFollowupForChoices(cmdOpts.followupForChoices);
  if (forChoices) followup.for_choices = forChoices;
  return followup;
}

// Bounds-check --followup-for-choices against the question's own choices when
// they're known client-side (Likert scales resolve server-side, so skip those).
export function assertFollowupChoicesInRange(followup: FollowupInput | undefined, choices: unknown): void {
  if (!followup?.for_choices || !Array.isArray(choices)) return;
  // parseFollowupForChoices already guarantees non-negative integers on the
  // flag path; re-check here so the helper stays safe for any future caller.
  const outOfRange = followup.for_choices.filter(p => !Number.isInteger(p) || p < 0 || p >= choices.length);
  if (outOfRange.length > 0) {
    throw new Error(
      `--followup-for-choices positions out of range for ${choices.length} choices: ${outOfRange.join(', ')}`,
    );
  }
}

export function formatValidationErrors(errors: ValidationError[]): string {
  const lines = errors.map(e => {
    const prefix = e.question > 0 ? `  Question ${e.question}` : '  Questions';
    return `${prefix} → ${e.field}: ${e.message}`;
  });
  return `Validation failed:\n${lines.join('\n')}`;
}

// ── Command registration ─────────────────────────────────────────────

// ── Walkthrough (participant-eye view) ───────────────────────────────

export interface WalkthroughAsset {
  variation_id: string;
  variation_name: string;
  asset_id: number | string | null;
  type: string | null;
  // Upload pipeline state ("processing" | "complete" | …): a processing
  // asset is attached but not yet visible to participants.
  status: string | null;
  url: string | null;
  thumb_url: string | null;
}

export type WalkthroughScreen =
  | { kind: 'intro'; position: number; text: string }
  | {
      kind: 'question';
      position: number;
      q_number: number;
      type: string;            // canonical snake_case (multiple_choice, free_response, …)
      type_label: string;
      raw_type: string;        // original API type (e.g. MultipleChoiceDirectiveSection)
      question: string;
      choices: string[];
      randomize_choices: boolean;
      allow_multiple: boolean;
      scale_type?: string;
      ux_metric?: string;
      site_link?: string;
      assets: WalkthroughAsset[];
      /**
       * Read-back of what `branching` writes; omitted when the section has none.
       * `target_q_number` is added by the CLI: the Q number in THIS screen list
       * that the branch points at. The API's own `question` counts researcher
       * questions only, so it does not match these screen numbers on a test
       * that has UX metric sections.
       */
      branching?: (BranchingData & { target_q_number?: number | null })[];
      /** Click sections only. Empty = engagement heatmap, nothing hotspot-scored. */
      hotspots?: HotspotData[];
      renderable: 'full' | 'placeholder';
    };

const ASSET_HEAVY_RAW_TYPES = new Set([
  'ClickTestDirectiveSection',
  'TreeTestDirectiveSection',
  'PrototypeDirectiveSection',
]);

// Maps API section type → canonical snake_case
const RAW_TYPE_TO_CANONICAL: Record<string, string> = {
  FreeResponseDirectiveSection: 'free_response',
  MultipleChoiceDirectiveSection: 'multiple_choice',
  LikertDirectiveSection: 'likert',
  NpsDirectiveSection: 'nps',
  PreferenceDirectiveSection: 'preference',
  RankingDirectiveSection: 'ranking',
  MatrixDirectiveSection: 'matrix',
  ClickTestDirectiveSection: 'click_test',
  CardSortDirectiveSection: 'card_sort',
  TreeTestDirectiveSection: 'tree_test',
  MaxDiffDirectiveSection: 'max_diff',
  PointAllocationDirectiveSection: 'point_allocation',
  PrototypeDirectiveSection: 'prototype_task',
};

// Endpoints for likert scale visualisations
const LIKERT_LABEL_SETS: Record<string, [string, string]> = {
  agreement: ['Strongly disagree', 'Strongly agree'],
  occurrence: ['Never', 'Always'],
  importance: ['Not important', 'Very important'],
  quality: ['Very poor', 'Very good'],
  comprehension: ['Not at all', 'Completely'],
  impression: ['Very negative', 'Very positive'],
  expectations: ['Far below', 'Far above'],
  usefulness: ['Not useful', 'Very useful'],
  difficulty: ['Very difficult', 'Very easy'],
  likelihood: ['Very unlikely', 'Very likely'],
};

export function buildWalkthroughScreens(test: TestShowResponse): WalkthroughScreen[] {
  const screens: WalkthroughScreen[] = [];
  const intro = stripHtml(test.introduction || '');
  if (intro) {
    screens.push({ kind: 'intro', position: 1, text: intro });
  }

  const sections = [...(test.sections ?? [])].sort((a, b) => a.position - b.position);
  const qIndex = buildQuestionNumberIndex(test.sections);
  let qNumber = 0;
  for (const s of sections) {
    qNumber += 1;
    const canonical = RAW_TYPE_TO_CANONICAL[s.type] ?? s.type;
    const variation = s.variations?.[0];
    const choices = variation?.choices
      ? [...variation.choices].sort((a, b) => a.position - b.position).map(c => c.text)
      : [];

    const uxMetric = (s as { ux_metric?: { metric_type?: string } }).ux_metric?.metric_type;
    const randomize = Boolean((s as { randomize_choices?: unknown }).randomize_choices);
    const allowMultiple = Boolean((s as { allow_multiple?: unknown }).allow_multiple);

    const assets: WalkthroughAsset[] = (s.variations ?? [])
      .filter(v => v.has_asset || v.screenshot_url || v.thumb_url)
      .map(v => ({
        variation_id: v.id,
        variation_name: v.name,
        asset_id: v.asset_id ?? null,
        type: v.asset_type ?? null,
        status: v.asset_status ?? null,
        url: v.screenshot_url ?? null,
        thumb_url: v.thumb_url ?? null,
      }));

    screens.push({
      kind: 'question',
      position: screens.length + 1,
      q_number: qNumber,
      type: canonical,
      type_label: typeLabel(s.type, canonical),
      raw_type: s.type,
      question: s.stripped_instructions || stripHtml(s.instructions || ''),
      choices,
      randomize_choices: randomize,
      allow_multiple: allowMultiple,
      scale_type: s.likert_type || undefined,
      ux_metric: uxMetric,
      site_link: variation?.site_link || undefined,
      assets,
      branching: Array.isArray(s.branching) && s.branching.length
        ? s.branching.map(b => ({ ...b, target_q_number: branchTargetQNumber(b, qIndex) }))
        : undefined,
      hotspots: Array.isArray(s.hotspots) ? s.hotspots : undefined,
      renderable: ASSET_HEAVY_RAW_TYPES.has(s.type) ? 'placeholder' : 'full',
    });
  }

  return screens;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Participants never see hotspot boxes, but a reviewer walking the test needs
 * to know whether the click targets exist — a hotspot-scored metric with none
 * scores zero, and the participant view gives no hint of that.
 */
function hotspotLines(screen: WalkthroughScreen): string[] {
  if (screen.kind !== 'question' || !Array.isArray(screen.hotspots)) return [];

  if (screen.hotspots.length === 0) {
    const scored = screen.ux_metric && UX_METRIC_TYPES[screen.ux_metric]?.hotspot_scored;
    return [
      scored
        ? `  \x1b[33m⚠ no hotspots — ${screen.ux_metric} scores clicks inside hotspots, so this scores zero\x1b[0m`
        : `  \x1b[90mⓘ no hotspots (engagement heatmap)\x1b[0m`,
    ];
  }

  return [
    `  \x1b[90mⓘ ${screen.hotspots.length} hotspot${screen.hotspots.length === 1 ? '' : 's'}: ${screen.hotspots
      .map(h => h.name || `#${h.number}`)
      .join(', ')}\x1b[0m`,
  ];
}

function branchingLines(screen: WalkthroughScreen): string[] {
  if (screen.kind !== 'question' || !screen.branching?.length) return [];

  return [
    '  \x1b[90mⓘ branching:\x1b[0m',
    ...screen.branching.map(b => {
      const from = b.label ? `"${b.label}"` : `${b.source} ${b.index}`;
      const to =
        b.action === 'end_test'
          ? 'end test'
          : b.target_q_number != null
            ? `Q${b.target_q_number}`
            : `section ${b.section_id ?? '?'}`;
      return `  \x1b[90m    ${from} → ${to}\x1b[0m`;
    }),
  ];
}

function stimulusLines(screen: WalkthroughScreen): string[] {
  if (screen.kind !== 'question') return [];
  const lines: string[] = [];
  for (const asset of screen.assets) {
    const url = asset.url ?? asset.thumb_url;
    const label = screen.assets.length > 1 ? `${asset.variation_name}: ` : '';
    const pending = asset.status && asset.status !== 'complete' ? ` (${asset.status})` : '';
    if (url) {
      lines.push(`  \x1b[90m🖼  ${label}${url}${pending}\x1b[0m`);
    } else if (pending) {
      lines.push(`  \x1b[90m🖼  ${label}${asset.type ?? 'asset'} attached${pending} — no URL yet\x1b[0m`);
    }
  }
  if (screen.site_link) {
    lines.push(`  \x1b[90m🔗 ${screen.site_link}\x1b[0m`);
  }
  return lines;
}

export function renderWalkthroughScreen(screen: WalkthroughScreen): string[] {
  const lines: string[] = [];
  if (screen.kind === 'intro') {
    lines.push(`  ${screen.text}`);
    lines.push('');
    lines.push('  [ Start ]');
    return lines;
  }

  lines.push(`  ${screen.question}`);
  if (screen.ux_metric) {
    lines.push(`  \x1b[90m⚲ UX metric: ${screen.ux_metric}\x1b[0m`);
  }
  const stimuli = stimulusLines(screen);
  if (stimuli.length) lines.push(...stimuli);
  lines.push('');

  if (screen.renderable === 'placeholder') {
    const hint =
      screen.type === 'prototype_task'
        ? 'prototype task'
        : screen.type === 'click_test'
          ? 'click test'
          : 'tree test';
    lines.push(`  \x1b[90m🖼  [${hint}] — open in the Helio browser preview to interact\x1b[0m`);
    if (screen.choices.length) {
      for (const c of screen.choices) lines.push(`    · ${c}`);
    }
    lines.push(...hotspotLines(screen));
    lines.push(...branchingLines(screen));
    lines.push('');
    lines.push('  [ Next ]');
    return lines;
  }

  switch (screen.type) {
    case 'multiple_choice': {
      const bullet = screen.allow_multiple ? '☐' : '○';
      for (let i = 0; i < screen.choices.length; i++) {
        lines.push(`    ${LETTERS[i] ?? i + 1}) ${bullet} ${screen.choices[i]}`);
      }
      if (screen.randomize_choices) {
        lines.push('');
        lines.push('  \x1b[90mⓘ choices randomized per participant\x1b[0m');
      }
      if (screen.allow_multiple) {
        lines.push('  \x1b[90mⓘ multiple selections allowed\x1b[0m');
      }
      break;
    }
    case 'free_response': {
      lines.push('  ┌──────────────────────────────────────┐');
      lines.push('  │                                      │');
      lines.push('  │                                      │');
      lines.push('  │                                      │');
      lines.push('  └──────────────────────────────────────┘');
      break;
    }
    case 'likert': {
      const labels = LIKERT_LABEL_SETS[screen.scale_type ?? ''];
      const custom = screen.choices.length ? screen.choices : null;
      if (custom) {
        for (let i = 0; i < custom.length; i++) {
          lines.push(`    ${i + 1}) ○ ${custom[i]}`);
        }
      } else {
        lines.push('    1   2   3   4   5');
        if (labels) {
          lines.push(`    \x1b[90m${labels[0]} → ${labels[1]}\x1b[0m`);
        }
      }
      if (screen.scale_type) {
        lines.push('');
        lines.push(`  \x1b[90mScale: ${screen.scale_type}\x1b[0m`);
      }
      break;
    }
    case 'nps': {
      lines.push('    0   1   2   3   4   5   6   7   8   9   10');
      lines.push('    └─── detractors ────┘ └ passives ┘ └ promoters ─┘');
      break;
    }
    case 'ranking': {
      for (let i = 0; i < screen.choices.length; i++) {
        lines.push(`    ${i + 1}. ⇅ ${screen.choices[i]}`);
      }
      lines.push('');
      lines.push('  \x1b[90m⚏ drag to reorder — open in browser for full view\x1b[0m');
      break;
    }
    case 'preference': {
      for (let i = 0; i < screen.choices.length; i++) {
        lines.push(`    ${LETTERS[i] ?? i + 1}) ⬚ ${screen.choices[i]}`);
      }
      lines.push('');
      lines.push('  \x1b[90m⚏ side-by-side images — open in browser for full view\x1b[0m');
      break;
    }
    case 'matrix':
    case 'card_sort':
    case 'max_diff':
    case 'point_allocation': {
      for (const c of screen.choices) lines.push(`    · ${c}`);
      lines.push('');
      lines.push(`  \x1b[90m⚏ ${screen.type_label.toLowerCase()} layout — open in browser for full view\x1b[0m`);
      break;
    }
    default: {
      for (const c of screen.choices) lines.push(`    · ${c}`);
    }
  }

  // Both render paths get these. The placeholder path returns early, so a
  // screen is never annotated twice — but a click section does NOT reliably
  // take that path (its raw type is "ClickSection", which is not one of the
  // ASSET_HEAVY_RAW_TYPES strings), and a click section with no hotspots is
  // exactly the case worth surfacing.
  lines.push(...hotspotLines(screen));
  lines.push(...branchingLines(screen));
  lines.push('');
  lines.push('  [ Next ]');
  return lines;
}

function walkthroughHeader(screen: WalkthroughScreen, total: number, totalQuestions: number): string {
  const left = `Screen ${screen.position} of ${total}`;
  if (screen.kind === 'intro') return `${left} · Introduction`;
  return `${left} · Q${screen.q_number} of ${totalQuestions} · ${screen.type_label}`;
}

function printWalkthroughHeader(meta: TestMeta, totalQuestions: number): void {
  const title = meta.name ?? meta.id;
  const status = meta.status ? `  ${formatStatus(String(meta.status))}` : '';
  const responses = meta.responses_count ?? 0;
  console.log(`\n\x1b[1m${title}\x1b[0m${status} — ${totalQuestions} question${totalQuestions === 1 ? '' : 's'}, ${responses} response${responses === 1 ? '' : 's'}`);
  if (meta.project_name) {
    const account = meta.account_name ? ` · ${meta.account_name}` : '';
    console.log(`Project: ${meta.project_name}${account}`);
  }
  console.log();
}

function printSeparator(): void {
  console.log('──────────────────────────────────────────');
}

// ── `tests participants` rendering ───────────────────────────────────

// Short, scannable id for headers (full id is always in --output json).
function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 14)}…` : id;
}

function participantDemoSummary(demo: Record<string, unknown> | undefined): string {
  if (!demo) return '';
  return ['age', 'gender', 'country']
    .map(k => demo[k])
    .filter(v => v != null && v !== '')
    .map(String)
    .join(' · ');
}

// sentiment & prototype grade/duration are eventually consistent (async
// workers): null means "not computed yet", NOT neutral. Render it distinctly.
function formatSentiment(sentiment: string | null | undefined): string {
  if (sentiment == null) return '\x1b[90m(sentiment pending)\x1b[0m';
  const colors: Record<string, string> = {
    positive: '\x1b[32m', // green
    negative: '\x1b[31m', // red
    neutral: '\x1b[90m', // gray
  };
  const color = colors[sentiment] ?? '\x1b[90m';
  return `${color}(${sentiment})\x1b[0m`;
}

function formatSelected(selected: JourneyStep['selected']): string {
  if (!selected || selected.length === 0) return '';
  return selected
    .map(s => {
      const text = s.text != null && s.text !== '' ? `"${s.text}"` : '';
      const value = s.value != null && s.value !== '' ? String(s.value) : '';
      if (text && value) return `${text} (${value})`;
      return text || value;
    })
    .filter(Boolean)
    .join(', ');
}

function renderParticipant(p: ReportParticipant, ordinal: number): string[] {
  const lines: string[] = [];
  const idx = p.response_index != null ? `#${p.response_index}` : `#${ordinal}`;
  const badges: string[] = [];
  if (p.flagged) badges.push('\x1b[31m⚑ flagged\x1b[0m');
  if (p.hidden) badges.push('\x1b[90m⦸ hidden\x1b[0m');

  lines.push(`\x1b[1mParticipant ${idx}\x1b[0m  \x1b[90m${shortId(p.participant_id)}\x1b[0m${badges.length ? `  ${badges.join('  ')}` : ''}`);

  const meta: string[] = [];
  if (p.audience_type) meta.push(p.audience_type);
  const demo = participantDemoSummary(p.demographics);
  if (demo) meta.push(demo);
  if (p.response_time_ms != null) meta.push(`${(p.response_time_ms / 1000).toFixed(1)}s`);
  if (meta.length) lines.push(`\x1b[90m${meta.join(' · ')}\x1b[0m`);

  if (p.cohorts && p.cohorts.length) {
    lines.push(`\x1b[90mcohorts: ${p.cohorts.map(c => c.name).join(', ')}\x1b[0m`);
  }

  lines.push('');

  const journey = p.journey ?? [];
  if (journey.length === 0) {
    lines.push('  \x1b[90m(no journey steps)\x1b[0m');
  }
  journey.forEach((step, i) => {
    const label = typeLabel(step.question_type);
    const metric = step.metric ? `  \x1b[90m⚲ ${step.metric}\x1b[0m` : '';
    lines.push(`  \x1b[1mQ${i + 1}.\x1b[0m [${label}]${metric}`);

    if (step.grade != null || step.duration_seconds != null) {
      const parts: string[] = [];
      if (step.grade != null) parts.push(String(step.grade));
      if (step.duration_seconds != null) parts.push(`${step.duration_seconds}s`);
      lines.push(`      ${parts.join(' · ')}`);
    }

    const selected = formatSelected(step.selected);
    if (selected) lines.push(`      answer: ${selected}`);

    if (step.why) {
      lines.push(`      why: "${step.why}"  ${formatSentiment(step.sentiment)}`);
    } else if (step.sentiment !== undefined) {
      // a step that explains a rating but whose why is still empty
      lines.push(`      ${formatSentiment(step.sentiment)}`);
    }
  });

  return lines;
}

type GroupBy = 'cohort' | 'audience_type';

function groupParticipants(
  participants: ReportParticipant[],
  groupBy: GroupBy,
): { label: string; items: ReportParticipant[] }[] {
  const groups = new Map<string, ReportParticipant[]>();
  for (const p of participants) {
    let key: string;
    if (groupBy === 'cohort') {
      // cohorts is 0..n; non-enroll participants get []. Fall back to
      // audience_type + demographics so they still cluster sensibly.
      key = p.cohorts && p.cohorts.length
        ? p.cohorts.map(c => c.name).join(', ')
        : `(no cohort) ${p.audience_type ?? ''} ${participantDemoSummary(p.demographics)}`.trim();
    } else {
      key = p.audience_type ?? '(unknown audience)';
    }
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function runStaticWalkthrough(meta: TestMeta, screens: WalkthroughScreen[]): void {
  const totalQuestions = screens.filter(s => s.kind === 'question').length;
  printWalkthroughHeader(meta, totalQuestions);

  if (screens.length === 0) {
    console.log('  (no screens — test has no introduction and no questions)');
    console.log();
    return;
  }

  for (const screen of screens) {
    printSeparator();
    console.log(` \x1b[1m${walkthroughHeader(screen, screens.length, totalQuestions)}\x1b[0m`);
    printSeparator();
    console.log();
    for (const line of renderWalkthroughScreen(screen)) console.log(line);
    console.log();
  }
}

function inputHint(screen: WalkthroughScreen): string {
  if (screen.kind === 'intro') return '↵ to start';
  if (screen.renderable === 'placeholder') return '↵ to advance (cannot answer in terminal)';
  switch (screen.type) {
    case 'multiple_choice': {
      const max = Math.min(screen.choices.length, LETTERS.length);
      const range = max ? `${LETTERS[0]}–${LETTERS[max - 1]}` : '';
      return screen.allow_multiple
        ? `pick one or more (${range}, comma-separated), or ↵ to skip`
        : `pick ${range}, or ↵ to skip`;
    }
    case 'free_response':
      return 'type a response, or ↵ to skip';
    case 'likert':
      return screen.choices.length
        ? `pick 1–${screen.choices.length}, or ↵ to skip`
        : 'pick 1–5, or ↵ to skip';
    case 'nps':
      return 'pick 0–10, or ↵ to skip';
    case 'ranking':
    case 'preference':
    case 'matrix':
    case 'card_sort':
    case 'max_diff':
    case 'point_allocation':
      return 'type a note about your answer, or ↵ to skip';
    default:
      return '↵ to advance';
  }
}

function interpretAnswer(screen: WalkthroughScreen, raw: string): { ok: true; display: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (screen.kind === 'intro' || screen.renderable === 'placeholder') {
    return { ok: true, display: '' };
  }
  switch (screen.type) {
    case 'multiple_choice': {
      const picks = trimmed.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
      if (picks.length === 0) return { ok: true, display: '' };
      if (!screen.allow_multiple && picks.length > 1) {
        return { ok: false, message: 'This question only accepts one selection.' };
      }
      const labels: string[] = [];
      for (const p of picks) {
        const idx = LETTERS.indexOf(p);
        if (idx < 0 || idx >= screen.choices.length) {
          return { ok: false, message: `"${p}" is not one of the available choices.` };
        }
        labels.push(screen.choices[idx]);
      }
      return { ok: true, display: labels.join(', ') };
    }
    case 'likert': {
      if (!trimmed) return { ok: true, display: '' };
      const n = Number(trimmed);
      const max = screen.choices.length || 5;
      if (!Number.isInteger(n) || n < 1 || n > max) {
        return { ok: false, message: `Pick an integer between 1 and ${max}.` };
      }
      const label = screen.choices[n - 1];
      return { ok: true, display: label ? `${n} (${label})` : String(n) };
    }
    case 'nps': {
      if (!trimmed) return { ok: true, display: '' };
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 0 || n > 10) {
        return { ok: false, message: 'Pick an integer between 0 and 10.' };
      }
      return { ok: true, display: String(n) };
    }
    case 'free_response':
    default:
      return { ok: true, display: trimmed };
  }
}

export async function runInteractiveWalkthrough(meta: TestMeta, screens: WalkthroughScreen[]): Promise<void> {
  const totalQuestions = screens.filter(s => s.kind === 'question').length;
  const answers = new Map<number, string>();

  if (screens.length === 0) {
    printWalkthroughHeader(meta, totalQuestions);
    console.log('  (no screens — test has no introduction and no questions)');
    console.log();
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    let i = 0;
    while (i < screens.length) {
      const screen = screens[i];
      output.write('\x1b[2J\x1b[H');
      printWalkthroughHeader(meta, totalQuestions);
      printSeparator();
      console.log(` \x1b[1m${walkthroughHeader(screen, screens.length, totalQuestions)}\x1b[0m`);
      printSeparator();
      console.log();
      for (const line of renderWalkthroughScreen(screen)) console.log(line);
      console.log();
      const existing = answers.get(screen.position);
      if (existing) {
        console.log(`  \x1b[90mprevious answer: ${existing}\x1b[0m`);
      }
      const backHint = i === 0 ? '' : ' · type "back" to go back';
      console.log(`  \x1b[90m${inputHint(screen)}${backHint} · type "quit" to exit\x1b[0m`);

      const raw = await rl.question('  ▸ ');
      const navKey = raw.trim().toLowerCase();

      if (navKey === 'quit') break;
      if (navKey === 'back') {
        if (i > 0) i -= 1;
        continue;
      }

      const result = interpretAnswer(screen, raw);
      if (!result.ok) {
        console.log(`  \x1b[31m${result.message}\x1b[0m`);
        await rl.question('  ↵ to retry ');
        continue;
      }
      if (result.display) {
        answers.set(screen.position, result.display);
      } else {
        answers.delete(screen.position);
      }
      i += 1;
    }
  } finally {
    rl.close();
  }

  output.write('\x1b[2J\x1b[H');
  printWalkthroughHeader(meta, totalQuestions);
  printSeparator();
  console.log(' \x1b[1mWalkthrough complete (simulated — nothing was sent to Helio)\x1b[0m');
  printSeparator();
  console.log();
  for (const screen of screens) {
    if (screen.kind !== 'question') continue;
    const answer = answers.get(screen.position);
    const label = `Q${screen.q_number}`.padEnd(4);
    console.log(`  ${label} ${answer && answer !== '' ? answer : '\x1b[90m(skipped)\x1b[0m'}`);
  }
  console.log();
}

export function walkthroughScreenJson(screen: WalkthroughScreen): Record<string, unknown> {
  if (screen.kind === 'intro') {
    return { position: screen.position, kind: 'intro', text: screen.text };
  }
  return {
    position: screen.position,
    kind: 'question',
    q_number: screen.q_number,
    type: screen.type,
    type_label: screen.type_label,
    raw_type: screen.raw_type,
    question: screen.question,
    choices: screen.choices,
    randomize_choices: screen.randomize_choices,
    allow_multiple: screen.allow_multiple,
    scale_type: screen.scale_type ?? null,
    ux_metric: screen.ux_metric ?? null,
    site_link: screen.site_link ?? null,
    assets: screen.assets,
    branching: screen.branching ?? null,
    hotspots: screen.hotspots ?? null,
    renderable: screen.renderable,
  };
}

export function registerTestsCommand(program: Command): void {
  const cmd = program.command('tests').alias('t').description('Manage tests');

  cmd
    .command('list')
    .description('List tests')
    .option('--status <status...>', 'Filter by status (paused, running, complete, draft, stopped)')
    .option('--min-responses <n>', 'Minimum response count')
    .option('--max-responses <n>', 'Maximum response count')
    .option('--tags <tags...>', 'Filter by tags')
    .option('--created-after <date>', 'Created on or after (YYYY-MM-DD)')
    .option('--created-before <date>', 'Created on or before (YYYY-MM-DD)')
    .option('--limit <n>', 'Results per page (max 100)', '25')
    .option('--offset <n>', 'Offset for pagination', '0')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {
          limit: cmdOpts.limit,
          offset: cmdOpts.offset,
        };
        if (cmdOpts.status) params.status = cmdOpts.status;
        if (cmdOpts.minResponses) params.min_responses = cmdOpts.minResponses;
        if (cmdOpts.maxResponses) params.max_responses = cmdOpts.maxResponses;
        if (cmdOpts.tags) params.tags = cmdOpts.tags;
        if (cmdOpts.createdAfter) params.created_after = cmdOpts.createdAfter;
        if (cmdOpts.createdBefore) params.created_before = cmdOpts.createdBefore;

        const data = (await client.get('tests', params)) as {
          tests: Record<string, unknown>[];
          pagination: Record<string, unknown>;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.tests, ['id', 'name', 'status', 'responses_count']);
        }
      }),
    );

  cmd
    .command('question-types')
    .description('Show all question types (creatable and read-only)')
    .option('--type <type>', 'Show schema for a specific type')
    .option('--creatable', 'Only show types that can be created via API')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const entries = Object.entries(QUESTION_TYPES).filter(
          ([, schema]) => !cmdOpts.creatable || schema.creatable,
        );

        if (cmdOpts.type) {
          const schema = QUESTION_TYPES[cmdOpts.type as keyof typeof QUESTION_TYPES];
          if (!schema) {
            throw new Error(
              `Unknown type "${cmdOpts.type}". Valid types: ${Object.keys(QUESTION_TYPES).join(', ')}`,
            );
          }
          if (isJsonMode()) {
            printJson({ [cmdOpts.type]: schema });
          } else {
            const tag = schema.creatable ? '\x1b[32mCREATABLE\x1b[0m' : '\x1b[90mREAD-ONLY\x1b[0m';
            console.log(`\x1b[1m${cmdOpts.type}\x1b[0m — ${schema.description}  [${tag}]`);
            if ('also_accepts' in schema) {
              console.log(`Also accepts: "${(schema as { also_accepts: string }).also_accepts}"\n`);
            } else {
              console.log();
            }

            if (schema.creatable && 'required' in schema) {
              console.log(`Required fields: ${schema.required.join(', ')}`);
              if ('optional' in schema && (schema.optional as string[]).length) {
                console.log(`Optional fields: ${(schema.optional as string[]).join(', ')}`);
              }
              if ('scale_types' in schema) {
                console.log(`Scale types: ${(schema as { scale_types: string[] }).scale_types.join(', ')}`);
              }
              console.log(`\nExample:`);
              console.log(JSON.stringify((schema as { example: unknown }).example, null, 2));
              if ('custom_example' in schema) {
                console.log(`\nCustom scale example:`);
                console.log(JSON.stringify((schema as { custom_example: unknown }).custom_example, null, 2));
              }
              console.log();
            }

            console.log(`Summary fields: ${schema.summary_fields}`);
            console.log(`Response fields: ${schema.response_fields}`);
          }
          return;
        }

        if (isJsonMode()) {
          printJson(Object.fromEntries(entries));
        } else {
          const creatableEntries = entries.filter(([, s]) => s.creatable);
          const readOnlyEntries = entries.filter(([, s]) => !s.creatable);

          if (creatableEntries.length) {
            console.log('\x1b[1m── Creatable via API (POST /tests) ──\x1b[0m\n');
            for (const [name, schema] of creatableEntries) {
              const createType = 'also_accepts' in schema ? (schema as { also_accepts: string }).also_accepts : '';
              console.log(`  \x1b[1m${name}\x1b[0m — ${schema.description}`);
              if (createType) console.log(`    Also accepts: "${createType}"`);
              if ('required' in schema) {
                console.log(`    Required: ${schema.required.join(', ')}`);
              }
              if ('optional' in schema && (schema.optional as string[]).length) {
                console.log(`    Optional: ${(schema.optional as string[]).join(', ')}`);
              }
              if ('example' in schema) {
                console.log(`    Example:  ${JSON.stringify((schema as { example: unknown }).example)}`);
              }
              console.log();
            }
          }

          if (readOnlyEntries.length && !cmdOpts.creatable) {
            console.log('\x1b[1m── Read-only (appear in report data, created via UI) ──\x1b[0m\n');
            for (const [name, schema] of readOnlyEntries) {
              console.log(`  \x1b[1m${name}\x1b[0m — ${schema.description}`);
              console.log(`    Summary: ${schema.summary_fields}`);
              console.log(`    Response: ${schema.response_fields}`);
              console.log();
            }
          }
        }
      }),
    );

  cmd
    .command('ux-metric-types')
    .description('Show all UX metric types that can be auto-generated via the API')
    .option('--type <type>', 'Show detail for a specific metric type')
    .action(
      withErrorHandling(async (cmdOpts) => {
        if (cmdOpts.type) {
          const info = UX_METRIC_TYPES[cmdOpts.type];
          if (!info) {
            throw new Error(
              `Unknown metric type "${cmdOpts.type}". Valid types: ${VALID_UX_METRIC_TYPE_NAMES.join(', ')}`,
            );
          }
          if (isJsonMode()) {
            printJson({ [cmdOpts.type]: info });
          } else {
            console.log(`\x1b[1m${cmdOpts.type}\x1b[0m — ${info.description}\n`);
            console.log(`  Sections:     ${info.section_count}`);
            console.log(`  Types:        ${info.section_types}`);
            console.log(`  Instructions: ${info.default_instructions}`);
            if (info.click_sections?.length) {
              console.log(`  Click sections: sections[${info.click_sections.join('], sections[')}] — each needs an image asset_id`);
            }
            if (info.hotspot_scored) {
              console.log('  \x1b[33mScores clicks inside hotspots\x1b[0m — supply hotspots per click section or it scores zero.');
            }
            if (info.brand_choice_section !== undefined) {
              console.log(`  \x1b[33mNeeds brand_choice\x1b[0m — mark which choice is your brand on sections[${info.brand_choice_section}], or it scores zero.`);
            }
            console.log(`\n  Usage:`);
            console.log(`    helio-cli tests create --ux-metrics ${cmdOpts.type} ...`);
            console.log(`    (or --ux-metrics-json for per-metric context and per-section overrides)`);
          }
          return;
        }

        if (isJsonMode()) {
          printJson({ metrics: UX_METRIC_TYPES, excluded: EXCLUDED_UX_METRIC_TYPES });
        } else {
          console.log('\x1b[1m── UX Metrics (auto-generated via --ux-metrics) ──\x1b[0m\n');
          for (const [name, info] of Object.entries(UX_METRIC_TYPES)) {
            const needs: string[] = [];
            if (info.click_sections?.length) needs.push('image + hotspots');
            if (info.brand_choice_section !== undefined) needs.push('brand_choice');
            console.log(`  \x1b[1m${name}\x1b[0m — ${info.description}`);
            console.log(
              `    ${info.section_count} section(s): ${info.section_types}` +
              (needs.length ? `  \x1b[33m[needs ${needs.join(' + ')}]\x1b[0m` : ''),
            );
            console.log();
          }
          console.log('Usage: helio-cli tests create --ux-metrics sentiment loyalty ...');
          console.log('(or --ux-metrics-json \'[{"type":"sentiment","context":"...","sections":[...]}]\' for object form)');
          console.log('\nMetrics marked [needs …] score zero without those overrides — pass them via --ux-metrics-json.');
          console.log('The same type may appear more than once; each instance is scored separately.');
          console.log('\nStill not creatable via the API:');
          for (const [name, reason] of Object.entries(EXCLUDED_UX_METRIC_TYPES)) {
            console.log(`  ${name} — ${reason}`);
          }
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Get test details (accepts UUID or report UUID)')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`tests/${id}`)) as {
          test: Record<string, unknown>;
          account?: { id?: unknown; name?: unknown };
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          const merged = data.account
            ? { account_id: data.account.id, account_name: data.account.name, ...data.test }
            : data.test;
          printKeyValue(merged);
        }
      }),
    );

  cmd
    .command('order <id>')
    .description('Show current question/metric block order (use with reorder)')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`tests/${id}`)) as { test: TestShowResponse };
        const blocks = buildOrderBlocks(data.test.sections ?? []);

        const ambiguous = blocks.filter(b => b.ambiguous);
        const ambiguousTypes = [...new Set(ambiguous.map(b => b.metric_type))];

        if (isJsonMode()) {
          printJson({
            test_id: data.test.id,
            order: blocks.map(b => b.key),
            reorderable: ambiguous.length === 0,
            ...(ambiguous.length
              ? {
                  ambiguous_metric_types: ambiguousTypes,
                  ambiguous_note:
                    'These metric types appear more than once. reorder needs metric:<uuid> to tell the instances apart, and GET /tests/:id does not return metric uuids — take them from the ux_metrics summary in the response to the create/update that added them.',
                }
              : {}),
            blocks: blocks.map((b, i) => ({
              key: b.key,
              label: b.label,
              block_index: i + 1,
              question_number: b.question_number,
              question_count: b.question_count,
              ...(b.ambiguous ? { ambiguous: true } : {}),
            })),
          });
        } else {
          console.log(`\x1b[1m${data.test.name ?? id}\x1b[0m — current order:\n`);
          for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            // Only annotate where block numbering and question numbering
            // actually part ways — otherwise the note is noise on every line.
            const last = b.question_number + b.question_count - 1;
            const qNote =
              b.question_count > 1
                ? `  \x1b[90m(Q${b.question_number}–Q${last})\x1b[0m`
                : i + 1 !== b.question_number
                  ? `  \x1b[90m(Q${b.question_number})\x1b[0m`
                  : '';
            const flag = b.ambiguous ? `  \x1b[33m⚠ needs metric:<uuid>\x1b[0m` : '';
            console.log(`  ${i + 1}. ${b.key}${qNote}${flag}`);
            console.log(`     ${b.label}`);
          }

          if (ambiguous.length) {
            console.log(
              `\n  \x1b[33m⚠\x1b[0m ${ambiguousTypes.join(', ')} appear${ambiguousTypes.length === 1 ? 's' : ''} more than once on this test.`,
            );
            console.log(`    Reorder identifies repeated types by "metric:<uuid>", and \x1b[1mtests get\x1b[0m does not`);
            console.log(`    return metric uuids — take them from the \x1b[1mux_metrics\x1b[0m summary in the response to`);
            console.log(`    the create/add-ux-metrics call that added them. The keys above are shown for reading,`);
            console.log(`    not for pasting.`);
          } else {
            console.log(`\nTo reorder, pass --order with the block keys in your desired order:`);
            console.log(`  helio-cli tests reorder ${id} --order ${blocks.map(b => `"${b.key}"`).join(' ')}`);
          }
        }
      }),
    );

  cmd
    .command('preview <id>')
    .description('Human-readable summary of a test (structure + results if available)')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);

        // Fetch test structure and report data in parallel
        const [testData, reportData] = await Promise.all([
          client.get(`tests/${id}`) as Promise<{ test: TestShowResponse; account?: { id?: number; name?: string } }>,
          client.get(`tests/${id}/report`, { include: 'questions_summary' }).catch(err => {
            if (err instanceof HelioApiError && err.status === 404) return null;
            throw err;
          }) as Promise<ReportResponse | null>,
        ]);

        const test = testData.test;
        const meta = resolveTestMeta(id, test, reportData?.study, testData.account);

        if (isJsonMode()) {
          printJson({
            test: {
              ...meta,
              introduction: test.introduction ?? null,
            },
            questions: reportData?.questions_summary ?? buildQuestionsFromSections(test.sections),
            audience: test.audience ?? null,
            branching: buildBranchingSummary(test.sections),
            hotspots: buildHotspotSummary(test.sections),
          });
          return;
        }

        // Header
        const title = meta.name ?? meta.id;
        const status = meta.status ? `  ${formatStatus(String(meta.status))}` : '';
        console.log(`\n\x1b[1m${title}\x1b[0m${status}`);
        if (meta.project_name) {
          const account = meta.account_name ? ` · ${meta.account_name}` : '';
          console.log(`Project: ${meta.project_name}${account}`);
        }
        const responseCount = meta.responses_count ?? 0;
        console.log(`Responses: ${responseCount}`);
        if (test.introduction) {
          console.log(`Intro: ${test.introduction}`);
        }
        console.log();

        printAudience(test.audience);

        // Questions — prefer report data (has results), fall back to raw sections.
        // Report data carries results but not branching/hotspots, so a launched
        // test still gets those from the sections below.
        if (reportData?.questions_summary?.length) {
          printReportQuestions(reportData.questions_summary);
          printStructureNotes(test.sections);
        } else if (test.sections?.length) {
          printSectionQuestions(test.sections);
        } else {
          console.log('  (no questions)');
        }

        console.log();
      }),
    );

  cmd
    .command('walkthrough <id>')
    .description('Step through a test the way a participant sees it (screen-by-screen)')
    .option('--interactive', 'Prompt one screen at a time instead of dumping all screens')
    .action(
      withErrorHandling(async (id: string, cmdOpts: { interactive?: boolean }) => {
        const client = makeClient(program);
        // The show response lacks name/status/etc — fetch the report in
        // parallel to backfill the header (see resolveTestMeta).
        const [showData, reportData] = await Promise.all([
          client.get(`tests/${id}`) as Promise<{ test: TestShowResponse; account?: { id?: number; name?: string } }>,
          client.get(`tests/${id}/report`).catch(err => {
            if (err instanceof HelioApiError && err.status === 404) return null;
            throw err;
          }) as Promise<{ study?: Record<string, unknown> } | null>,
        ]);
        const test = showData.test;
        const meta = resolveTestMeta(id, test, reportData?.study, showData.account);
        const screens = buildWalkthroughScreens(test);

        if (isJsonMode()) {
          printJson({
            test: meta,
            screens: screens.map(walkthroughScreenJson),
          });
          return;
        }

        if (cmdOpts.interactive) {
          await runInteractiveWalkthrough(meta, screens);
        } else {
          runStaticWalkthrough(meta, screens);
        }
      }),
    );

  cmd
    .command('create')
    .description('Create a new test (draft)')
    .option('--project-id <id>', 'Project UUID')
    .option('--project-name <name>', 'Project name (resolved to UUID)')
    .requiredOption('--name <name>', 'Test name')
    .requiredOption('--intro <text>', 'Introduction text')
    .option('--audience-type <type>', 'Audience type', 'open')
    .option('--audiences <ids...>', 'Audience segment IDs')
    .requiredOption('--target-audience-size <n>', 'Target number of responses')
    .option('--questions <json>', 'Questions as JSON array or @path/to/file.json')
    .option('--ux-metrics <types...>', 'UX metrics to add (auto-generates measurement questions; a type may be repeated, and each instance is scored separately). Click-backed and brand_score metrics need per-section overrides — see --ux-metrics-json.')
    .option(
      '--ux-metrics-json <json>',
      'UX metrics as a JSON array or @path/to/file.json (object form: per-metric context, per-section instructions/assets/followups/hotspots/choices/brand_choice)',
    )
    .option('--ux-metric-context <text>', 'Replace generic nouns in UX metric instructions (e.g. "the Helio dashboard")')
    .option('--dry-run', 'Validate locally without creating the test')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const questions = cmdOpts.questions ? parseJsonOrFile(cmdOpts.questions) : undefined;

        if (cmdOpts.uxMetrics && cmdOpts.uxMetricsJson) {
          throw new Error('Use either --ux-metrics or --ux-metrics-json, not both.');
        }

        let uxMetrics: UxMetricEntry[] | undefined = cmdOpts.uxMetrics;
        if (cmdOpts.uxMetricsJson) {
          uxMetrics = parseJsonArrayFlag(cmdOpts.uxMetricsJson, '--ux-metrics-json') as UxMetricEntry[];
        }

        if (!questions && (!uxMetrics || uxMetrics.length === 0)) {
          throw new Error('Either --questions or --ux-metrics (or both) is required.');
        }

        // Client-side validation
        const errors: ValidationError[] = [];
        if (questions) {
          errors.push(...validateQuestions(questions));
        }
        if (uxMetrics && uxMetrics.length > 0) {
          errors.push(...validateUxMetrics(uxMetrics));
        }
        if (errors.length > 0) {
          if (isJsonMode()) {
            printJson({ valid: false, errors });
          } else {
            console.log(formatValidationErrors(errors));
          }
          return;
        }

        // Only computed once validation has passed — entries are known-good here.
        const uxMetricTypeNames: string[] = (uxMetrics ?? []).map(e =>
          typeof e === 'string' ? e : (e as UxMetricObjectInput).type,
        );

        // Resolve project ID from name if needed
        let projectId: string | undefined = cmdOpts.projectId;
        if (!projectId && cmdOpts.projectName) {
          const client = makeClient(program);
          projectId = await resolveProjectByName(client, cmdOpts.projectName);
        }
        if (!projectId) {
          throw new Error('Either --project-id or --project-name is required.');
        }

        if (cmdOpts.dryRun) {
          const questionCount = questions ? (questions as unknown[]).length : 0;
          const metricSectionCount = uxMetricTypeNames.reduce(
            (sum, m) => sum + (UX_METRIC_TYPES[m]?.section_count ?? 0),
            0,
          );
          const totalSections = questionCount + metricSectionCount;
          const audienceSize = parsePositiveInt(cmdOpts.targetAudienceSize, '--target-audience-size');
          const spend = audienceSize * totalSections;
          const summary: Record<string, unknown> = {
            valid: true,
            name: cmdOpts.name,
            project_id: projectId,
            audience_type: cmdOpts.audienceType ?? 'open',
            target_audience_size: audienceSize,
            question_count: questionCount,
            total_sections: totalSections,
            estimated_answer_spend: spend,
          };
          if (questions) {
            summary.questions = (questions as QuestionInput[]).map((q, i) => ({
              position: i + 1,
              type: TYPE_ALIASES[q.type!] ?? q.type,
              instructions: q.instructions,
            }));
          }
          if (uxMetricTypeNames.length > 0) {
            summary.ux_metrics = (uxMetrics ?? []).map(e => {
              const m = typeof e === 'string' ? e : (e as UxMetricObjectInput).type;
              const entrySummary: Record<string, unknown> = {
                metric_type: m,
                section_count: UX_METRIC_TYPES[m]?.section_count ?? 0,
                section_types: UX_METRIC_TYPES[m]?.section_types ?? 'unknown',
              };
              if (typeof e !== 'string') {
                const obj = e as UxMetricObjectInput;
                if (obj.context) entrySummary.context = obj.context;
                if (obj.sections?.length) entrySummary.section_overrides = obj.sections;
              }
              return entrySummary;
            });
            if (cmdOpts.uxMetricContext) {
              summary.ux_metric_context = cmdOpts.uxMetricContext;
            }
          }
          // Gates the CLI can't check locally, so a clean dry-run can still
          // 400 on create. Called out here rather than discovered at send.
          const warnings: string[] = [];
          if (questions && (questions as QuestionInput[]).some(q => q.branching !== undefined)) {
            warnings.push(
              'Branching requires a Helio Enterprise account. Validation cannot see your plan, so this may still fail with a 400 on create.',
            );
          }
          // Metrics that create fine and measure nothing. `tests validate`
          // refuses to pass these, so surfacing them here saves a round trip.
          warnings.push(...uxMetricWarnings(uxMetrics ?? []));
          if (warnings.length > 0) {
            summary.warnings = warnings;
          }

          if (isJsonMode()) {
            printJson(summary);
          } else {
            console.log(`\x1b[32m✓ Validation passed\x1b[0m\n`);
            console.log(`  Name:          ${summary.name}`);
            console.log(`  Project:       ${projectId}`);
            console.log(`  Audience:      ${audienceSize} (${summary.audience_type})`);
            console.log(`  Questions:     ${questionCount}`);
            if (uxMetricTypeNames.length > 0) {
              console.log(`  UX metrics:    ${uxMetricTypeNames.join(', ')} (${metricSectionCount} auto-generated sections)`);
              if (cmdOpts.uxMetricContext) {
                console.log(`  Metric context: "${cmdOpts.uxMetricContext}" (replaces generic nouns in instructions)`);
              }
            }
            console.log(`  Total sections: ${totalSections}`);
            console.log(`  Est. spend:    ${spend} answers\n`);
            if (questions) {
              for (const q of summary.questions as { position: number; type: string; instructions: string }[]) {
                console.log(`  Q${q.position}. [${q.type}] ${q.instructions}`);
              }
            }
            if (uxMetricTypeNames.length > 0) {
              console.log();
              console.log('  \x1b[1mUX Metrics (auto-generated):\x1b[0m');
              for (const e of uxMetrics ?? []) {
                const m = typeof e === 'string' ? e : (e as UxMetricObjectInput).type;
                const info = UX_METRIC_TYPES[m];
                if (info) {
                  console.log(`    ${m} — ${info.section_count} section(s): ${info.section_types}`);
                }
                if (typeof e !== 'string') {
                  const obj = e as UxMetricObjectInput;
                  if (obj.context) {
                    console.log(`      context: "${obj.context}"`);
                  }
                  obj.sections?.forEach((override, i) => {
                    const keys = Object.keys(override).join(', ');
                    console.log(`      section ${i + 1} overrides: ${keys}`);
                  });
                }
              }
            }
            for (const w of warnings) {
              console.log(`\n  \x1b[33m⚠\x1b[0m ${w}`);
            }
            console.log(`\nRun without --dry-run to create the test.`);
          }
          return;
        }

        const client = makeClient(program);
        const body: Record<string, unknown> = {
          project_id: projectId,
          name: cmdOpts.name,
          intro: cmdOpts.intro,
          audience_type: cmdOpts.audienceType,
          target_audience_size: parsePositiveInt(cmdOpts.targetAudienceSize, '--target-audience-size'),
        };
        if (questions) body.questions = questions;
        if (uxMetrics && uxMetrics.length > 0) body.ux_metrics = uxMetrics;
        if (cmdOpts.uxMetricContext) body.ux_metric_context = cmdOpts.uxMetricContext;
        if (cmdOpts.audiences) body.audiences = cmdOpts.audiences;

        const data = await client.post('tests', body);
        const metricWarnings = uxMetricWarnings(uxMetrics ?? []);
        if (isJsonMode()) {
          printJson(metricWarnings.length ? { ...(data as object), warnings: metricWarnings } : data);
        } else {
          printKeyValue(data as Record<string, unknown>);
          for (const w of metricWarnings) {
            console.log(`\n  \x1b[33m⚠\x1b[0m ${w}`);
          }
        }
      }),
    );

  cmd
    .command('add-question <id>')
    .description('Add a question to an existing draft test')
    .requiredOption('--type <type>', 'Question type: free_response, multiple_choice, likert, nps, ranking, preference, matrix, card_sort, point_allocation, max_diff, click_test')
    .requiredOption('--instructions <text>', 'Question text')
    .option('--choices <items...>', 'Choices (for multiple_choice, ranking, preference, matrix, card_sort, point_allocation, max_diff)')
    .option('--scale-type <scale>', 'Scale type (for likert)')
    .option('--custom-choices <items...>', 'Custom scale labels (for likert with scale_type=custom)')
    .option('--allow-multiple', 'Allow multiple selections (for multiple_choice)')
    .option('--randomize-choices', 'Randomize choice order (for multiple_choice)')
    .option('--categories <items...>', 'Categories (for matrix, card_sort)')
    .option('--points <n>', 'Total points to allocate (for point_allocation)')
    .option('--points-label <label>', 'Label for points (for point_allocation)')
    .option('--random-category-order', 'Randomize category order (for card_sort)')
    .option('--can-skip-cards', 'Allow skipping cards (for card_sort)')
    .option('--asset-id <id>', 'Asset ID (stimulus image; required for click_test)')
    .option('--site-link <url>', 'Site link URL (for free_response stimulus)')
    .option('--hotspots <json>', 'Hotspots as JSON array or @path/to/file.json (for click_test): [{name?, x, y, width, height, priority?}]')
    .option('--branching <json>', 'Branching as JSON array or @file (single-select multiple_choice; requires a Helio Enterprise account): [{choice, action: skip_to_question|end_test, question?|section_id?, message?, redirect_url?}]. Skips are forward-only.')
    .option('--position <n>', 'Insert at this 1-based position (appends if omitted)')
    .option('--followup <text>', 'Follow-up question text')
    .option('--followup-required', 'Mark the follow-up as required')
    .option('--followup-for-choices <positions...>', '0-based choice positions that trigger the follow-up')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        // Build question object from flags
        const question: QuestionInput = {
          type: cmdOpts.type,
          instructions: cmdOpts.instructions,
        };
        if (cmdOpts.choices) question.choices = cmdOpts.choices;
        if (cmdOpts.scaleType) question.scale_type = cmdOpts.scaleType;
        if (cmdOpts.customChoices) question.custom_choices = cmdOpts.customChoices;
        if (cmdOpts.allowMultiple) question.allow_multiple = true;
        if (cmdOpts.randomizeChoices) question.randomize_choices = true;
        if (cmdOpts.categories) question.categories = cmdOpts.categories;
        if (cmdOpts.points) question.points = parsePositiveInt(cmdOpts.points, '--points');
        if (cmdOpts.pointsLabel) question.points_label = cmdOpts.pointsLabel;
        if (cmdOpts.randomCategoryOrder) question.random_category_order = true;
        if (cmdOpts.canSkipCards) question.can_skip_cards = true;
        if (cmdOpts.assetId) question.asset_id = cmdOpts.assetId;
        if (cmdOpts.siteLink) question.site_link = cmdOpts.siteLink;
        if (cmdOpts.hotspots) question.hotspots = parseJsonOrFile(cmdOpts.hotspots) as unknown[];
        if (cmdOpts.branching) question.branching = parseJsonOrFile(cmdOpts.branching) as unknown[];
        if (cmdOpts.position) question.position = parsePositiveInt(cmdOpts.position, '--position');
        const followup = buildFollowupFromFlags(cmdOpts);
        assertFollowupChoicesInRange(followup, question.choices);
        if (followup) question.followup = followup;

        // Validate the single question
        const errors = validateQuestions([question], { standalone: true });
        if (errors.length > 0) {
          if (isJsonMode()) {
            printJson({ valid: false, errors });
          } else {
            console.log(formatValidationErrors(errors));
          }
          return;
        }

        const client = makeClient(program);
        const data = await client.post(`tests/${id}/questions/add_question`, question);
        if (isJsonMode()) {
          // Faithful passthrough. Note that on the append path the API's
          // `position` is screen-based (question number + 1, counting the
          // intro card) and does NOT round-trip into --position. Tracked
          // upstream in zurb/helio.
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Added ${cmdOpts.type} question to test ${id}`);
          const shown = { ...(data as Record<string, unknown>) };
          if (question.position == null && 'position' in shown) {
            // Appending: suppress rather than print a number that looks like a
            // --position value but isn't one.
            delete shown.position;
          }
          printKeyValue(shown);
          if (question.position == null) {
            console.log(
              `  \x1b[90mappended to the end — re-run \x1b[0mtests order\x1b[90m for question numbers\x1b[0m`,
            );
          }
        }
      }),
    );

  cmd
    .command('edit-question <test-id> <section-id>')
    .description('Replace a question on a draft test (or edit instructions/assets/choices/hotspots/brand-choice/randomize/follow-ups on a UX metric section)')
    .option('--type <type>', 'Question type (required for regular questions, omit for UX metric sections)')
    .option('--instructions <text>', 'Question text')
    .option('--choices <items...>', 'Choices')
    .option('--scale-type <scale>', 'Scale type (for likert)')
    .option('--custom-choices <items...>', 'Custom scale labels')
    .option('--allow-multiple', 'Allow multiple selections')
    .option('--randomize-choices', 'Randomize choice order')
    .option('--no-randomize-choices', 'Disable randomized choice order')
    .option('--categories <items...>', 'Categories')
    .option('--points <n>', 'Total points')
    .option('--points-label <label>', 'Label for points')
    .option('--random-category-order', 'Randomize category order')
    .option('--can-skip-cards', 'Allow skipping cards')
    .option('--asset-id <id>', 'Asset ID (stimulus image)')
    .option('--site-link <url>', 'Site link URL (stimulus)')
    .option('--hotspots <json>', 'Hotspots as JSON array or @path/to/file.json, for a click_test question or a click section of a UX metric: [{name?, x, y, width, height, priority?}]. Replaces the existing set.')
    .option('--brand-choice <index>', '0-based index of the choice that is your brand (brand_score market recognition section only)')
    .option('--branching <json>', 'Branching as JSON array or @file (single-select multiple_choice; requires a Helio Enterprise account): [{choice, action: skip_to_question|end_test, question?|section_id?, message?, redirect_url?}]. Skips are forward-only.')
    .option('--followup <text>', 'Follow-up question text')
    .option('--followup-required', 'Mark the follow-up as required')
    .option('--followup-for-choices <positions...>', '0-based choice positions that trigger the follow-up')
    .option('--remove-followup', 'Remove the existing follow-up from this question')
    .action(
      withErrorHandling(async (testId: string, sectionId: string, cmdOpts) => {
        if (cmdOpts.removeFollowup && cmdOpts.followup) {
          throw new Error('Use either --followup or --remove-followup, not both.');
        }
        if (cmdOpts.removeFollowup && (cmdOpts.followupRequired || cmdOpts.followupForChoices)) {
          throw new Error('--remove-followup cannot be combined with --followup-required or --followup-for-choices.');
        }

        const question: QuestionInput = {};
        if (cmdOpts.type) question.type = cmdOpts.type;
        if (cmdOpts.instructions) question.instructions = cmdOpts.instructions;
        if (cmdOpts.choices) question.choices = cmdOpts.choices;
        if (cmdOpts.scaleType) question.scale_type = cmdOpts.scaleType;
        if (cmdOpts.customChoices) question.custom_choices = cmdOpts.customChoices;
        if (cmdOpts.allowMultiple) question.allow_multiple = true;
        if (cmdOpts.randomizeChoices !== undefined) question.randomize_choices = cmdOpts.randomizeChoices;
        if (cmdOpts.categories) question.categories = cmdOpts.categories;
        if (cmdOpts.points) question.points = parsePositiveInt(cmdOpts.points, '--points');
        if (cmdOpts.pointsLabel) question.points_label = cmdOpts.pointsLabel;
        if (cmdOpts.randomCategoryOrder) question.random_category_order = true;
        if (cmdOpts.canSkipCards) question.can_skip_cards = true;
        if (cmdOpts.assetId) question.asset_id = cmdOpts.assetId;
        if (cmdOpts.siteLink) question.site_link = cmdOpts.siteLink;
        if (cmdOpts.hotspots) question.hotspots = parseJsonOrFile(cmdOpts.hotspots) as unknown[];
        if (cmdOpts.brandChoice !== undefined) {
          const parsed = Number(cmdOpts.brandChoice);
          if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error('--brand-choice must be a 0-based choice index (a non-negative integer).');
          }
          question.brand_choice = parsed;
        }
        if (cmdOpts.branching) question.branching = parseJsonOrFile(cmdOpts.branching) as unknown[];
        if (cmdOpts.removeFollowup) {
          question.followup = { remove: true };
        } else {
          const followup = buildFollowupFromFlags(cmdOpts);
          assertFollowupChoicesInRange(followup, question.choices);
          if (followup) question.followup = followup;
        }

        // If type is provided, this is a full question replacement — validate normally
        if (question.type) {
          if (!question.instructions) {
            throw new Error('--instructions is required when --type is provided.');
          }
          // Only a UX metric section carries a brand choice, and --type means a
          // regular question. The API would drop this silently, leaving the
          // caller believing they marked a brand.
          if (question.brand_choice !== undefined) {
            throw new Error(
              '--brand-choice applies only to a UX metric section, which is the mode entered by omitting --type. Drop --type, or drop --brand-choice.',
            );
          }
          const errors = validateQuestions([question], { standalone: true });
          if (errors.length > 0) {
            if (isJsonMode()) {
              printJson({ valid: false, errors });
            } else {
              console.log(formatValidationErrors(errors));
            }
            return;
          }
        } else {
          // UX metric section edit — reject structural flags
          const structuralFlags: [string, string][] = [
            ['scale_type', '--scale-type'],
            ['custom_choices', '--custom-choices'],
            ['allow_multiple', '--allow-multiple'],
            ['categories', '--categories'],
            ['points', '--points'],
            ['points_label', '--points-label'],
            ['random_category_order', '--random-category-order'],
            ['can_skip_cards', '--can-skip-cards'],
            ['branching', '--branching'],
          ];
          const present = structuralFlags
            .filter(([key]) => (question as Record<string, unknown>)[key] !== undefined)
            .map(([, flag]) => flag);
          if (present.length > 0) {
            throw new Error(`Structural flags not allowed without --type (UX metric sections only support safe edits): ${present.join(', ')}`);
          }
          // hotspots and brand_choice are safe on a metric section: both target
          // what the metric scores against, not the section's structure. The
          // API rejects hotspots on a non-click section and brand_choice
          // anywhere but brand_score's market recognition section.
          if (question.hotspots !== undefined) {
            const hotspotErrors: ValidationError[] = [];
            if (!Array.isArray(question.hotspots)) {
              // validateHotspots reads .length, so a non-array would loop zero
              // times and report nothing — guard before, as the --type path does.
              hotspotErrors.push({ question: 0, field: 'hotspots', message: 'Must be an array of hotspot objects' });
            } else {
              validateHotspots(question.hotspots, 0, 'hotspots', hotspotErrors);
            }
            if (hotspotErrors.length > 0) {
              if (isJsonMode()) {
                printJson({ valid: false, errors: hotspotErrors });
              } else {
                console.log(formatValidationErrors(hotspotErrors));
              }
              return;
            }
          }
          // At least one safe field must be provided
          if (
            !question.instructions &&
            !question.asset_id &&
            !question.site_link &&
            !question.choices &&
            question.hotspots === undefined &&
            question.brand_choice === undefined &&
            question.randomize_choices === undefined &&
            !question.followup
          ) {
            throw new Error(
              'Provide at least one of --instructions, --asset-id, --site-link, --choices, --hotspots, --brand-choice, --randomize-choices, --followup, or --remove-followup.',
            );
          }
        }

        const client = makeClient(program);
        const data = await client.patch(`tests/${testId}/questions/${sectionId}/update_question`, question);
        if (isJsonMode()) {
          printJson(data);
        } else {
          const verb = question.type ? 'Replaced' : 'Updated';
          console.log(`\x1b[32m✓\x1b[0m ${verb} question ${sectionId} on test ${testId}`);
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('remove-question <test-id> <section-id>')
    .description('Remove a question from a draft test')
    .action(
      withErrorHandling(async (testId: string, sectionId: string) => {
        const client = makeClient(program);
        const data = await client.delete(`tests/${testId}/questions/${sectionId}/remove_question`);
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Removed question ${sectionId} from test ${testId}`);
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('add-ux-metrics <id>')
    .description('Add UX metrics to an existing draft test')
    .option('--metrics <types...>', 'UX metric types to add')
    .option(
      '--metrics-json <json>',
      'UX metrics as a JSON array or @path/to/file.json (object form: per-metric context, per-section instructions/assets/followups/hotspots/choices/brand_choice)',
    )
    .option('--ux-metrics <types...>', 'Alias for --metrics (matches tests create)')
    .option('--ux-metrics-json <json>', 'Alias for --metrics-json (matches tests create)')
    .option('--position <n>', 'Insert the metric block at this 1-based position (appends if omitted)')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const metricsFlag = cmdOpts.metrics ?? cmdOpts.uxMetrics;
        const metricsJsonFlag = cmdOpts.metricsJson ?? cmdOpts.uxMetricsJson;
        if (metricsFlag && metricsJsonFlag) {
          throw new Error('Use either --metrics or --metrics-json, not both.');
        }
        if (!metricsFlag && !metricsJsonFlag) {
          throw new Error('Provide --metrics or --metrics-json.');
        }

        let metrics: UxMetricEntry[];
        if (metricsJsonFlag) {
          metrics = parseJsonArrayFlag(metricsJsonFlag, '--metrics-json') as UxMetricEntry[];
        } else {
          metrics = metricsFlag;
        }

        const errors = validateUxMetrics(metrics);
        if (errors.length > 0) {
          if (isJsonMode()) {
            printJson({ valid: false, errors });
          } else {
            console.log(formatValidationErrors(errors));
          }
          return;
        }

        const body: Record<string, unknown> = { add_ux_metrics: metrics };
        if (cmdOpts.position) {
          body.add_ux_metrics_position = parsePositiveInt(cmdOpts.position, '--position');
        }

        const metricLabel = metrics
          .map(m => (typeof m === 'string' ? m : (m as UxMetricObjectInput).type))
          .join(', ');

        const client = makeClient(program);
        const data = await client.patch(`tests/${id}`, body);
        const metricWarnings = uxMetricWarnings(metrics);
        if (isJsonMode()) {
          printJson(metricWarnings.length ? { ...(data as object), warnings: metricWarnings } : data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Added UX metrics to test ${id}: ${metricLabel}`);
          for (const w of metricWarnings) {
            console.log(`  \x1b[33m⚠\x1b[0m ${w}`);
          }
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('remove-ux-metrics <id>')
    .description('Remove UX metrics from an existing draft test (by type, or by metric id to target one instance)')
    .option('--metrics <ids...>', 'UX metric types or metric ids to remove. A type removes every instance of it; a metric id (from the ux_metrics summary) removes just that one.')
    .option('--ux-metrics <ids...>', 'Alias for --metrics (matches tests create)')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const metrics: string[] | undefined = cmdOpts.metrics ?? cmdOpts.uxMetrics;
        if (!metrics) {
          throw new Error('Provide --metrics (or --ux-metrics).');
        }

        // Basic validation — just check entries are strings
        const errors: ValidationError[] = [];
        for (let i = 0; i < metrics.length; i++) {
          if (typeof metrics[i] !== 'string' || !metrics[i].trim()) {
            errors.push({ question: 0, field: `metrics[${i}]`, message: 'Each metric type must be a non-empty string' });
          }
        }
        if (errors.length > 0) {
          if (isJsonMode()) {
            printJson({ valid: false, errors });
          } else {
            console.log(formatValidationErrors(errors));
          }
          return;
        }

        const client = makeClient(program);

        // Removing sections resets any branch pointing into them, server-side
        // and silently. Warn first so the loss is visible to the caller.
        let branchingReset = false;
        try {
          const show = (await client.get(`tests/${id}`)) as { test: Record<string, unknown> };
          branchingReset = show.test?.has_branching === true;
        } catch {
          // Non-fatal: the removal itself is the operation that matters.
        }

        const data = await client.patch(`tests/${id}`, { remove_ux_metrics: metrics });
        if (isJsonMode()) {
          printJson(branchingReset ? { ...(data as object), branching_reset: true } : data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Removed UX metrics from test ${id}: ${metrics.join(', ')}`);
          if (branchingReset) {
            console.log(
              `  \x1b[33m⚠\x1b[0m This test had branching. Branches targeting removed sections were reset — re-check with \x1b[1mtests get ${id}\x1b[0m.`,
            );
          }
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('reorder <id>')
    .description('Reorder questions and UX metric groups on a draft test')
    .requiredOption('--order <blocks...>', 'Ordered block references: "section:<uuid-or-id>", or "metric:<type>" / "metric:<uuid>". A type that is on the test more than once must be given as metric:<uuid> (from the ux_metrics summary) — metric:<type> is ambiguous and rejected.')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const order: string[] = cmdOpts.order;

        // Client-side validation
        const errors: ValidationError[] = [];
        for (let i = 0; i < order.length; i++) {
          const entry = order[i];
          if (!entry.match(/^section:.+$/) && !entry.match(/^metric:.+$/)) {
            errors.push({
              question: 0,
              field: `order[${i}]`,
              message: `Invalid block "${entry}". Must be "section:<uuid-or-id>" or "metric:<type>"`,
            });
          }
        }
        const seen = new Set<string>();
        for (let i = 0; i < order.length; i++) {
          if (seen.has(order[i])) {
            errors.push({ question: 0, field: `order[${i}]`, message: `Duplicate block "${order[i]}"` });
          }
          seen.add(order[i]);
        }
        if (errors.length > 0) {
          if (isJsonMode()) {
            printJson({ valid: false, errors });
          } else {
            console.log(formatValidationErrors(errors));
          }
          return;
        }

        const client = makeClient(program);
        const data = await client.patch(`tests/${id}`, { reorder: order });
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Reordered test ${id}`);
          const result = data as Record<string, unknown>;
          if (Array.isArray(result.order)) {
            console.log('\nNew order:');
            for (let i = 0; i < result.order.length; i++) {
              console.log(`  ${i + 1}. ${result.order[i]}`);
            }
          }
        }
      }),
    );

  cmd
    .command('send <id>')
    .description('Launch a draft test')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = await client.post(`tests/${id}/send_test`);
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('validate <id>')
    .description('Check if a test is ready to launch')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`tests/${id}/validate`)) as {
          valid: boolean;
          launch_blockers: { type: string; field?: string; message: string }[];
          estimated_spend: number;
          answers_remaining: number;
          status: string;
          question_count: number;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          if (data.valid) {
            console.log(`\x1b[32m✓ Ready to launch\x1b[0m`);
            console.log(`  Status:     ${data.status}`);
            console.log(`  Questions:  ${data.question_count}`);
            console.log(`  Est. spend: ${data.estimated_spend} answers`);
            console.log(`  Available:  ${data.answers_remaining} answers`);
          } else {
            console.log(`\x1b[33m✗ Not ready to launch\x1b[0m\n`);
            for (const b of data.launch_blockers) {
              console.log(`  - ${b.message}`);
            }
            console.log();
            console.log(`  Questions:  ${data.question_count}`);
            console.log(`  Est. spend: ${data.estimated_spend} answers`);
            console.log(`  Available:  ${data.answers_remaining} answers`);
          }
        }
      }),
    );

  cmd
    .command('update <id>')
    .description('Update a draft test')
    .option('--name <name>', 'New test name')
    .option('--intro <text>', 'New introduction text')
    .option('--target-audience-size <n>', 'New target audience size')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const body: Record<string, unknown> = {};
        if (cmdOpts.name) body.name = cmdOpts.name;
        if (cmdOpts.intro) body.intro = cmdOpts.intro;
        if (cmdOpts.targetAudienceSize) body.target_audience_size = parsePositiveInt(cmdOpts.targetAudienceSize, '--target-audience-size');

        if (Object.keys(body).length === 0) {
          throw new Error('At least one field is required: --name, --intro, or --target-audience-size');
        }

        const data = await client.patch(`tests/${id}`, body);
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Test updated`);
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('clone <id>')
    .description('Clone a test into a new draft (copies questions, UX metrics, branching, and audience)')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.post(`tests/${id}/clone`)) as {
          test_id: string;
          source_test_id: string;
          name: string;
          status: string;
          project_id: string | null;
          question_count: number;
          preview_test_url: string;
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Cloned test ${data.source_test_id}`);
          printKeyValue(data as unknown as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('delete <id>')
    .description('Delete a draft test')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = await client.delete(`tests/${id}`);
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Test deleted`);
        }
      }),
    );

  cmd
    .command('responses <id>')
    .description('Get all responses for a test')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`tests/${id}/responses`)) as {
          responses: Record<string, unknown>[];
        };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printTable(data.responses, ['id', 'name', 'email', 'created_at']);
        }
      }),
    );

  cmd
    .command('report <id>')
    .description('Get aggregated report data')
    .option(
      '--include <values>',
      'Comma-separated: questions_summary,questions_followups,questions_responses,audiences_summary,demographics,ux_metrics,prototype_journeys,participants,filter_options',
      'questions_summary',
    )
    .option('--limit <n>', 'Limit for questions_responses')
    .option('--offset <n>', 'Offset for questions_responses')
    .option('--section-id <id>', 'Filter to a specific section')
    .option('--age <values...>', 'Filter by age brackets')
    .option('--gender <values...>', 'Filter by gender')
    .option('--country <values...>', 'Filter by country')
    .option('--state <values...>', 'Filter by state')
    .option('--city <values...>', 'Filter by city')
    .option('--income <values...>', 'Filter by income')
    .option('--education <values...>', 'Filter by education')
    .option('--company <values...>', 'Filter by company')
    .option('--sentiment <values...>', 'Filter by sentiment')
    .option('--segment-id <values...>', 'Filter by audience segment ID')
    .option('--response-time <values...>', 'Filter by response time')
    .option('--hidden <bool>', 'Filter by hidden status')
    .option('--flagged <bool>', 'Filter by flagged status')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = {
          include: cmdOpts.include,
        };
        if (cmdOpts.limit) params.limit = cmdOpts.limit;
        if (cmdOpts.offset) params.offset = cmdOpts.offset;
        if (cmdOpts.sectionId) params.section_id = cmdOpts.sectionId;
        if (cmdOpts.age) params.age = cmdOpts.age;
        if (cmdOpts.gender) params.gender = cmdOpts.gender;
        if (cmdOpts.country) params.country = cmdOpts.country;
        if (cmdOpts.state) params.state = cmdOpts.state;
        if (cmdOpts.city) params.city = cmdOpts.city;
        if (cmdOpts.income) params.income = cmdOpts.income;
        if (cmdOpts.education) params.education = cmdOpts.education;
        if (cmdOpts.company) params.company = cmdOpts.company;
        if (cmdOpts.sentiment) params.sentiment = cmdOpts.sentiment;
        if (cmdOpts.segmentId) params.segment_id = cmdOpts.segmentId;
        if (cmdOpts.responseTime) params.response_time = cmdOpts.responseTime;
        if (cmdOpts.hidden) params.hidden = cmdOpts.hidden;
        if (cmdOpts.flagged) params.flagged = cmdOpts.flagged;

        const data = await client.get(`tests/${id}/report`, params);
        // Report data is complex nested JSON — always output as JSON
        printJson(data);
      }),
    );

  cmd
    .command('participants <id>')
    .description("Per-respondent journeys: each person's answers stitched together in order")
    .option('--participant <rsp_id>', 'Show only one respondent (matches participant_id)')
    .option('--group-by <field>', 'Group respondents by: cohort or audience_type')
    .option('--limit <n>', 'Show at most N respondents (applied client-side)')
    .option('--offset <n>', 'Skip the first N respondents (applied client-side)')
    .option('--age <values...>', 'Filter by age brackets')
    .option('--gender <values...>', 'Filter by gender')
    .option('--country <values...>', 'Filter by country')
    .option('--state <values...>', 'Filter by state')
    .option('--city <values...>', 'Filter by city')
    .option('--income <values...>', 'Filter by income')
    .option('--education <values...>', 'Filter by education')
    .option('--company <values...>', 'Filter by company')
    .option('--sentiment <values...>', 'Filter by sentiment')
    .option('--segment-id <values...>', 'Filter by audience segment ID')
    .option('--response-time <values...>', 'Filter by response time')
    .option('--hidden <bool>', 'Filter by hidden status')
    .option('--flagged <bool>', 'Filter by flagged status')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const client = makeClient(program);
        const params: Record<string, unknown> = { include: 'participants' };
        if (cmdOpts.age) params.age = cmdOpts.age;
        if (cmdOpts.gender) params.gender = cmdOpts.gender;
        if (cmdOpts.country) params.country = cmdOpts.country;
        if (cmdOpts.state) params.state = cmdOpts.state;
        if (cmdOpts.city) params.city = cmdOpts.city;
        if (cmdOpts.income) params.income = cmdOpts.income;
        if (cmdOpts.education) params.education = cmdOpts.education;
        if (cmdOpts.company) params.company = cmdOpts.company;
        if (cmdOpts.sentiment) params.sentiment = cmdOpts.sentiment;
        if (cmdOpts.segmentId) params.segment_id = cmdOpts.segmentId;
        if (cmdOpts.responseTime) params.response_time = cmdOpts.responseTime;
        if (cmdOpts.hidden) params.hidden = cmdOpts.hidden;
        if (cmdOpts.flagged) params.flagged = cmdOpts.flagged;

        const data = (await client.get(`tests/${id}/report`, params)) as ParticipantsReportResponse;
        let participants = data.participants ?? [];

        if (cmdOpts.participant) {
          participants = participants.filter(p => p.participant_id === cmdOpts.participant);
        }
        // Pagination is applied client-side over the returned array so the
        // result is predictable regardless of server-side scoping.
        const offset = cmdOpts.offset ? Number(cmdOpts.offset) : 0;
        if (offset) participants = participants.slice(offset);
        if (cmdOpts.limit) participants = participants.slice(0, Number(cmdOpts.limit));

        if (isJsonMode()) {
          printJson({ study: data.study, participants });
          return;
        }

        if (participants.length === 0) {
          console.log('No participants. (Report may still be processing, or filters matched nobody.)');
          return;
        }

        const groupBy: GroupBy | undefined =
          cmdOpts.groupBy === 'cohort' || cmdOpts.groupBy === 'audience_type'
            ? cmdOpts.groupBy
            : undefined;

        console.log(`\n\x1b[1m${participants.length} participant${participants.length === 1 ? '' : 's'}\x1b[0m`);

        if (groupBy) {
          for (const group of groupParticipants(participants, groupBy)) {
            console.log(`\n\x1b[36m■ ${group.label}\x1b[0m  \x1b[90m(${group.items.length})\x1b[0m`);
            group.items.forEach((p, i) => {
              console.log();
              for (const line of renderParticipant(p, i + 1)) console.log(line);
            });
          }
        } else {
          participants.forEach((p, i) => {
            console.log();
            printSeparator();
            for (const line of renderParticipant(p, i + 1)) console.log(line);
          });
        }
      }),
    );
}
