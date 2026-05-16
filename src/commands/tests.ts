import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolveCredentials } from '../config.js';
import { HelioClient } from '../client.js';
import { isJsonMode, printJson, printTable, printKeyValue, withErrorHandling, parseJsonOrFile } from '../output.js';
import { HelioApiError } from '../types.js';
import type { GlobalOptions } from '../types.js';

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
    optional: ['allow_multiple', 'randomize_choices'],
    example: {
      type: 'multiple_choice',
      instructions: 'How did you hear about us?',
      choices: ['Search engine', 'Social media', 'Friend', 'Other'],
      allow_multiple: false,
      randomize_choices: false,
    },
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
    creatable: false,
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

interface TestShowResponse {
  id: string;
  name: string;
  status: string;
  responses_count: number;
  project_id: string;
  project_name: string;
  introduction: string;
  sections: SectionData[];
  [key: string]: unknown;
}

interface SectionData {
  id: string;
  type: string;
  position: number;
  instructions: string;
  stripped_instructions: string;
  likert_type: string;
  variations: VariationData[];
  [key: string]: unknown;
}

interface VariationData {
  id: string;
  name: string;
  type: string;
  choices: ChoiceData[];
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
  for (const q of sorted) {
    const label = TYPE_LABELS[q.type] ?? q.type;
    const countStr = q.response_count != null ? ` (${q.response_count} responses)` : '';
    console.log(`  \x1b[1mQ${q.position}.\x1b[0m [${label}] ${q.question}${countStr}`);

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
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const label = TYPE_LABELS[s.type] ?? s.type;
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

    console.log();
  }
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

function parsePositiveInt(value: string | undefined, flagName: string): number {
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
  [key: string]: unknown;
}

interface ValidationError {
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
};

const VALID_SCALE_TYPES = [
  'agreement', 'occurrence', 'importance', 'quality', 'comprehension',
  'impression', 'expectations', 'usefulness', 'difficulty', 'likelihood', 'custom',
];

// UX metric types that can be auto-generated via the API
const UX_METRIC_TYPES: Record<string, { description: string; section_count: number; section_types: string; default_instructions: string }> = {
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
};

const VALID_UX_METRIC_TYPE_NAMES = Object.keys(UX_METRIC_TYPES);

const EXCLUDED_UX_METRIC_TYPES = [
  'brand_score', 'engagement', 'success', 'completion', 'usability', 'satisfaction', 'effort',
];

function validateUxMetrics(metrics: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(metrics)) {
    errors.push({ question: 0, field: 'ux_metrics', message: 'Must be an array of metric type strings' });
    return errors;
  }

  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (typeof m !== 'string') {
      errors.push({ question: 0, field: `ux_metrics[${i}]`, message: 'Each entry must be a string' });
      continue;
    }

    if (EXCLUDED_UX_METRIC_TYPES.includes(m)) {
      errors.push({
        question: 0,
        field: `ux_metrics[${i}]`,
        message: `"${m}" requires click tests or prototypes and cannot be created via the API. Valid types: ${VALID_UX_METRIC_TYPE_NAMES.join(', ')}`,
      });
    } else if (!VALID_UX_METRIC_TYPE_NAMES.includes(m)) {
      errors.push({
        question: 0,
        field: `ux_metrics[${i}]`,
        message: `Unknown metric type "${m}". Valid types: ${VALID_UX_METRIC_TYPE_NAMES.join(', ')}`,
      });
    }
  }

  const seen = new Set<string>();
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i] as string;
    if (seen.has(m)) {
      errors.push({ question: 0, field: `ux_metrics[${i}]`, message: `Duplicate metric type "${m}"` });
    }
    seen.add(m);
  }

  return errors;
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

function validateQuestions(questions: unknown): ValidationError[] {
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
  }

  return errors;
}

function formatValidationErrors(errors: ValidationError[]): string {
  const lines = errors.map(e => {
    const prefix = e.question > 0 ? `  Question ${e.question}` : '  Questions';
    return `${prefix} → ${e.field}: ${e.message}`;
  });
  return `Validation failed:\n${lines.join('\n')}`;
}

