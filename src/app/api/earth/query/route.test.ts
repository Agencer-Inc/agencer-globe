import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET, USER_HEADER } from './route';
import { startEarthServer, resetEarthScheduler, tickLayer } from '@/lib/earth/scheduler';
import { clearSourceCache } from '@/lib/sourceCache';
import { EARTH_SERVER_FLAG } from '@/lib/earth/settings';
import { PLACES } from '@/lib/earth/places';
import type { EarthItem, EarthLayer } from '@/lib/earth/registry';

const ARMED = { [EARTH_SERVER_FLAG]: '1' } as unknown as NodeJS.ProcessEnv;

const at = (id: string, lat: number, lng: number): EarthItem =>
  ({ id, lat, lng, label: id, kind: 'quake', props: {} });

const NOTRE_DAME = at('nd', 48.853, 2.349);
const MARSEILLE = at('mrs', 43.296, 5.370);

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://127.0.0.1:3000/api/earth/query', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function armWith(items: EarthItem[]) {
  const layer: EarthLayer = {
    id: 'earthquakes',
    intervalMs: 60_000,
    ttlMs: 60_000,
    timeoutMs: 10_000,
    fetch: async () => items,
  };
  startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
  return layer;
}

beforeEach(() => {
  resetEarthScheduler();
  clearSourceCache();
  vi.stubEnv(EARTH_SERVER_FLAG, '1');
});

afterEach(() => {
  resetEarthScheduler();
  vi.unstubAllEnvs();
});

describe('the door is dark until armed', () => {
  it('answers 503 and names the flag when the setting is off', async () => {
    vi.stubEnv(EARTH_SERVER_FLAG, '');
    const res = await POST(post({ layer: 'earthquakes' }, { [USER_HEADER]: 'op-1' }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.refusal).toBe('disabled');
    expect(body.detail).toContain(EARTH_SERVER_FLAG);
  });

  it('the reporting GET is dark too', async () => {
    vi.stubEnv(EARTH_SERVER_FLAG, '');
    expect((await GET()).status).toBe(503);
  });
});

describe('POST /api/earth/query', () => {
  it('refuses an anonymous caller with 401 and names the refusal', async () => {
    armWith([NOTRE_DAME]);
    const res = await POST(post({ layer: 'earthquakes' }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.refusal).toBe('anonymous');
  });

  it('reads the caller from the header', async () => {
    const layer = armWith([NOTRE_DAME, MARSEILLE]);
    await tickLayer(layer);

    const res = await POST(post(
      { layer: 'earthquakes', place: 'Paris' },
      { [USER_HEADER]: 'op-1' },
    ));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items.map((i: EarthItem) => i.id)).toEqual(['nd']);
    expect(body.place).toBe('paris');
  });

  it('accepts a caller in the body when no header is sent', async () => {
    const layer = armWith([NOTRE_DAME]);
    await tickLayer(layer);

    const res = await POST(post({ layer: 'earthquakes', userId: 'op-2' }));
    expect(res.status).toBe(200);
  });

  it('the header wins over the body', async () => {
    const layer = armWith([NOTRE_DAME]);
    await tickLayer(layer);

    // An empty header is still a header, and it must not be rescued by a body
    // field a caller controls — otherwise the header can never deny anything.
    const res = await POST(post({ layer: 'earthquakes', userId: 'op-2' }, { [USER_HEADER]: '' }));
    expect(res.status).toBe(401);
  });

  it('clamps a limit of 500 to 50 and says so over the wire', async () => {
    const layer = armWith(Array.from({ length: 120 }, (_, i) => at(`e${i}`, 48.86, 2.35)));
    await tickLayer(layer);

    const res = await POST(post(
      { layer: 'earthquakes', bbox: PLACES.paris.bbox, limit: 500 },
      { [USER_HEADER]: 'op-1' },
    ));
    const body = await res.json();

    expect(body.limit).toBe(50);
    expect(body.limitRequested).toBe(500);
    expect(body.limitClamped).toBe(true);
    expect(body.items).toHaveLength(50);
    expect(body.matched).toBe(120);
  });

  it('names a cold layer cold, with 200 rather than an error', async () => {
    armWith([NOTRE_DAME]);
    const res = await POST(post({ layer: 'earthquakes' }, { [USER_HEADER]: 'op-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cold).toBe(true);
    expect(body.coldReason).toBe('never_fetched');
  });

  it('names a dead layer dead with the catalogue reason', async () => {
    armWith([NOTRE_DAME]);
    const res = await POST(post({ layer: 'balloons' }, { [USER_HEADER]: 'op-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.coldReason).toBe('dead');
    expect(body.coldDetail).toContain('does not exist');
  });

  it('404s an unknown layer and 400s an unknown place', async () => {
    armWith([NOTRE_DAME]);
    const unknown = await POST(post({ layer: 'unicorns' }, { [USER_HEADER]: 'op-1' }));
    expect(unknown.status).toBe(404);

    const place = await POST(post(
      { layer: 'earthquakes', place: 'Marseille' },
      { [USER_HEADER]: 'op-1' },
    ));
    expect(place.status).toBe(400);
    expect((await place.json()).refusal).toBe('place_unknown');
  });

  it('400s a body that is not JSON instead of throwing', async () => {
    armWith([NOTRE_DAME]);
    const res = await POST(post('{not json', { [USER_HEADER]: 'op-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).refusal).toBe('malformed');
  });

  it('never lets an answer be cached by anything in front of it', async () => {
    const layer = armWith([NOTRE_DAME]);
    await tickLayer(layer);
    const res = await POST(post({ layer: 'earthquakes' }, { [USER_HEADER]: 'op-1' }));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/earth/query reports what is held', () => {
  it('witnesses an armed server without handing over any data', async () => {
    const layer = armWith([NOTRE_DAME, MARSEILLE]);
    await tickLayer(layer);

    const body = await (await GET()).json();

    expect(body.armed).toBe(true);
    expect(body.maxLimit).toBe(50);
    const quake = body.layers.find((l: { layer: string }) => l.layer === 'earthquakes');
    expect(quake.cold).toBe(false);
    expect(quake.rowCount).toBe(2);
    // The report says how much it holds, never what it holds.
    expect(JSON.stringify(body)).not.toContain('nd');
  });

  it('lists live catalogue layers this server does not serve', async () => {
    armWith([NOTRE_DAME]);
    const body = await (await GET()).json();
    expect(body.unservedLiveLayers).toContain('fires');
    expect(body.unservedLiveLayers).not.toContain('earthquakes');
  });
});
