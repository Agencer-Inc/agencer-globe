import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { planQuery, MAX_LIMIT, DEFAULT_LIMIT, COLD_REASONS } from './query';
import { startEarthServer, resetEarthScheduler, tickLayer } from './scheduler';
import { clearSourceCache } from '@/lib/sourceCache';
import { EARTH_SERVER_FLAG } from './settings';
import { earthLayer, type EarthItem, type EarthLayer } from './registry';
import { PLACES } from './places';
import { osirisLayer, OSIRIS_LAYERS } from '@/lib/layers-catalog';

const ARMED = { [EARTH_SERVER_FLAG]: '1' } as unknown as NodeJS.ProcessEnv;
const USER = { userId: 'op-1' };

const at = (id: string, lat: number, lng: number, kind = 'quake'): EarthItem =>
  ({ id, lat, lng, label: id, kind, props: {} });

/** Inside the Paris box (PLACES.paris = [1.8, 48.5, 3.0, 49.2]). */
const NOTRE_DAME = at('nd', 48.853, 2.349);
const MARSEILLE = at('mrs', 43.296, 5.370);

function armWith(items: EarthItem[], over: Partial<EarthLayer> = {}) {
  const layer: EarthLayer = {
    id: 'earthquakes',
    intervalMs: 60_000,
    ttlMs: 60_000,
    timeoutMs: 10_000,
    fetch: async () => items,
    ...over,
  };
  startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
  return layer;
}

beforeEach(() => {
  resetEarthScheduler();
  clearSourceCache();
  vi.useFakeTimers();
});

afterEach(() => {
  resetEarthScheduler();
  vi.useRealTimers();
});

describe('the door names its caller (THE-GATE rule 3)', () => {
  it('refuses an anonymous query BY NAME', () => {
    const got = planQuery({ layer: 'earthquakes' }, {});
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('anonymous');
  });

  it('refuses a blank or non-string user id', () => {
    for (const userId of ['', '   ', null, undefined, 7 as unknown as string]) {
      const got = planQuery({ layer: 'earthquakes' }, { userId: userId as string });
      expect(got.ok, `userId ${JSON.stringify(userId)}`).toBe(false);
    }
  });

  // Checked FIRST: a door that validates the body before naming its caller has
  // already done work for a stranger, and leaks which layers exist by the
  // shape of its refusals.
  it('refuses anonymously before it will even say a layer is unknown', () => {
    const got = planQuery({ layer: 'definitely_not_a_layer' }, {});
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('anonymous');
  });
});

describe('scope', () => {
  it('answers a bbox query from the cache, never by fetching', async () => {
    let calls = 0;
    const layer = armWith([NOTRE_DAME, MARSEILLE], {
      fetch: async () => { calls++; return [NOTRE_DAME, MARSEILLE]; },
    });
    await tickLayer(layer);
    const before = calls;

    const got = planQuery({ layer: 'earthquakes', bbox: PLACES.paris.bbox }, USER);

    expect(calls).toBe(before);            // the query path fetched nothing
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.items.map(i => i.id)).toEqual(['nd']);
      expect(got.matched).toBe(1);
    }
  });

  it('resolves a demo place to the same answer as its box', async () => {
    const layer = armWith([NOTRE_DAME, MARSEILLE]);
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes', place: 'Paris' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.place).toBe('paris');
      expect(got.bbox).toEqual(PLACES.paris.bbox);
      expect(got.items.map(i => i.id)).toEqual(['nd']);
    }
  });

  it('refuses an unknown place by name rather than widening to the whole layer', async () => {
    const layer = armWith([NOTRE_DAME, MARSEILLE]);
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes', place: 'Marseille' }, USER);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('place_unknown');
  });

  // The consequence of the places bug, at the door: an undefined bbox is
  // falsy, so `if (scope.bbox)` skips filtering and the caller gets the WHOLE
  // layer back while having asked for one city.
  it('a prototype key as a place does not silently return the unfiltered layer', async () => {
    const layer = armWith([NOTRE_DAME, MARSEILLE]);
    await tickLayer(layer);

    for (const key of ['constructor', '__proto__', 'toString']) {
      const got = planQuery({ layer: 'earthquakes', place: key }, USER);
      expect(got.ok, `place ${key}`).toBe(false);
      if (!got.ok) expect(got.refusal).toBe('place_unknown');
    }
  });

  it('refuses place AND bbox together, because two scopes cannot both be the answer', () => {
    const got = planQuery({ layer: 'earthquakes', place: 'paris', bbox: PLACES.tokyo.bbox }, USER);
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.refusal).toBe('malformed');
      expect(got.detail).toContain('not both');
    }
  });

  it('refuses a malformed bbox and says what is wrong with it', () => {
    const got = planQuery({ layer: 'earthquakes', bbox: [1, 2, 3] }, USER);
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.refusal).toBe('malformed');
      expect(got.detail).toContain('four numbers');
    }
  });

  it('filters on kind and label, case-insensitively', async () => {
    const layer = armWith([at('a', 0, 0, 'quake'), at('b', 0, 0, 'explosion')]);
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes', filter: 'EXPLO' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.items.map(i => i.id)).toEqual(['b']);
  });
});

