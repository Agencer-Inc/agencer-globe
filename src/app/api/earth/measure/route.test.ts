import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { USER_HEADER } from '@/lib/earth/settings';
import { EARTH_SERVER_FLAG } from '@/lib/earth/settings';
import { MAX_PATH_POINTS } from '@/lib/earth/measure';

const HONG_KONG = [114.1694, 22.3193];
const SHENZHEN = [114.0579, 22.5431];

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://127.0.0.1:3000/api/earth/measure', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.stubEnv(EARTH_SERVER_FLAG, '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the door is dark until armed', () => {
  it('answers 503 and names the flag when the setting is off', async () => {
    vi.stubEnv(EARTH_SERVER_FLAG, '');
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.refusal).toBe('disabled');
    expect(body.detail).toContain(EARTH_SERVER_FLAG);
  });
});

describe('the door names its caller', () => {
  it('refuses 401 with no user at all', async () => {
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }));
    expect(res.status).toBe(401);
    expect((await res.json()).refusal).toBe('anonymous');
  });

  it('takes the user from the body when no header is sent', async () => {
    const res = await POST(post({ userId: 'op-1', path: [HONG_KONG, SHENZHEN] }));
    expect(res.status).toBe(200);
  });

  it('the header wins over the body', async () => {
    const res = await POST(post({ userId: '', path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    expect(res.status).toBe(200);
  });

  // A body we cannot read is still no excuse for answering a stranger: the same
  // ordering the query door keeps (query/route.ts:69-82).
  it('names the caller first even when the body will not parse', async () => {
    const res = await POST(post('{ not json'));
    expect(res.status).toBe(401);
    expect((await res.json()).refusal).toBe('anonymous');
  });

  it('refuses a named caller with an unreadable body as malformed, not anonymous', async () => {
    const res = await POST(post('{ not json', { [USER_HEADER]: 'op-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).refusal).toBe('malformed');
  });

  it('refuses a JSON body that is not an object', async () => {
    for (const body of ['null', '[]', '42', '"hi"']) {
      const res = await POST(post(body, { [USER_HEADER]: 'op-1' }));
      expect(res.status, body).toBe(400);
    }
  });
});

describe('POST /api/earth/measure', () => {
  it('measures Hong Kong to the mainland and says how far, in words and in km', async () => {
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.km).toBeGreaterThan(0);
    expect(body.formatted).toMatch(/km|m/);
    expect(body.legs).toHaveLength(1);
    expect(body.compass).toBeTypeOf('string');
  });

  it('carries the accuracy the measurement actually has', async () => {
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    expect((await res.json()).accuracyNote).toMatch(/0\.5%/);
  });

  it('refuses 400 and names every problem in the path', async () => {
    const res = await POST(post({ path: [HONG_KONG, [999, 0]] }, { [USER_HEADER]: 'op-1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.refusal).toBe('malformed');
    expect(body.detail).toMatch(/lng/);
  });

  it('refuses a path past the cap rather than measuring it', async () => {
    const tooMany = Array.from({ length: MAX_PATH_POINTS + 1 }, (_, i) => [i % 180, 0]);
    const res = await POST(post({ path: tooMany }, { [USER_HEADER]: 'op-1' }));
    expect(res.status).toBe(400);
  });

  // Nothing here is cacheable: the answer is a pure function of the request, so
  // a cache would only ever hold a copy of arithmetic. Matches the query door.
  it('is never stored', async () => {
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  /**
   * A door that serves non-ASCII owes its callers the charset rather than the
   * assumption. Measured: PowerShell 5.1 read Polish station names back as
   * `BeÅchatÃ³w` because Invoke-RestMethod falls back to ISO-8859-1 when no
   * charset is stated, and no console setting recovers a string decoded wrong.
   */
  it('says it is UTF-8, because a client that guesses guesses Latin-1', async () => {
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    expect(res.headers.get('content-type')).toMatch(/charset=utf-8/i);
  });

  it('says so on a refusal too, which is where the place names live', async () => {
    const res = await POST(post({ path: [HONG_KONG] }, { [USER_HEADER]: 'op-1' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/charset=utf-8/i);
  });

  it('stamps every answer with the time it was given', async () => {
    const res = await POST(post({ path: [HONG_KONG, SHENZHEN] }, { [USER_HEADER]: 'op-1' }));
    expect((await res.json()).timestamp).toBeTypeOf('string');
  });
});
