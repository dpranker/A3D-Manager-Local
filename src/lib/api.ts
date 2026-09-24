/**
 * fetch for the app's API that throws on failure, with the server's error message.
 * Use it wherever a failed request must not be mistaken for success.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Like fetch, but rejects with ApiError when the response isn't 2xx */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof data?.error === 'string' && data.error ? data.error : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return response;
}

/** POST a JSON body with apiFetch */
export function apiPostJson(url: string, body: unknown): Promise<Response> {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const errorMessage = (error: unknown, fallback = 'Something went wrong'): string =>
  error instanceof Error && error.message ? error.message : fallback;
