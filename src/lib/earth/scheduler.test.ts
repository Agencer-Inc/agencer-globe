import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  startEarthServer, stopEarthServer, resetEarthScheduler, tickLayer,
  layerRecord, layerItems, activeTimerCount, earthCacheKey,
} from './scheduler';
import { clearSourceCache, peekSource } from '@/lib/sourceCache';
import { EARTH_SERVER_FLAG, EARTH_ARMED_TOKEN } from './settings';
import type { EarthItem, EarthLayer } from './registry';

const ARMED = { [EARTH_SERVER_FLAG]: '1' } as unknown as NodeJS.ProcessEnv;
const DARK = {} as NodeJS.ProcessEnv;

const item = (id: string, lat = 0, lng = 0): EarthItem =>
  ({ id, lat, lng, label: id, kind: 'test', props: {} });

const fixture = (over: Partial<EarthLayer> = {}): EarthLayer => ({
  id: 'earthquakes',
  intervalMs: 60_000,
  ttlMs: 60_000,
  timeoutMs: 10_000,
  fetch: async () => [item('a')],
  ...over,
});

beforeEach(() => {
  resetEarthScheduler();
  clearSourceCache();
  vi.useFakeTimers();
});

afterEach(() => {
  resetEarthScheduler();
  vi.useRealTimers();
});

describe('the dark path', () => {
  // Not "the handle says armed:false" — that is the handle grading its own
  // homework. Count what actually exists in the process.
  it('creates no timer, no record and no cache entry, and calls nothing', () => {
    let called = 0;
    const handle = startEarthServer({
      layers: [fixture({ fetch: async () => { called++; return []; } })],
      env: DARK,
    });

    expect(handle.armed).toBe(false);
    expect(handle.reason).toBe('disabled');
    expect(handle.started).toEqual([]);
    expect(activeTimerCount()).toBe(0);
    expect(layerRecord('earthquakes')).toBeUndefined();
    expect(peekSource(earthCacheKey('earthquakes'), true)).toBeUndefined();
    expect(called).toBe(0);
  });

  it('does not arm on a truthy-but-off flag value', () => {
    for (const value of ['0', 'false', 'off', '']) {
      resetEarthScheduler();
      const handle = startEarthServer({
        layers: [fixture()],
        env: { [EARTH_SERVER_FLAG]: value } as unknown as NodeJS.ProcessEnv,
      });
      expect(handle.armed, `flag value ${JSON.stringify(value)}`).toBe(false);
      expect(activeTimerCount()).toBe(0);
    }
  });
});

describe('arming', () => {
  it('starts a fetcher for each live layer and none for a layer that is not live', async () => {
    const calls: string[] = [];
    const mk = (id: string, intervalMs: number) =>
      fixture({ id, intervalMs, fetch: async () => { calls.push(id); return [item(id)]; } });

    // Two live catalogue rows and one dead one. `balloons` cadence prose reads
    // "Requested every 5 minutes while the layer is on. Nothing answers."
    const handle = startEarthServer({
      layers: [mk('earthquakes', 60_000), mk('fires', 120_000), mk('balloons', 60_000)],
      env: ARMED,
      preWarm: [],
    });

    expect(handle.started).toEqual(['earthquakes', 'fires']);
    expect(activeTimerCount()).toBe(2);
    expect(layerRecord('balloons')).toBeUndefined();

    // ...and each runs on ITS OWN cadence, not a shared one.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(['earthquakes']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(['earthquakes', 'earthquakes', 'fires']);
    expect(calls).not.toContain('balloons');
  });

  it('witnesses itself by name when it arms, naming what it would not arm', () => {
    const lines: string[] = [];
    startEarthServer({
      layers: [fixture(), fixture({ id: 'balloons' })],
      env: ARMED,
      preWarm: [],
      log: (m) => lines.push(m),
    });

    expect(lines[0]).toContain(EARTH_ARMED_TOKEN);
    expect(lines[0]).toContain('earthquakes');
    expect(lines[0]).toContain('balloons (dead)');
  });

  it('pre-warms only the named set, immediately, without waiting out an interval', async () => {
    const calls: string[] = [];
    const mk = (id: string) => fixture({ id, fetch: async () => { calls.push(id); return [item(id)]; } });

    const handle = startEarthServer({
      layers: [mk('earthquakes'), mk('fires')],
      env: ARMED,
      preWarm: ['earthquakes'],
    });
    await handle.warmed;

    expect(calls).toEqual(['earthquakes']);
    expect(layerRecord('earthquakes')?.everFetched).toBe(true);
    expect(layerRecord('fires')?.everFetched).toBe(false);
  });

  it('re-arming replaces its timers rather than stacking a second set on one key', () => {
    startEarthServer({ layers: [fixture()], env: ARMED, preWarm: [] });
    startEarthServer({ layers: [fixture()], env: ARMED, preWarm: [] });
    expect(activeTimerCount()).toBe(1);
  });

  // stopEarthServer keeps records on purpose, so re-arming with a smaller set
  // used to leave a record behind for a layer with no timer, which GET then
  // reported as a live holding of something nothing was fetching.
  it('re-arming with fewer layers drops the records it no longer fetches', () => {
    startEarthServer({
      layers: [fixture({ id: 'earthquakes' }), fixture({ id: 'fires' })],
      env: ARMED,
      preWarm: [],
    });
    expect(layerRecord('fires')).toBeDefined();

    startEarthServer({ layers: [fixture({ id: 'earthquakes' })], env: ARMED, preWarm: [] });

    expect(layerRecord('earthquakes')).toBeDefined();
    expect(layerRecord('fires')).toBeUndefined();
    expect(activeTimerCount()).toBe(1);
  });
});

