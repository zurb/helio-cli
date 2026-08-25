import { describe, it, expect } from 'vitest';
import {
  validateAudienceConfig,
  validateExcludeTestIds,
  excludeTestWarnings,
  enrichSendError,
} from './tests.js';
import { HelioApiError } from '../types.js';

// ─── validateAudienceConfig ──────────────────────────────────────────────────
// The API contract (2026-08 audience release): audience_type is one of
// open|basic|targeted|advanced|customer_list; audiences is required for
// advanced/customer_list, ignored for open, rejected for basic/targeted;
// demographics is required for targeted, optional for advanced, rejected
// elsewhere, with a fixed key vocabulary. The CLI validates all of it locally
// so --dry-run catches what used to be a launch-time 400 — and so --audiences
// on an open test errors loudly instead of silently recruiting nobody.

describe('validateAudienceConfig — audience_type', () => {
  it('accepts every supported type with a well-formed config', () => {
    expect(validateAudienceConfig({ audienceType: 'open' })).toEqual([]);
    expect(validateAudienceConfig({ audienceType: 'basic' })).toEqual([]);
    expect(
      validateAudienceConfig({ audienceType: 'targeted', demographics: { age: ['25-34'] } }),
    ).toEqual([]);
    expect(
      validateAudienceConfig({ audienceType: 'advanced', audiences: ['01J8AUDIENCE'] }),
    ).toEqual([]);
    expect(
      validateAudienceConfig({ audienceType: 'customer_list', audiences: ['01J8LIST'] }),
    ).toEqual([]);
  });

  it('rejects unknown types and lists the valid ones', () => {
    const errors = validateAudienceConfig({ audienceType: 'panel' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/"panel"/);
    expect(errors[0]).toMatch(/open, basic, targeted, advanced, customer_list/);
  });
});

describe('validateAudienceConfig — audiences', () => {
  it('requires --audiences for advanced', () => {
    const errors = validateAudienceConfig({ audienceType: 'advanced' });
    expect(errors.join(' ')).toMatch(/--audiences is required/);
    expect(errors.join(' ')).toMatch(/advanced/);
  });

  it('requires --audiences for customer_list', () => {
    const errors = validateAudienceConfig({ audienceType: 'customer_list' });
    expect(errors.join(' ')).toMatch(/--audiences is required/);
  });

  it('treats an empty --audiences array as missing', () => {
    const errors = validateAudienceConfig({ audienceType: 'advanced', audiences: [] });
    expect(errors.join(' ')).toMatch(/--audiences is required/);
  });

  it('rejects --audiences on open tests instead of letting the server silently ignore it', () => {
    const errors = validateAudienceConfig({ audienceType: 'open', audiences: ['01J8AUDIENCE'] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/open/);
    expect(errors[0]).toMatch(/advanced|customer_list/);
  });

  it('rejects --audiences for basic and targeted', () => {
    for (const audienceType of ['basic', 'targeted']) {
      const errors = validateAudienceConfig({
        audienceType,
        audiences: ['01J8AUDIENCE'],
        ...(audienceType === 'targeted' ? { demographics: { age: ['25-34'] } } : {}),
      });
      expect(errors.join(' ')).toMatch(/--audiences/);
    }
  });
});

describe('validateAudienceConfig — demographics', () => {
  it('requires --demographics for targeted', () => {
    const errors = validateAudienceConfig({ audienceType: 'targeted' });
    expect(errors.join(' ')).toMatch(/--demographics is required/);
  });

  it('treats an empty demographics object as missing for targeted', () => {
    const errors = validateAudienceConfig({ audienceType: 'targeted', demographics: {} });
    expect(errors.join(' ')).toMatch(/--demographics is required/);
  });

  it('is optional for advanced', () => {
    expect(
      validateAudienceConfig({
        audienceType: 'advanced',
        audiences: ['01J8AUDIENCE'],
        demographics: { country: ['United States'] },
      }),
    ).toEqual([]);
  });

  it('rejects --demographics on types that do not take it', () => {
    for (const audienceType of ['open', 'basic', 'customer_list']) {
      const errors = validateAudienceConfig({
        audienceType,
        demographics: { age: ['25-34'] },
        ...(audienceType === 'customer_list' ? { audiences: ['01J8LIST'] } : {}),
      });
      expect(errors.join(' ')).toMatch(/--demographics/);
      expect(errors.join(' ')).toMatch(/targeted|advanced/);
    }
  });

  it('rejects non-object demographics', () => {
    const errors = validateAudienceConfig({ audienceType: 'targeted', demographics: ['25-34'] });
    expect(errors.join(' ')).toMatch(/JSON object/);
  });

  it('names an unknown key and lists the valid vocabulary', () => {
    const errors = validateAudienceConfig({
      audienceType: 'targeted',
      demographics: { age: ['25-34'], state: ['CA'] },
    });
    expect(errors.join(' ')).toMatch(/"state"/);
    expect(errors.join(' ')).toMatch(/gender, age, income, education, continent, country/);
  });

  it('names the key whose value is not an array of strings', () => {
    const errors = validateAudienceConfig({
      audienceType: 'targeted',
      demographics: { age: '25-34' },
    });
    expect(errors.join(' ')).toMatch(/"age"/);
    expect(errors.join(' ')).toMatch(/array of strings/);

    const numeric = validateAudienceConfig({
      audienceType: 'targeted',
      demographics: { age: [25] },
    });
    expect(numeric.join(' ')).toMatch(/"age"/);
  });

  it('collects every problem in one pass rather than stopping at the first', () => {
    const errors = validateAudienceConfig({
      audienceType: 'advanced',
      demographics: { state: ['CA'], age: '25-34' },
    });
    // missing audiences + unknown key + bad value = three actionable errors
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── validateExcludeTestIds ──────────────────────────────────────────────────
// The 2026-08-23 API contract: exclude_test_ids is writable on create and
// update. The API gates it three ways — the account's beta_group flag, panel
// audiences only, and a cap of 5 (30 for internal_group). Only the panel gate
// is visible locally, and only when the same request sets the audience type;
// the account-shaped gates are warnings, not errors, so an account that DOES
// have the entitlement is never falsely blocked.

describe('validateExcludeTestIds', () => {
  it('accepts a well-formed list on every panel audience type', () => {
    for (const audienceType of ['basic', 'targeted', 'advanced']) {
      expect(validateExcludeTestIds({ excludeTestIds: ['01J8TESTA', '01J8TESTB'], audienceType })).toEqual([]);
    }
  });

  it('is a no-op when nothing is excluded', () => {
    expect(validateExcludeTestIds({})).toEqual([]);
    expect(validateExcludeTestIds({ excludeTestIds: [] })).toEqual([]);
    // Clearing is exempt from every gate upstream, so an empty list never
    // trips the panel-only rule either.
    expect(validateExcludeTestIds({ excludeTestIds: [], audienceType: 'open' })).toEqual([]);
  });

  it('rejects exclusions on the two non-panel audience types', () => {
    for (const audienceType of ['open', 'customer_list']) {
      const errors = validateExcludeTestIds({ excludeTestIds: ['01J8TESTA'], audienceType });
      expect(errors.join(' ')).toMatch(/panel audiences only/);
      expect(errors.join(' ')).toMatch(/basic, targeted, advanced/);
    }
  });

  it('skips the panel gate when the request does not set the type', () => {
    // `tests update --exclude-tests` alone keeps whatever quota the test has,
    // so the server is the only thing that can judge this.
    expect(validateExcludeTestIds({ excludeTestIds: ['01J8TESTA'] })).toEqual([]);
  });

  it('rejects empty and non-string ids by position', () => {
    const errors = validateExcludeTestIds({ excludeTestIds: ['01J8TESTA', ' ', 7 as unknown as string] });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/\[1\]/);
    expect(errors[1]).toMatch(/\[2\]/);
  });

  it('rejects a duplicated id', () => {
    const errors = validateExcludeTestIds({ excludeTestIds: ['01J8TESTA', '01J8TESTB', '01J8TESTA'] });
    expect(errors.join(' ')).toMatch(/more than once/);
    expect(errors.join(' ')).toMatch(/01J8TESTA/);
  });

  it('rejects a test excluding itself', () => {
    const errors = validateExcludeTestIds({ excludeTestIds: ['01J8SELF'], testId: '01J8SELF' });
    expect(errors.join(' ')).toMatch(/itself/);
    expect(errors.join(' ')).toMatch(/01J8SELF/);
  });

  it('is reached through validateAudienceConfig so --dry-run catches it', () => {
    const errors = validateAudienceConfig({
      audienceType: 'open',
      excludeTestIds: ['01J8TESTA'],
    });
    expect(errors.join(' ')).toMatch(/panel audiences only/);
  });
});

describe('excludeTestWarnings', () => {
  it('says nothing when nothing is excluded', () => {
    expect(excludeTestWarnings()).toEqual([]);
    expect(excludeTestWarnings([])).toEqual([]);
  });

  it('always flags the account-level beta_group gate', () => {
    const warnings = excludeTestWarnings(['01J8TESTA']);
    expect(warnings.join(' ')).toMatch(/beta_group/);
    expect(warnings.join(' ')).toMatch(/400/);
  });

  it('warns past the cap instead of blocking an internal_group account', () => {
    const six = Array.from({ length: 6 }, (_, i) => `01J8TEST${i}`);
    // Never an error: the CLI cannot see whether the account gets 30.
    expect(validateExcludeTestIds({ excludeTestIds: six, audienceType: 'basic' })).toEqual([]);
    const warnings = excludeTestWarnings(six);
    expect(warnings.join(' ')).toMatch(/6 exclusions/);
    expect(warnings.join(' ')).toMatch(/internal_group/);
  });
});

// ─── enrichSendError ─────────────────────────────────────────────────────────
// A 502 from send means the Enroll platform rejected the quota (e.g. audience
// too narrow). The test stays draft and nothing is spent — the CLI must say so
// explicitly, or the user has no way to know a retry is safe.

describe('enrichSendError', () => {
  it('appends the nothing-charged note to a 502', () => {
    const enriched = enrichSendError(
      new HelioApiError(502, { error: 'audience too narrow for panel' }),
    );
    expect(enriched).toBeInstanceOf(HelioApiError);
    const err = enriched as HelioApiError;
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/audience too narrow for panel/);
    expect(err.message).toMatch(/[Nn]othing was charged/);
    expect(err.message).toMatch(/still a draft/);
  });

  it('keeps the upstream body available for JSON consumers', () => {
    const enriched = enrichSendError(
      new HelioApiError(502, { error: 'quota rejected' }),
    ) as HelioApiError;
    expect(JSON.stringify(enriched.body)).toMatch(/quota rejected/);
  });

  it('passes every other error through untouched', () => {
    const notFound = new HelioApiError(404, { error: 'test not found' });
    expect(enrichSendError(notFound)).toBe(notFound);

    const plain = new Error('boom');
    expect(enrichSendError(plain)).toBe(plain);
  });
});