describe('the limit is a ceiling, and it says when it bites', () => {
  const many = Array.from({ length: 120 }, (_, i) => at(`e${i}`, 0, 0));

  it('clamps a limit of 500 to 50 AND reports that it clamped', async () => {
    const layer = armWith(many);
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes', limit: 500 }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.limit).toBe(MAX_LIMIT);
      expect(got.limit).toBe(50);
      expect(got.limitRequested).toBe(500);
      expect(got.limitClamped).toBe(true);
      expect(got.items).toHaveLength(50);
      expect(got.returned).toBe(50);
      expect(got.matched).toBe(120);   // the caller learns what it did not see
    }
  });

  it('does not claim to have clamped when it did not', async () => {
    const layer = armWith(many);
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes', limit: 10 }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.limitClamped).toBe(false);
      expect(got.items).toHaveLength(10);
    }
  });

  it('uses a modest default when no limit is named', async () => {
    const layer = armWith(many);
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes' }, USER);
    if (got.ok) expect(got.items).toHaveLength(DEFAULT_LIMIT);
  });

  it('refuses a limit that is not a whole positive number', () => {
    for (const limit of [0, -1, 1.5, 'ten', NaN]) {
      const got = planQuery({ layer: 'earthquakes', limit }, USER);
      expect(got.ok, `limit ${JSON.stringify(limit)}`).toBe(false);
    }
  });
});

describe('cold, and the reason', () => {
  it('a registered layer that has never fetched reads COLD', () => {
    armWith([NOTRE_DAME]);
    const got = planQuery({ layer: 'earthquakes' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.cold).toBe(true);
      expect(got.coldReason).toBe('never_fetched');
      expect(got.ageSeconds).toBeNull();
    }
  });

  // The companion pin. If cold were read off the cache, this would read cold,
  // because seedSource stores nothing for an empty list.
  it('a layer that fetched and got nothing reads WARM with zero rows', async () => {
    const layer = armWith([], { fetch: async () => [] });
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.cold).toBe(false);
      expect(got.coldReason).toBeNull();
      expect(got.items).toEqual([]);
      expect(got.matched).toBe(0);
      expect(got.ageSeconds).not.toBeNull();
    }
  });

  it('a layer whose refresh failed after a good fetch reads WARM and STALE with its age', async () => {
    let mode: 'ok' | 'boom' = 'ok';
    const layer = armWith([], {
      fetch: async () => {
        if (mode === 'boom') throw new Error('upstream on fire');
        return [NOTRE_DAME];
      },
    });
    await tickLayer(layer);
    const fetchedAt = Date.now();

    // The clock has to move between the good fetch and the failed one, or a
    // mutation that stamps fetchedAt on failure cannot be seen: the frozen fake
    // clock makes the wrong value identical to the right one (Law 31).
    await vi.advanceTimersByTimeAsync(5_000);
    mode = 'boom';
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes' }, { ...USER, now: fetchedAt + 90_000 });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.cold).toBe(false);
      expect(got.stale).toBe(true);
      expect(got.lastError).toContain('upstream on fire');
      expect(got.ageSeconds).toBe(90);
      expect(got.items).toHaveLength(1);   // still serving what we hold
    }
  });

  it('warm data past its TTL is stale, and says the age', async () => {
    const layer = armWith([NOTRE_DAME]);
    await tickLayer(layer);
    const ttl = earthLayer('earthquakes')!.ttlMs;

    const fresh = planQuery({ layer: 'earthquakes' }, { ...USER, now: Date.now() + 1000 });
    if (fresh.ok) expect(fresh.stale).toBe(false);

    const old = planQuery({ layer: 'earthquakes' }, { ...USER, now: Date.now() + ttl + 1000 });
    if (old.ok) {
      expect(old.stale).toBe(true);
      expect(old.ageSeconds).toBe(Math.round((ttl + 1000) / 1000));
    }
  });

  it('rows kept alive through an empty refresh are served as STALE, not fresh', async () => {
    let items = [NOTRE_DAME];
    const layer = armWith([], { fetch: async () => items });
    await tickLayer(layer);
    const fetchedAt = Date.now();

    await vi.advanceTimersByTimeAsync(5_000);
    items = [];
    await tickLayer(layer);

    const got = planQuery({ layer: 'earthquakes' }, { ...USER, now: fetchedAt + 5_000 });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.items).toHaveLength(1);   // we are still serving the old row
      expect(got.stale).toBe(true);        // and we say so
      expect(got.ageSeconds).toBe(5);      // with its real age, not zero
    }
  });

  it('a live layer with no fetcher here is cold for THAT reason, not never_fetched', () => {
    armWith([NOTRE_DAME]);
    const got = planQuery({ layer: 'fires' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.cold).toBe(true);
      expect(got.coldReason).toBe('not_served_here');
      expect(got.coldDetail).toContain('no fetcher');
    }
  });
});