describe('the fetch record', () => {
  it('starts never_fetched, which is the only meaning of cold', () => {
    startEarthServer({ layers: [fixture()], env: ARMED, preWarm: [] });
    const record = layerRecord('earthquakes')!;
    expect(record.everFetched).toBe(false);
    expect(record.fetchedAt).toBeNull();
    expect(record.rowCount).toBe(0);
  });

  it('records a successful fetch and seeds the cache', async () => {
    const layer = fixture({ fetch: async () => [item('a'), item('b')] });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
    await tickLayer(layer);

    const record = layerRecord('earthquakes')!;
    expect(record.everFetched).toBe(true);
    expect(record.rowCount).toBe(2);
    expect(record.lastError).toBeNull();
    expect(layerItems('earthquakes')).toHaveLength(2);
  });

  // THE pin that catches deriving cold from the cache. seedSource refuses to
  // store an empty list (sourceCache.ts:122) and peekSource returns undefined
  // for one (:105), so the cache cannot tell this apart from never-fetched.
  it('a fetch that completed with zero rows is WARM, not cold', async () => {
    const layer = fixture({ fetch: async () => [] });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
    await tickLayer(layer);

    const record = layerRecord('earthquakes')!;
    expect(record.everFetched).toBe(true);
    expect(record.rowCount).toBe(0);
    expect(record.lastError).toBeNull();
    // The cache genuinely has nothing, and that is fine: the record is what says warm.
    expect(peekSource(earthCacheKey('earthquakes'), true)).toBeUndefined();
  });

  it('keeps the last good data and its age when a later refresh fails', async () => {
    let mode: 'ok' | 'boom' = 'ok';
    const layer = fixture({
      fetch: async () => {
        if (mode === 'boom') throw new Error('upstream on fire');
        return [item('a')];
      },
    });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    await tickLayer(layer);
    const fetchedAt = layerRecord('earthquakes')!.fetchedAt;

    // The clock MUST move between the good fetch and the failed one. Without
    // this the fake clock is frozen, Date.now() in the catch returns the same
    // value as the success, and a mutation that stamps fetchedAt on failure is
    // invisible. Found by mutating exactly that and watching this test stay
    // green (Law 31: a test that cannot fail is not a test).
    await vi.advanceTimersByTimeAsync(5_000);

    mode = 'boom';
    await tickLayer(layer);

    const record = layerRecord('earthquakes')!;
    expect(record.everFetched).toBe(true);           // still warm
    expect(record.fetchedAt).toBe(fetchedAt);        // age keeps counting from the real fetch
    expect(record.fetchedAt).toBeLessThan(Date.now()); // and the clock really did move
    expect(record.rowCount).toBe(1);                 // we still hold it
    expect(record.lastError).toContain('upstream on fire');
    expect(layerItems('earthquakes')).toHaveLength(1);
  });

  // Found by the outside voice, as an UNVERIFIED risk. It is real.
  // seedSource refuses to overwrite with an empty list (sourceCache.ts:122),
  // so after an empty refresh we STILL HOLD the older rows. Stamping fetchedAt
  // and rowCount=0 anyway meant the door served those old rows while calling
  // them freshly fetched, and the report said it held nothing while the query
  // returned things.
  it('an empty refresh that keeps older rows does not report them as freshly fetched', async () => {
    let items = [item('a')];
    const layer = fixture({ fetch: async () => items });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    await tickLayer(layer);
    const firstFetchedAt = layerRecord('earthquakes')!.fetchedAt;

    await vi.advanceTimersByTimeAsync(5_000);
    items = [];
    await tickLayer(layer);

    const record = layerRecord('earthquakes')!;
    // The cache still holds the old row, because seedSource would not clear it.
    expect(layerItems('earthquakes')).toHaveLength(1);
    // So the record must describe what is actually held, not what came back.
    expect(record.rowCount).toBe(1);
    expect(record.fetchedAt).toBe(firstFetchedAt);
    expect(record.lastRefreshEmpty).toBe(true);
  });

  it('an empty fetch with nothing already held is a real, fresh, empty answer', async () => {
    const layer = fixture({ fetch: async () => [] });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
    await tickLayer(layer);

    const record = layerRecord('earthquakes')!;
    expect(record.everFetched).toBe(true);
    expect(record.rowCount).toBe(0);
    expect(record.fetchedAt).not.toBeNull();
    expect(record.lastRefreshEmpty).toBe(false);
  });

  it('a first fetch that fails leaves the layer cold, with the error attached', async () => {
    const layer = fixture({ fetch: async () => { throw new Error('nope'); } });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
    await tickLayer(layer);

    const record = layerRecord('earthquakes')!;
    expect(record.everFetched).toBe(false);
    expect(record.lastError).toContain('nope');
  });

  it('hands back a copy, so a caller cannot edit the server state', async () => {
    startEarthServer({ layers: [fixture()], env: ARMED, preWarm: [] });
    const record = layerRecord('earthquakes')!;
    record.everFetched = true;
    expect(layerRecord('earthquakes')!.everFetched).toBe(false);
  });
});

