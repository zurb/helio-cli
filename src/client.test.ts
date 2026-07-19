import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HelioClient } from './client.js';
import { HelioApiError } from './types.js';

// ─── Fetch mock plumbing ─────────────────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit & { headers: Record<string, string> } };

let calls: FetchCall[];
let nextResponse: () => Response;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  nextResponse = () => jsonResponse({ ok: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: (init ?? {}) as FetchCall['init'] });
    return nextResponse();
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const makeClient = (baseUrl = 'https://my.helio.app') =>
  new HelioClient({ baseUrl, apiId: 'id-123', apiToken: 'tok-456' });

// ─── URL construction ────────────────────────────────────────────────────────

describe('HelioClient — URL construction', () => {
  it('prefixes paths with /api/public/', async () => {
    await makeClient().get('tests');
    expect(calls[0].url).toBe('https://my.helio.app/api/public/tests');
  });

  it('strips trailing slashes from the base URL', async () => {
    await makeClient('https://my.helio.app///').get('projects');
    expect(calls[0].url).toBe('https://my.helio.app/api/public/projects');
  });

  it('serializes scalar params as query strings', async () => {
    await makeClient().get('tests', { status: 'complete', page: 2 });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('status')).toBe('complete');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('serializes array params in key[] form', async () => {
    await makeClient().get('tests/abc/report', { age: ['25-34', '35-44'] });
    const url = new URL(calls[0].url);
    expect(url.searchParams.getAll('age[]')).toEqual(['25-34', '35-44']);
  });

  it('skips undefined and null params', async () => {
    await makeClient().get('tests', { status: undefined, tag: null, name: 'x' });
    const url = new URL(calls[0].url);
    expect([...url.searchParams.keys()]).toEqual(['name']);
  });
});

// ─── Headers and body ────────────────────────────────────────────────────────

describe('HelioClient — headers and body', () => {
  it('always sends API credential headers and Accept', async () => {
    await makeClient().get('status');
    expect(calls[0].init.headers).toMatchObject({
      'X-API-ID': 'id-123',
      'X-API-TOKEN': 'tok-456',
      Accept: 'application/json',
    });
  });

  it('sets Content-Type and stringifies the body only when a body is present', async () => {
    const client = makeClient();
    await client.get('tests');
    expect(calls[0].init.headers['Content-Type']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();

    await client.post('tests', { name: 'T' });
    expect(calls[1].init.headers['Content-Type']).toBe('application/json');
    expect(calls[1].init.body).toBe('{"name":"T"}');
  });

  it.each([
    ['get', 'GET'],
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['delete', 'DELETE'],
  ] as const)('%s() sends %s', async (method, verb) => {
    const client = makeClient();
    // delete/get take no body arg; call uniformly via any
    await (client as any)[method]('tests/abc');
    expect(calls[0].init.method).toBe(verb);
  });
});

// ─── Multipart upload ────────────────────────────────────────────────────────

describe('HelioClient — postMultipart', () => {
  const makeForm = () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'tiny.png');
    return form;
  };

  it('POSTs the FormData without a JSON Content-Type so fetch can set the boundary', async () => {
    await makeClient().postMultipart('assets', makeForm());
    expect(calls[0].url).toBe('https://my.helio.app/api/public/assets');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect(calls[0].init.headers['Content-Type']).toBeUndefined();
    expect(calls[0].init.headers).toMatchObject({
      'X-API-ID': 'id-123',
      'X-API-TOKEN': 'tok-456',
      Accept: 'application/json',
    });
  });

  it('parses the JSON response like other requests', async () => {
    nextResponse = () => jsonResponse({ asset: { id: 138, status: 'processing' } }, 201);
    await expect(makeClient().postMultipart('assets', makeForm())).resolves.toEqual({
      asset: { id: 138, status: 'processing' },
    });
  });

  it('throws HelioApiError on non-ok responses', async () => {
    nextResponse = () => jsonResponse({ code: 422, message: 'Invalid Parameter', type: 'Invalid Parameter' }, 422);
    const err = await makeClient().postMultipart('assets', makeForm()).catch((e: unknown) => e as HelioApiError);
    expect(err).toBeInstanceOf(HelioApiError);
    expect((err as HelioApiError).status).toBe(422);
  });
});

// ─── Response handling ───────────────────────────────────────────────────────

describe('HelioClient — response handling', () => {
  it('parses JSON responses', async () => {
    nextResponse = () => jsonResponse({ id: 'abc' });
    await expect(makeClient().get('tests/abc')).resolves.toEqual({ id: 'abc' });
  });

  it('returns text for non-JSON content types', async () => {
    nextResponse = () => new Response('plain text', { status: 200, headers: { 'content-type': 'text/plain' } });
    await expect(makeClient().get('status')).resolves.toBe('plain text');
  });

  it('returns {} for 204 responses', async () => {
    nextResponse = () => new Response(null, { status: 204 });
    await expect(makeClient().delete('tests/abc')).resolves.toEqual({});
  });

  it('throws HelioApiError with status and parsed body on non-ok JSON', async () => {
    nextResponse = () => jsonResponse({ error: 'Unauthorized' }, 401);
    const err = await makeClient().get('tests').catch((e: unknown) => e as HelioApiError);
    expect(err).toBeInstanceOf(HelioApiError);
    expect((err as HelioApiError).status).toBe(401);
  });

  it('throws HelioApiError on non-ok text responses', async () => {
    nextResponse = () => new Response('nope', { status: 500, headers: { 'content-type': 'text/plain' } });
    await expect(makeClient().get('tests')).rejects.toBeInstanceOf(HelioApiError);
  });
});