// ── Command registration ─────────────────────────────────────────────

// ── Walkthrough (participant-eye view) ───────────────────────────────

type WalkthroughScreen =
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

function buildWalkthroughScreens(test: TestShowResponse): WalkthroughScreen[] {
  const screens: WalkthroughScreen[] = [];
  const intro = stripHtml(test.introduction || '');
  if (intro) {
    screens.push({ kind: 'intro', position: 1, text: intro });
  }

  const sections = [...(test.sections ?? [])].sort((a, b) => a.position - b.position);
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

    screens.push({
      kind: 'question',
      position: screens.length + 1,
      q_number: qNumber,
      type: canonical,
      type_label: TYPE_LABELS[s.type] ?? TYPE_LABELS[canonical] ?? canonical,
      raw_type: s.type,
      question: s.stripped_instructions || stripHtml(s.instructions || ''),
      choices,
      randomize_choices: randomize,
      allow_multiple: allowMultiple,
      scale_type: s.likert_type || undefined,
      ux_metric: uxMetric,
      renderable: ASSET_HEAVY_RAW_TYPES.has(s.type) ? 'placeholder' : 'full',
    });
  }

  return screens;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function renderWalkthroughScreen(screen: WalkthroughScreen): string[] {
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

  lines.push('');
  lines.push('  [ Next ]');
  return lines;
}

function walkthroughHeader(screen: WalkthroughScreen, total: number, totalQuestions: number): string {
  const left = `Screen ${screen.position} of ${total}`;
  if (screen.kind === 'intro') return `${left} · Introduction`;
  return `${left} · Q${screen.q_number} of ${totalQuestions} · ${screen.type_label}`;
}

function printWalkthroughHeader(test: TestShowResponse, totalQuestions: number): void {
  const status = formatStatus(String(test.status ?? 'unknown'));
  const responses = test.responses_count ?? 0;
  console.log(`\n\x1b[1m${test.name}\x1b[0m  ${status} — ${totalQuestions} question${totalQuestions === 1 ? '' : 's'}, ${responses} response${responses === 1 ? '' : 's'}`);
  if (test.project_name) console.log(`Project: ${test.project_name}`);
  console.log();
}

function printSeparator(): void {
  console.log('──────────────────────────────────────────');
}