describe('one fetch at a time, bounded in time', () => {
  // A wedged upstream must not mute a layer forever: the record and the
  // in-flight flag are released on the timeout even though the promise itself
  // cannot be cancelled.
  it('gives up on a fetch that outlives its timeout and names it', async () => {
    const layer = fixture({
      intervalMs: 60_000,
      timeoutMs: 1_000,
      fetch: () => new Promise<EarthItem[]>(() => {}), // never settles
    });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    const ticking = tickLayer(layer);
    await vi.advanceTimersByTimeAsync(1_001);
    await ticking;

    const record = layerRecord('earthquakes')!;
    expect(record.lastError).toContain('timed out after 1000ms');
    expect(record.inFlight).toBe(false);
    expect(record.everFetched).toBe(false);
  });

  // Promise.race alone stops the SCHEDULER waiting; it does not stop the
  // REQUEST. Without the abort, a timed-out fetch keeps running, the next tick
  // starts a second one against the same upstream, and skippedTicks counts
  // neither of them: the overlap arrives by a path inFlight cannot see.
  it('aborts a timed-out fetch, so it is not still running when the next tick starts', async () => {
    let aborted = false;
    const layer = fixture({
      intervalMs: 60_000,
      timeoutMs: 1_000,
      fetch: (signal: AbortSignal) => new Promise<EarthItem[]>((_, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
      }),
    });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    const ticking = tickLayer(layer);
    await vi.advanceTimersByTimeAsync(1_001);
    await ticking;

    expect(aborted).toBe(true);
    expect(layerRecord('earthquakes')!.inFlight).toBe(false);
  });

  it('a tick landing while a fetch is still out is SKIPPED and COUNTED', async () => {
    let calls = 0;
    const layer = fixture({
      fetch: () => { calls++; return new Promise<EarthItem[]>(() => {}); },
    });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    void tickLayer(layer);           // takes the slot, never settles
    await tickLayer(layer);          // lands on top of it
    await tickLayer(layer);          // and again

    expect(calls).toBe(1);
    expect(layerRecord('earthquakes')!.skippedTicks).toBe(2);
    expect(layerRecord('earthquakes')!.attempts).toBe(1);
  });

  it('frees the slot after a fetch settles, so the next tick runs', async () => {
    let calls = 0;
    const layer = fixture({ fetch: async () => { calls++; return [item('a')]; } });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    await tickLayer(layer);
    await tickLayer(layer);

    expect(calls).toBe(2);
    expect(layerRecord('earthquakes')!.skippedTicks).toBe(0);
  });

  it('frees the slot after a fetch throws, so one failure does not wedge the layer', async () => {
    let calls = 0;
    const layer = fixture({ fetch: async () => { calls++; throw new Error('boom'); } });
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });

    await tickLayer(layer);
    expect(layerRecord('earthquakes')!.inFlight).toBe(false);
    await tickLayer(layer);
    expect(calls).toBe(2);
  });
});

describe('stopping', () => {
  it('stops the timers but keeps what it knew', async () => {
    const layer = fixture();
    startEarthServer({ layers: [layer], env: ARMED, preWarm: [] });
    await tickLayer(layer);

    stopEarthServer();
    expect(activeTimerCount()).toBe(0);
    expect(layerRecord('earthquakes')?.everFetched).toBe(true);
  });

  it('no further ticks fire once stopped', async () => {
    let calls = 0;
    startEarthServer({
      layers: [fixture({ fetch: async () => { calls++; return []; } })],
      env: ARMED,
      preWarm: [],
    });
    stopEarthServer();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(calls).toBe(0);
  });
});
