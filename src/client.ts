import { HelioApiError } from './types.js';

export class HelioClient {
  private baseUrl: string;
  private apiId: string;
  private apiToken: string;

  constructor(opts: { baseUrl: string; apiId: string; apiToken: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiId = opts.apiId;
    this.apiToken = opts.apiToken;
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(`/api/public/${path}`, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(`${key}[]`, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request(
    method: string,
    path: string,
    opts?: { params?: Record<string, unknown>; body?: unknown },
  ): Promise<unknown> {
    const url = this.buildUrl(path, opts?.params);
    const headers: Record<string, string> = {
      'X-API-ID': this.apiId,
      'X-API-TOKEN': this.apiToken,
      Accept: 'application/json',
    };

    const init: RequestInit = { method, headers };

    if (opts?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });

    return this.parseResponse(res);
  }

  private async parseResponse(res: Response): Promise<unknown> {
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      if (!res.ok) throw new HelioApiError(res.status, '');
      return {};
    }

    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await res.json()
      : await res.text();

    if (!res.ok) throw new HelioApiError(res.status, body);
    return body;
  }

  get(path: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', path, { params });
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, { body });
  }

  // Multipart upload — fetch sets the Content-Type boundary itself, so we
  // only send the auth headers. Longer timeout to accommodate large files.
  async postMultipart(path: string, form: FormData): Promise<unknown> {
    const res = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: {
        'X-API-ID': this.apiId,
        'X-API-TOKEN': this.apiToken,
        Accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });

    return this.parseResponse(res);
  }

  put(path: string, body?: unknown): Promise<unknown> {
    return this.request('PUT', path, { body });
  }

  patch(path: string, body?: unknown): Promise<unknown> {
    return this.request('PATCH', path, { body });
  }

  delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }
}
