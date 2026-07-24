import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// runInteractiveWalkthrough drives a readline session against stdin/stdout;
// stub the interface so answers can be scripted and nothing touches the TTY.
const { question, close } = vi.hoisted(() => ({
  question: vi.fn<() => Promise<string>>(),
  close: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({ question, close })),
}));

import { runInteractiveWalkthrough, type TestMeta, type WalkthroughScreen } from './tests.js';

const meta: TestMeta = {
  id: 'test-1',
  name: 'Homepage V2 eval',
  status: 'draft',
  responses_count: 0,
  project_id: 'proj-1',
  project_name: 'Homepage',
  account_id: null,
  account_name: null,
};

const screens: WalkthroughScreen[] = [
  {
    kind: 'question',
    position: 1,
    q_number: 1,
    type: 'free_response',
    type_label: 'Free response',
    raw_type: 'FreeResponseDirectiveSection',
    question: 'What stood out to you?',
    choices: [],
    randomize_choices: false,
    allow_multiple: false,
    assets: [],
    renderable: 'full',
  },
];

describe('runInteractiveWalkthrough', () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    question.mockReset();
    close.mockReset();
    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  // Regression: the completion path used to reference an out-of-scope `test`
  // variable and threw a ReferenceError after the last answer was given.
  it('prints the completion summary after the last question is answered', async () => {
    question.mockResolvedValueOnce('the hero headline');

    await runInteractiveWalkthrough(meta, screens);

    const output = logs.join('\n');
    expect(output).toContain('Walkthrough complete');
    expect(output).toContain('Homepage V2 eval');
    expect(output).toContain('the hero headline');
    expect(close).toHaveBeenCalled();
  });

  it('prints the completion summary when the participant quits early', async () => {
    question.mockResolvedValueOnce('quit');

    await runInteractiveWalkthrough(meta, screens);

    const output = logs.join('\n');
    expect(output).toContain('Walkthrough complete');
    expect(output).toContain('(skipped)');
    expect(close).toHaveBeenCalled();
  });
});
