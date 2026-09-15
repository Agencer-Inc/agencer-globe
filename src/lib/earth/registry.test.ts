import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  EARTH_LAYERS, PRE_WARM, earthLayer, registryProblems, unservedLiveLayers, selfOrigin,
  type EarthLayer,
} from './registry';
import { osirisLayer, OSIRIS_LAYERS } from '@/lib/layers-catalog';

afterEach(() => vi.unstubAllGlobals());

/**
 * The power plant fetcher, driven through its real registry row so the test
 * exercises the wiring and not a copy of it.
 *
 * NOTE FOR ANYONE READING THIS LAYER'S DATA: its licence has not been read.
 * The catalogue row says so in its own licence field and the query door carries
 * that sentence onto every answer. This pins the SHAPE of what the fetcher
 * produces, and says nothing about whether the data may be used.
 */
describe('the power plant fetcher', () => {
  const PLANT = {
    id: 'WRI1000001', name: 'Belchatow', lat: 51.266, lng: 19.33, fuel: 'coal',
    capacityMw: 5298, country: 'Poland', owner: 'PGE', commissioningYear: 1988,
  };

  const respondWith = (body: unknown, ok = true) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));

  const run = () => earthLayer('power_plants')!.fetch(new AbortController().signal);

  it('projects the route answer into the query shape, fuel as the kind a filter matches on', async () => {
    respondWith({ plants: [PLANT] });
    const [item] = await run();

    expect(item.id).toBe('WRI1000001');
    expect(item.lat).toBe(51.266);
    expect(item.label).toBe('Belchatow');
    expect(item.kind).toBe('coal');
    expect(item.props).toMatchObject({ capacityMw: 5298, country: 'Poland', owner: 'PGE' });
  });

  /* Law 19: api/power-plants owns the ~12MB read, the parse and the cache. This
     fetcher must go through it rather than opening a second connection to the
     publisher, exactly as the flights fetcher goes through api/flights. */
  it('reads this app own route, not the publisher directly', async () => {
    const spy = vi.fn(async (_url: string, _init: RequestInit) =>
      ({ ok: true, status: 200, json: async () => ({ plants: [] }) }));
    vi.stubGlobal('fetch', spy);
    await run();

    expect(String(spy.mock.calls[0][0])).toContain('/api/power-plants');
    expect(String(spy.mock.calls[0][0])).not.toContain('githubusercontent');
  });

  it('skips a row with no usable position', async () => {
    respondWith({ plants: [{ ...PLANT, id: 'ghost', lat: null }, PLANT] });
    expect((await run()).map(i => i.id)).toEqual(['WRI1000001']);
  });

  it('throws rather than caching a failed route as zero plants', async () => {
    respondWith({}, false);
    await expect(run()).rejects.toThrow(/503/);
  });

  /* registry.ts:71-76: a fetcher MUST pass the signal through, or a timeout
     only stops the scheduler waiting while the request runs on and collides
     with the next tick. */
  it('passes the abort signal to the request', async () => {
    const spy = vi.fn(async (_url: string, _init: RequestInit) =>
      ({ ok: true, status: 200, json: async () => ({ plants: [] }) }));
    vi.stubGlobal('fetch', spy);

    const controller = new AbortController();
    await earthLayer('power_plants')!.fetch(controller.signal);

    expect(spy.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

const fixture = (over: Partial<EarthLayer> = {}): EarthLayer => ({
  id: 'earthquakes',
  intervalMs: 60_000,
  ttlMs: 60_000,
  timeoutMs: 10_000,
  fetch: async () => [],
  ...over,
});

describe('the real registry', () => {
  it('has no problems', () => {
    expect(registryProblems()).toEqual([]);
  });

  it('registers only layers the catalogue calls live', () => {
    for (const layer of EARTH_LAYERS) {
      expect(osirisLayer(layer.id)?.status).toBe('live');
    }
  });

  it('gives every fetcher a timeout shorter than its own cadence', () => {
    for (const layer of EARTH_LAYERS) {
      expect(layer.timeoutMs).toBeLessThan(layer.intervalMs);
    }
  });

  it('pre-warms only layers it actually registered', () => {
    for (const id of PRE_WARM) expect(earthLayer(id)).toBeDefined();
  });

  /**
   * The scheduler arms a layer with setInterval and nothing else, so a layer
   * outside PRE_WARM first fetches one FULL INTERVAL after arming. Any layer
   * whose cadence is longer than a working session would therefore answer
   * never_fetched for the whole of that session — truthfully, about a layer
   * that is in practice permanently cold. Pre-warming is the only way such a
   * layer ever becomes warm, so it is a requirement and not a nicety.
   */
  it('pre-warms every layer whose interval is longer than a working day could wait', () => {
    const SESSION_MS = 4 * 60 * 60_000;
    const slowAndCold = EARTH_LAYERS
      .filter(l => l.intervalMs > SESSION_MS && !PRE_WARM.includes(l.id))
      .map(l => l.id);

    expect(
      slowAndCold,
      `these would answer never_fetched for a whole session: ${slowAndCold.join(', ')}`,
    ).toEqual([]);
  });

  it('reaches its own routes by IP, because localhost DNS is unreliable on the rig', () => {
    expect(selfOrigin({} as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:3000');
    expect(selfOrigin({ EARTH_SELF_ORIGIN: 'http://example.test' } as unknown as NodeJS.ProcessEnv))
      .toBe('http://example.test');
  });
});

describe('unservedLiveLayers', () => {
  // Computed, never hand-listed: a hand-written list of what is missing goes
  // stale the moment someone serves one of them.
  it('names every live catalogue row with no fetcher, and none that has one', () => {
    const unserved = unservedLiveLayers();
    for (const id of unserved) expect(osirisLayer(id)?.status).toBe('live');
    for (const layer of EARTH_LAYERS) expect(unserved).not.toContain(layer.id);

    const liveCount = OSIRIS_LAYERS.filter(r => r.status === 'live').length;
    expect(unserved.length).toBe(liveCount - EARTH_LAYERS.length);
  });

  it('does not claim a dead row is merely unserved', () => {
    expect(unservedLiveLayers()).not.toContain('balloons');
    expect(unservedLiveLayers()).not.toContain('war_alerts');
  });
});

// registryProblems is itself a verifier, so it is pinned against rows built to
// break each rule. A validator nobody proved rejects anything passes
// everything (Law 31).
describe('registryProblems rejects', () => {
  it('an id the catalogue does not have', () => {
    expect(registryProblems([fixture({ id: 'not_a_layer' })]))
      .toContain('not_a_layer is not a catalogue layer id');
  });

  // The load-bearing one: `balloons` cadence prose reads "Requested every 5
  // minutes while the layer is on. Nothing answers." A regex over that field
  // would schedule a fetcher against a route that does not exist.
  it('a dead catalogue row, whatever its cadence prose says', () => {
    expect(registryProblems([fixture({ id: 'balloons' })]))
      .toContain('balloons has catalogue status dead, so it must not have a fetcher');
  });

  it('a render_only row', () => {
    expect(registryProblems([fixture({ id: 'day_night' })]))
      .toContain('day_night has catalogue status render_only, so it must not have a fetcher');
  });

  it('a timeout that is not shorter than the cadence', () => {
    const problems = registryProblems([fixture({ intervalMs: 1000, timeoutMs: 1000 })]);
    expect(problems.join(' ')).toContain('is not less than intervalMs');
  });

  it('a non-positive interval, ttl or timeout', () => {
    expect(registryProblems([fixture({ intervalMs: 0 })]).join(' ')).toContain('intervalMs must be positive');
    expect(registryProblems([fixture({ ttlMs: 0 })]).join(' ')).toContain('ttlMs must be positive');
    expect(registryProblems([fixture({ timeoutMs: -1 })]).join(' ')).toContain('timeoutMs must be positive');
  });

  it('the same layer registered twice', () => {
    expect(registryProblems([fixture(), fixture()])).toContain('earthquakes is registered twice');
  });

  it('a row with no fetch function', () => {
    expect(registryProblems([fixture({ fetch: undefined as unknown as EarthLayer['fetch'] })]).join(' '))
      .toContain('has no fetch function');
  });

  it('and passes a well-formed row, so the rejections above mean something', () => {
    expect(registryProblems([fixture()])).toEqual([]);
  });
});
