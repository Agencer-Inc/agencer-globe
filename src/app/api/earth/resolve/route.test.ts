import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { POST as CONFIRM } from './confirm/route';
import { EARTH_SERVER_FLAG, USER_HEADER } from '@/lib/earth/settings';
import { resolvePlace, clearPlaceCache, PLACES } from '@/lib/earth/places';

/** One Nominatim-shaped row, as api/geosearch would already have normalised it. */
const polandHit = {
  name: 'Polska', context: 'Poland', lat: 52.215, lng: 19.134,
  kind: 'country', source: 'nominatim',
  bbox: [14.122929, 49.002046, 24.1458933, 54.8357841],
  bboxSource: 'upstream',
};

const parisFrance = {
  name: 'Paris', context: 'Île-de-France, France', lat: 48.8566, lng: 2.3522,
  kind: 'city', source: 'photon',
};
const parisTexas = {
  name: 'Paris', context: 'Texas, United States', lat: 33.6609, lng: -95.5555,
  kind: 'city', source: 'photon',
};

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://127.0.0.1:3000${url}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const resolve = (body: unknown, h: Record<string, string> = { [USER_HEADER]: 'op-1' }) =>
  POST(post('/api/earth/resolve', body, h));
const confirm = (body: unknown, h: Record<string, string> = { [USER_HEADER]: 'op-1' }) =>
  CONFIRM(post('/api/earth/resolve/confirm', body, h));

/** Stand in for api/geosearch, which owns the Photon/Nominatim fan-out. */
function withGeosearch(results: unknown[], ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => ({ results }),
  })));
}

beforeEach(() => {
  vi.stubEnv(EARTH_SERVER_FLAG, '1');
  clearPlaceCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearPlaceCache();
});

describe('the resolve door is dark until armed', () => {
  it('answers 503 and names the flag', async () => {
    vi.stubEnv(EARTH_SERVER_FLAG, '');
    withGeosearch([polandHit]);
    const res = await resolve({ name: 'Poland' });
    expect(res.status).toBe(503);
    expect((await res.json()).detail).toContain(EARTH_SERVER_FLAG);
  });

  it('the confirm half is dark too, or one half writes while the other refuses', async () => {
    vi.stubEnv(EARTH_SERVER_FLAG, '');
    const res = await confirm({ name: 'Poland', candidate: { bbox: [1, 2, 3, 4], note: 'x' } });
    expect(res.status).toBe(503);
  });
});

describe('both halves name their caller', () => {
  it('refuses an anonymous resolve, before asking any upstream', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await resolve({ name: 'Poland' }, {});
    expect(res.status).toBe(401);
    expect((await res.json()).refusal).toBe('anonymous');
    // The point of checking first: a door that geocodes and then asks who is
    // calling has already spent 20 seconds of somebody else's rate limit.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an anonymous confirm', async () => {
    const res = await confirm({ name: 'Poland', candidate: { bbox: [1, 2, 3, 4], note: 'x' } }, {});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/earth/resolve offers candidates and writes nothing', () => {
  it('offers every match, with the context that tells them apart', async () => {
    withGeosearch([parisFrance, parisTexas]);
    const body = await (await resolve({ name: 'Paris' })).json();

    expect(body.ok).toBe(true);
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates[0].context).toMatch(/France/);
    expect(body.candidates[1].context).toMatch(/Texas/);
  });

  /**
   * The whole reason this door exists. A geocoder that picked for itself would
   * make "Paris" silently one of two cities; offering both and letting the
   * caller choose is the standard places.ts sets, kept — a refusal beats a
   * guess, and a considered choice beats both.
   */
  it('does not choose, and does not write', async () => {
    withGeosearch([parisFrance, parisTexas]);
    await resolve({ name: 'Marseille' });

    expect(resolvePlace('marseille').ok).toBe(false);
  });

  it('says a name matched nothing, rather than refusing it', async () => {
    withGeosearch([]);
    const res = await resolve({ name: 'zzzzzzz' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.candidates).toEqual([]);
  });

  /* Nothing matched and could-not-ask are different facts, and a caller that
     cannot tell them apart will retry the wrong one. */
  it('refuses BY NAME when the geocoder could not be reached at all', async () => {
    withGeosearch([], false);
    const res = await resolve({ name: 'Poland' });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.refusal).toBe('upstream_unavailable');
  });

  it('refuses a blank or missing name', async () => {
    withGeosearch([polandHit]);
    for (const name of [undefined, '', '   ', 42]) {
      const res = await resolve({ name });
      expect(res.status, String(name)).toBe(400);
    }
  });
});

describe('POST /api/earth/resolve/confirm writes the one that was chosen', () => {
  it('makes the name resolvable, keyed by the words the caller used', async () => {
    withGeosearch([polandHit]);
    const offered = (await (await resolve({ name: 'Poland' })).json()).candidates[0];

    const res = await confirm({ name: 'Poland', candidate: offered });
    expect(res.status).toBe(200);

    const got = resolvePlace('poland');
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.bbox).toEqual(polandHit.bbox);
      expect(got.from).toBe('resolved');
    }
  });

  it('round-trips: what resolve offered is exactly what confirm accepts', async () => {
    withGeosearch([parisTexas]);
    const offered = (await (await resolve({ name: 'Paris, Texas' })).json()).candidates[0];
    expect((await confirm({ name: 'Paris, Texas', candidate: offered })).status).toBe(200);
    expect(resolvePlace('paris, texas').ok).toBe(true);
  });

  it('refuses a box that is not one, rather than storing it', async () => {
    const res = await confirm({ name: 'nowhere', candidate: { bbox: [10, 60, 20, 50], note: 'x' } });
    expect(res.status).toBe(400);
    expect((await res.json()).refusal).toBe('malformed');
    expect(resolvePlace('nowhere').ok).toBe(false);
  });

  it('refuses a candidate with no box at all', async () => {
    expect((await confirm({ name: 'x', candidate: { note: 'x' } })).status).toBe(400);
    expect((await confirm({ name: 'x', candidate: null })).status).toBe(400);
    expect((await confirm({ name: 'x' })).status).toBe(400);
  });

  /* A hand row was typed by a person reading a map and read by a reviewer. A
     confirmed one came from a fuzzy index. If an upstream could overwrite
     Paris, one bad confirm would move it for every later query. */
  it('refuses to overwrite a hand-written place, and says so rather than writing a row nothing reads', async () => {
    const res = await confirm({ name: 'Paris', candidate: { bbox: [0, 0, 1, 1], note: 'an upstream Paris' } });

    expect(res.status).toBe(409);
    expect((await res.json()).refusal).toBe('hand_written');

    const got = resolvePlace('Paris');
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.bbox).toEqual(PLACES.paris.bbox);
      expect(got.from).toBe('table');
    }
  });
});