describe('layers that are not live are answered from the catalogue as it stands', () => {
  it('names a dead layer dead, with the catalogue\'s own reason', () => {
    const got = planQuery({ layer: 'balloons' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.cold).toBe(true);
      expect(got.coldReason).toBe('dead');
      // Verbatim from layers-catalog.ts:307, not a sentence this file invented.
      expect(got.coldDetail).toBe(osirisLayer('balloons')!.source);
      expect(got.coldDetail).toContain('does not exist');
      expect(got.items).toEqual([]);
    }
  });

  it('names war_alerts dead rather than pretending it is merely empty', () => {
    const got = planQuery({ layer: 'war_alerts' }, USER);
    if (got.ok) {
      expect(got.coldReason).toBe('dead');
      expect(got.coldDetail).toContain('No component, effect or route reads this id');
    }
  });

  it('names a render_only layer render_only', () => {
    const got = planQuery({ layer: 'day_night' }, USER);
    if (got.ok) expect(got.coldReason).toBe('render_only');
  });

  it('names an unsourced layer unsourced', () => {
    const got = planQuery({ layer: 'cables' }, USER);
    if (got.ok) expect(got.coldReason).toBe('unsourced');
  });

  // query.ts carries row.status across a module boundary with a cast. A cast
  // is a promise the compiler cannot check: add a status to layers-catalog.ts
  // and the door starts emitting a coldReason that is not one. This is the
  // check the cast does not do.
  it('every non-live catalogue status is a coldReason the door can name', () => {
    const statuses = new Set(OSIRIS_LAYERS.map(r => r.status));
    expect(statuses.size).toBeGreaterThan(1);
    for (const status of statuses) {
      if (status === 'live') continue;
      expect(COLD_REASONS, `catalogue status ${status}`).toContain(status);
    }
  });

  it('refuses a layer the catalogue has never heard of', () => {
    const got = planQuery({ layer: 'unicorns' }, USER);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('unknown_layer');
  });

  it('refuses a missing or empty layer name', () => {
    expect(planQuery({}, USER).ok).toBe(false);
    expect(planQuery({ layer: '  ' }, USER).ok).toBe(false);
  });
});