function runStaticWalkthrough(test: TestShowResponse, screens: WalkthroughScreen[]): void {
  const totalQuestions = screens.filter(s => s.kind === 'question').length;
  printWalkthroughHeader(test, totalQuestions);

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

async function runInteractiveWalkthrough(test: TestShowResponse, screens: WalkthroughScreen[]): Promise<void> {
  const totalQuestions = screens.filter(s => s.kind === 'question').length;
  const answers = new Map<number, string>();

  if (screens.length === 0) {
    printWalkthroughHeader(test, totalQuestions);
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
      printWalkthroughHeader(test, totalQuestions);
      printSeparator();
      console.log(` \x1b[1m${walkthroughHeader(screen, screens.length, totalQuestions)}\x1b[0m`);
      printSeparator();
      console.log();
      for (const line of renderWalkthroughScreen(screen)) console.log(line);
      console.log();
      const existing = answers.get(screen.position);
      if (existing !== undefined && existing !== '') {
        console.log(`  \x1b[90mprevious answer: ${existing}\x1b[0m`);
      }
      const backHint = i === 0 ? '' : ' · b back';
      console.log(`  \x1b[90m${inputHint(screen)}${backHint} · q quit\x1b[0m`);

      const raw = await rl.question('  ▸ ');
      const trimmed = raw.trim();

      if (trimmed === 'q' || trimmed === 'Q') break;
      if (trimmed === 'b' || trimmed === 'B') {
        if (i > 0) i -= 1;
        continue;
      }

      const result = interpretAnswer(screen, raw);
      if (!result.ok) {
        console.log(`  \x1b[31m${result.message}\x1b[0m`);
        await rl.question('  ↵ to retry ');
        continue;
      }
      if (result.display) answers.set(screen.position, result.display);
      i += 1;
    }
  } finally {
    rl.close();
  }

  output.write('\x1b[2J\x1b[H');
  printWalkthroughHeader(test, totalQuestions);
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

function walkthroughScreenJson(screen: WalkthroughScreen): Record<string, unknown> {
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
            console.log(`\n  Usage:`);
            console.log(`    helio-cli tests create --ux-metrics ${cmdOpts.type} ...`);
          }
          return;
        }

        if (isJsonMode()) {
          printJson(UX_METRIC_TYPES);
        } else {
          console.log('\x1b[1m── UX Metrics (auto-generated via --ux-metrics) ──\x1b[0m\n');
          for (const [name, info] of Object.entries(UX_METRIC_TYPES)) {
            console.log(`  \x1b[1m${name}\x1b[0m — ${info.description}`);
            console.log(`    ${info.section_count} section(s): ${info.section_types}`);
            console.log();
          }
          console.log('Usage: helio-cli tests create --ux-metrics sentiment loyalty ...');
          console.log(`\nExcluded types (require click tests or prototypes): ${EXCLUDED_UX_METRIC_TYPES.join(', ')}`);
        }
      }),
    );

  cmd
    .command('get <id>')
    .description('Get test details (accepts UUID or report UUID)')
    .action(
      withErrorHandling(async (id: string) => {
        const client = makeClient(program);
        const data = (await client.get(`tests/${id}`)) as { test: Record<string, unknown> };
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data.test);
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
        const sections = (data.test.sections ?? []).sort((a, b) => a.position - b.position);

        // Build block list: group consecutive ux_metric sections together
        const blocks: { key: string; label: string; position: number }[] = [];
        const seenMetrics = new Set<string>();

        for (const s of sections) {
          const uxMetric = (s as Record<string, unknown>).ux_metric as { metric_type: string } | null;
          if (uxMetric?.metric_type) {
            const metricType = uxMetric.metric_type;
            if (!seenMetrics.has(metricType)) {
              seenMetrics.add(metricType);
              const metricSections = sections.filter(sec => {
                const m = (sec as Record<string, unknown>).ux_metric as { metric_type: string } | null;
                return m?.metric_type === metricType;
              });
              blocks.push({
                key: `metric:${metricType}`,
                label: `${metricType} metric (${metricSections.length} section${metricSections.length === 1 ? '' : 's'})`,
                position: s.position,
              });
            }
          } else {
            const typeLabel = TYPE_LABELS[s.type] ?? s.type;
            blocks.push({
              key: `section:${s.id}`,
              label: `[${typeLabel}] ${s.stripped_instructions || s.instructions || ''}`.trim(),
              position: s.position,
            });
          }
        }

        if (isJsonMode()) {
          printJson({
            test_id: data.test.id,
            order: blocks.map(b => b.key),
            blocks: blocks.map(b => ({ key: b.key, label: b.label, position: b.position })),
          });
        } else {
          console.log(`\x1b[1m${data.test.name}\x1b[0m — current order:\n`);
          for (let i = 0; i < blocks.length; i++) {
            console.log(`  ${i + 1}. ${blocks[i].key}`);
            console.log(`     ${blocks[i].label}`);
          }
          console.log(`\nTo reorder, pass --order with the block keys in your desired order:`);
          console.log(`  helio-cli tests reorder ${id} --order ${blocks.map(b => `"${b.key}"`).join(' ')}`);
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
          client.get(`tests/${id}`) as Promise<{ test: TestShowResponse }>,
          client.get(`tests/${id}/report`, { include: 'questions_summary' }).catch(err => {
            if (err instanceof HelioApiError && err.status === 404) return null;
            throw err;
          }) as Promise<ReportResponse | null>,
        ]);

        const test = testData.test;

        if (isJsonMode()) {
          printJson({
            test: {
              id: test.id,
              name: test.name,
              status: test.status,
              responses_count: test.responses_count,
              project_id: test.project_id,
              project_name: test.project_name,
              introduction: test.introduction,
            },
            questions: reportData?.questions_summary ?? buildQuestionsFromSections(test.sections),
          });
          return;
        }

        // Header
        const status = formatStatus(String(test.status ?? 'unknown'));
        console.log(`\n\x1b[1m${test.name}\x1b[0m  ${status}`);
        if (test.project_name) {
          console.log(`Project: ${test.project_name}`);
        }
        const responseCount = test.responses_count ?? 0;
        console.log(`Responses: ${responseCount}`);
        if (test.introduction) {
          console.log(`Intro: ${test.introduction}`);
        }
        console.log();

        // Questions — prefer report data (has results), fall back to raw sections
        if (reportData?.questions_summary?.length) {
          printReportQuestions(reportData.questions_summary);
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
        const { test } = (await client.get(`tests/${id}`)) as { test: TestShowResponse };
        const screens = buildWalkthroughScreens(test);

        if (isJsonMode()) {
          printJson({
            test: {
              id: test.id,
              name: test.name,
              status: test.status,
              responses_count: test.responses_count,
              project_id: test.project_id,
              project_name: test.project_name,
            },
            screens: screens.map(walkthroughScreenJson),
          });
          return;
        }

        if (cmdOpts.interactive) {
          await runInteractiveWalkthrough(test, screens);
        } else {
          runStaticWalkthrough(test, screens);
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
    .option('--ux-metrics <types...>', 'UX metrics to add (auto-generates measurement questions)')
    .option('--ux-metric-context <text>', 'Replace generic nouns in UX metric instructions (e.g. "the Helio dashboard")')
    .option('--dry-run', 'Validate locally without creating the test')
    .action(
      withErrorHandling(async (cmdOpts) => {
        const questions = cmdOpts.questions ? parseJsonOrFile(cmdOpts.questions) : undefined;
        const uxMetrics: string[] | undefined = cmdOpts.uxMetrics;

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
          const metricSectionCount = uxMetrics
            ? uxMetrics.reduce((sum, m) => sum + (UX_METRIC_TYPES[m]?.section_count ?? 0), 0)
            : 0;
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
          if (uxMetrics && uxMetrics.length > 0) {
            summary.ux_metrics = uxMetrics.map(m => ({
              metric_type: m,
              section_count: UX_METRIC_TYPES[m]?.section_count ?? 0,
              section_types: UX_METRIC_TYPES[m]?.section_types ?? 'unknown',
            }));
            if (cmdOpts.uxMetricContext) {
              summary.ux_metric_context = cmdOpts.uxMetricContext;
            }
          }
          if (isJsonMode()) {
            printJson(summary);
          } else {
            console.log(`\x1b[32m✓ Validation passed\x1b[0m\n`);
            console.log(`  Name:          ${summary.name}`);
            console.log(`  Project:       ${projectId}`);
            console.log(`  Audience:      ${audienceSize} (${summary.audience_type})`);
            console.log(`  Questions:     ${questionCount}`);
            if (uxMetrics && uxMetrics.length > 0) {
              console.log(`  UX metrics:    ${uxMetrics.join(', ')} (${metricSectionCount} auto-generated sections)`);
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
            if (uxMetrics && uxMetrics.length > 0) {
              console.log();
              console.log('  \x1b[1mUX Metrics (auto-generated):\x1b[0m');
              for (const m of uxMetrics) {
                const info = UX_METRIC_TYPES[m];
                if (info) {
                  console.log(`    ${m} — ${info.section_count} section(s): ${info.section_types}`);
                }
              }
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
        if (isJsonMode()) {
          printJson(data);
        } else {
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('add-question <id>')
    .description('Add a question to an existing draft test')
    .requiredOption('--type <type>', 'Question type: free_response, multiple_choice, likert, nps, ranking, preference, matrix, card_sort, point_allocation, max_diff')
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
    .option('--asset-id <id>', 'Asset ID (for free_response stimulus)')
    .option('--site-link <url>', 'Site link URL (for free_response stimulus)')
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

        // Validate the single question
        const errors = validateQuestions([question]);
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
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Added ${cmdOpts.type} question to test ${id}`);
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('edit-question <test-id> <section-id>')
    .description('Replace a question on a draft test (or update instructions/assets on a UX metric section)')
    .option('--type <type>', 'Question type (required for regular questions, omit for UX metric sections)')
    .option('--instructions <text>', 'Question text')
    .option('--choices <items...>', 'Choices')
    .option('--scale-type <scale>', 'Scale type (for likert)')
    .option('--custom-choices <items...>', 'Custom scale labels')
    .option('--allow-multiple', 'Allow multiple selections')
    .option('--randomize-choices', 'Randomize choice order')
    .option('--categories <items...>', 'Categories')
    .option('--points <n>', 'Total points')
    .option('--points-label <label>', 'Label for points')
    .option('--random-category-order', 'Randomize category order')
    .option('--can-skip-cards', 'Allow skipping cards')
    .option('--asset-id <id>', 'Asset ID (stimulus image)')
    .option('--site-link <url>', 'Site link URL (stimulus)')
    .action(
      withErrorHandling(async (testId: string, sectionId: string, cmdOpts) => {
        const question: QuestionInput = {};
        if (cmdOpts.type) question.type = cmdOpts.type;
        if (cmdOpts.instructions) question.instructions = cmdOpts.instructions;
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

        // If type is provided, this is a full question replacement — validate normally
        if (question.type) {
          if (!question.instructions) {
            throw new Error('--instructions is required when --type is provided.');
          }
          const errors = validateQuestions([question]);
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
            ['randomize_choices', '--randomize-choices'],
            ['categories', '--categories'],
            ['points', '--points'],
            ['points_label', '--points-label'],
            ['random_category_order', '--random-category-order'],
            ['can_skip_cards', '--can-skip-cards'],
          ];
          const present = structuralFlags
            .filter(([key]) => (question as Record<string, unknown>)[key] !== undefined)
            .map(([, flag]) => flag);
          if (present.length > 0) {
            throw new Error(`Structural flags not allowed without --type (UX metric sections only support safe edits): ${present.join(', ')}`);
          }
          // At least one safe field must be provided
          if (!question.instructions && !question.asset_id && !question.site_link && !question.choices) {
            throw new Error('Provide at least one of --instructions, --asset-id, --site-link, or --choices (intent only).');
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
    .requiredOption('--metrics <types...>', 'UX metric types to add')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const metrics: string[] = cmdOpts.metrics;

        const errors = validateUxMetrics(metrics);
        if (errors.length > 0) {
          if (isJsonMode()) {
            printJson({ valid: false, errors });
          } else {
            console.log(formatValidationErrors(errors));
          }
          return;
        }

        const client = makeClient(program);
        const data = await client.patch(`tests/${id}`, { add_ux_metrics: metrics });
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Added UX metrics to test ${id}: ${metrics.join(', ')}`);
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('remove-ux-metrics <id>')
    .description('Remove UX metrics from an existing draft test')
    .requiredOption('--metrics <types...>', 'UX metric types to remove')
    .action(
      withErrorHandling(async (id: string, cmdOpts) => {
        const metrics: string[] = cmdOpts.metrics;

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
        const data = await client.patch(`tests/${id}`, { remove_ux_metrics: metrics });
        if (isJsonMode()) {
          printJson(data);
        } else {
          console.log(`\x1b[32m✓\x1b[0m Removed UX metrics from test ${id}: ${metrics.join(', ')}`);
          printKeyValue(data as Record<string, unknown>);
        }
      }),
    );

  cmd
    .command('reorder <id>')
    .description('Reorder questions and UX metric groups on a draft test')
    .requiredOption('--order <blocks...>', 'Ordered block references: "section:<uuid>" or "metric:<type>"')
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
              message: `Invalid block "${entry}". Must be "section:<uuid>" or "metric:<type>"`,
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
      'Comma-separated: questions_summary,questions_followups,questions_responses,audiences_summary,demographics,ux_metrics,prototype_journeys,filter_options',
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
}
