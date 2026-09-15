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
  const HEADER = 'country,country_long,name,gppd_idnr,capacity_mw,latitude,longitude,primary_fuel,commissioning_year,owner';

  const respondWith = (csv: string, ok = true) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, text: async () => csv })));

  const run = () => earthLayer('power_plants')!.fetch(new AbortController().signal);

  it('maps a row to an item, carrying fuel as the kind a filter matches on', async () => {
    respondWith(`${HEADER}\nPOL,Poland,Belchatow,WRI1000001,5298,51.266,19.33,Coal,1988,PGE`);
    const [plant] = await run();

    expect(plant.id).toBe('WRI1000001');
    expect(plant.lat).toBe(51.266);
    expect(plant.lng).toBe(19.33);
    expect(plant.label).toBe('Belchatow');
    expect(plant.kind).toBe('coal');
    expect(plant.props).toMatchObject({ capacityMw: 5298, country: 'Poland', owner: 'PGE' });
  });

  /* The reason this fetcher parses CSV properly instead of splitting on commas.
     A quoted owner containing a comma shifts every later column left, and
     latitude gets read out of the longitude field: the plant lands somewhere
     plausible and entirely wrong, and nothing fails. */
  it('reads a row whose owner name contains a comma', async () => {
    respondWith(`${HEADER}\nUSA,United States,Acme Plant,WRI999,100,40.5,-74.2,Gas,2001,"Acme Power, Inc."`);
    const [plant] = await run();

    expect(plant.lat).toBe(40.5);
    expect(plant.lng).toBe(-74.2);
    expect(plant.props.owner).toBe('Acme Power, Inc.');
  });

  it('finds its columns by name, so an inserted column moves nothing', async () => {
    const shuffled = 'gppd_idnr,longitude,latitude,name,primary_fuel,inserted_column';
    respondWith(`${shuffled}\nWRI7,19.33,51.266,Belchatow,Coal,junk`);
    const [plant] = await run();

    expect(plant.lat).toBe(51.266);
    expect(plant.lng).toBe(19.33);
  });

  /* [0,0] is a real place in the Gulf of Guinea, and a defaulted row would put
     a power station in it — a wrong answer that looks right. */
  it('skips a row with no usable position rather than defaulting it to nowhere', async () => {
    respondWith(`${HEADER}\nX,X,Ghost,WRI1,,,,Coal,,\nPOL,Poland,Real,WRI2,10,51.2,19.3,Coal,,`);
    const items = await run();

    expect(items.map(i => i.id)).toEqual(['WRI2']);
  });

  it('says which column it needed when the publisher changes the file', async () => {
    respondWith('country,name\nPOL,Belchatow');
    await expect(run()).rejects.toThrow(/latitude|longitude|gppd_idnr/);
  });

  it('throws rather than caching an error page as zero plants', async () => {
    respondWith('', false);
    await expect(run()).rejects.toThrow(/503/);
    respondWith(HEADER); // header only: a real answer with no rows is still no rows
    await expect(run()).rejects.toThrow(/no rows/);
  });

  /* registry.ts:71-76: a fetcher MUST pass the signal through, or a timeout
     only stops the scheduler waiting while the request runs on and collides
     with the next tick. */
  it('passes the abort signal to the request', async () => {
    const spy = vi.fn(async (_url: string, _init: RequestInit) =>
      ({ ok: true, status: 200, text: async () => `${HEADER}\nA,B,C,D,1,1,1,Coal,,` }));
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