describe('provenance rides on every answer, read from the catalogue', () => {
  it('carries the row\'s licence, source and cadence verbatim, never a guess', async () => {
    const layer = armWith([NOTRE_DAME]);
    await tickLayer(layer);

    const row = osirisLayer('earthquakes')!;
    const got = planQuery({ layer: 'earthquakes' }, USER);
    if (got.ok) {
      expect(got.provenance).toEqual({
        status: row.status,
        source: row.source,
        cadence: row.cadence,
        licence: row.licence,
        sourceUrl: row.sourceUrl,
      });
    }
  });

  it('carries provenance on a cold answer too, so a caller can still read the terms', () => {
    const got = planQuery({ layer: 'balloons' }, USER);
    if (got.ok) expect(got.provenance?.licence).toContain('No data has ever reached this layer');
  });
});

describe('our own trove, as sdk_ layers', () => {
  const store = () =>
    (globalThis as unknown as { sdkEntityStore: Map<string, unknown> }).sdkEntityStore;

  beforeEach(() => {
    (globalThis as unknown as { sdkEntityStore: Map<string, unknown> }).sdkEntityStore = new Map();
  });

  const ingest = (provider: string, id: string, lat: number, lng: number) => {
    // Exactly the shape api/sdk/ingest/route.ts:80-109 normalises to.
    store().set(`ext-${provider}-${id}`, {
      id: `ext-${provider}-${id}`,
      name: `ENTITY-${id}`,
      domain: 'LAND',
      entityType: 'TRACK',
      position: { lat, lng },
      threat: 'NONE',
      classification: 'UNCLASSIFIED',
      source: { provider, feed: 'ingest-api', originalId: id, confidence: 0.8 },
      timestamp: '2026-09-13T00:00:00Z',
    });
  };

  it('three ingested entities appear as one sdk_ layer', () => {
    ingest('iris', '1', 48.85, 2.35);
    ingest('iris', '2', 48.86, 2.36);
    ingest('iris', '3', 48.87, 2.37);

    const got = planQuery({ layer: 'sdk_iris' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.items).toHaveLength(3);
      expect(got.cold).toBe(false);       // push-fed, never cold
      expect(got.matched).toBe(3);
    }
  });

  // Found by the outside voice. ageSeconds: 0 asserts "measured just now",
  // which nothing measured: the store carries each entity's own timestamp and
  // this server never polls it. Unknown is null, not zero.
  it('does not claim an ingested entity was measured just now', () => {
    ingest('iris', '1', 48.85, 2.35);
    const got = planQuery({ layer: 'sdk_iris' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.ageSeconds).toBeNull();
      expect(got.cold).toBe(false);
    }
  });

  it('a provider name with a space becomes one stable id', () => {
    ingest('Total Recall', '1', 48.85, 2.35);
    const got = planQuery({ layer: 'sdk_total_recall' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.items).toHaveLength(1);
  });

  it('an sdk_ layer respects the bbox and the limit like any other', () => {
    ingest('iris', '1', 48.85, 2.35);    // Paris
    ingest('iris', '2', 43.29, 5.37);    // Marseille

    const got = planQuery({ layer: 'sdk_iris', place: 'paris' }, USER);
    if (got.ok) expect(got.items).toHaveLength(1);
  });

  it('refuses an sdk_ layer nobody has ingested', () => {
    const got = planQuery({ layer: 'sdk_nobody' }, USER);
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.refusal).toBe('unknown_layer');
  });

  // An upload must never shadow a catalogue id. sdk_sea, sdk_air and sdk_naval
  // are real render_only rows (layers-catalog.ts:405-427).
  it('an ingest calling itself "sea" cannot shadow the catalogue\'s sdk_sea', () => {
    ingest('sea', '1', 48.85, 2.35);

    const got = planQuery({ layer: 'sdk_sea' }, USER);
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.coldReason).toBe('render_only');   // the catalogue answered, not the upload
      expect(got.items).toEqual([]);
    }
  });

  it('drops an entity with no usable position rather than placing it at null island', () => {
    ingest('iris', '1', 48.85, 2.35);
    store().set('ext-iris-bad', {
      id: 'ext-iris-bad', position: {}, source: { provider: 'iris' },
    });

    const got = planQuery({ layer: 'sdk_iris' }, USER);
    if (got.ok) {
      expect(got.items).toHaveLength(1);
      expect(got.items.every(i => i.lat !== 0 || i.lng !== 0)).toBe(true);
    }
  });
});
