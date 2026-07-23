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
    const msg =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: string }).message
        : typeof body === 'string'
          ? body
          : `HTTP ${status}`;
    super(msg);
    this.name = 'HelioApiError';
  }
}
