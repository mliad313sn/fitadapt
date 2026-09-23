import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HttpError, HttpTransport, OfflineError } from '../index.js';

const deviceId = randomUUID();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('HttpTransport', () => {
  it('posts with a bearer token and validates the response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { changes: [], cursor: 0, hasMore: false }));
    const transport = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 'tok', fetch: fetchMock });
    await expect(transport.pull({ deviceId, since: 0 })).resolves.toEqual({ changes: [], cursor: 0, hasMore: false });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.test/v1/sync/pull');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('maps network failures to OfflineError', async () => {
    const transport = new HttpTransport({
      baseUrl: 'https://api.test',
      getAccessToken: async () => 'tok',
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(transport.push({ deviceId, mutations: [] })).rejects.toBeInstanceOf(OfflineError);
  });

  it('maps error responses to HttpError with the API code', async () => {
    const transport = new HttpTransport({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'tok',
      fetch: async () => jsonResponse(401, { error: { code: 'auth.unauthorized' } }),
    });
    await expect(transport.push({ deviceId, mutations: [] })).rejects.toMatchObject({ status: 401, code: 'auth.unauthorized' });
    const noBody = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 't', fetch: async () => new Response('x', { status: 500 }) });
    const err = await noBody.push({ deviceId, mutations: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBeUndefined();
  });

  it('rejects malformed success responses', async () => {
    const transport = new HttpTransport({ baseUrl: 'https://api.test', getAccessToken: () => 't', fetch: async () => jsonResponse(200, { nope: true }) });
    await expect(transport.push({ deviceId, mutations: [] })).rejects.toThrow();
  });
});
