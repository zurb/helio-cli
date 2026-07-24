export interface FollowupInput {
  question?: string;
  required?: boolean;
  remove?: boolean;
  for_choices?: number[];
  [key: string]: unknown;
}

export interface HelioConfig {
  'api-id'?: string;
  'api-token'?: string;
  'base-url'?: string;
}

export interface GlobalOptions {
  output?: 'json' | 'text';
  apiId?: string;
  apiToken?: string;
  baseUrl?: string;
}

export class HelioApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    // Helio endpoints return {error: "..."}; some return {message: "..."}.
    const fromBody =
      typeof body === 'object' && body !== null
        ? ((body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message)
        : body;
    const msg =
      typeof fromBody === 'string' && fromBody.trim() ? fromBody : `HTTP ${status}`;
    super(msg);
    this.name = 'HelioApiError';
  }
}
