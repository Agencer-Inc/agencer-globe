/**
 * OSIRIS earth server — the scheduler.
 *
 * Owns the timers, the per-layer fetch record, and every write to the
 * `earth:*` cache keys. Nothing else writes those keys (Law 19): sourceCache's
 * own `cachedSource` wrapper is a PULL cache and would become a second writer
 * on the same key with its own clock, so this module uses `seedSource` /
 * `peekSource` and never `cachedSource`.
 *
 *   arm? --no--> nothing. No timer, no record, no upstream call, and every
 *     |          route in this app behaves byte-identically (Law 32).
 *    yes
 *     v
 *   for each registry row: record = never_fetched, setInterval(tick, intervalMs)
 *     |
 *     +--> pre-warm set ticks immediately, so the demo is warm on arrival
 *     v
 *   tick ── inFlight? ──yes──> skippedTicks++, RETURN (never two at once)
 *     |
 *     no
 *     v
 *   race(fetch(signal), timeout(timeoutMs))  timeoutMs < intervalMs, pinned
 *     |                     |                in the registry
 *   settled              timed out --> controller.abort() CANCELS THE REQUEST.
 *     |                     |            Racing alone would only stop this
 *     |                     v            function waiting while the request
 *     |               record.lastError   kept running into the next tick.
 *     v
 *   empty, and we already hold rows?
 *     |                        \
 *     no                        yes --> lastRefreshEmpty = true, and
 *     v                                 fetchedAt/rowCount are NOT touched:
 *   record.fetchedAt=now                seedSource will not clear the old rows
 *   record.rowCount=n                   (sourceCache.ts:122), so those rows are
 *   seedSource('earth:<id>', ...)       what we still serve, and they are stale.
 *
 * WHY THE RECORD AND NOT THE CACHE ANSWERS "IS THIS COLD".
 * peekSource returns undefined for a zero-length entry (sourceCache.ts:105) and
 * seedSource refuses to store an empty list at all (:122). So "fetched, and the
 * upstream genuinely had nothing" and "never fetched" are the SAME value to a
 * cache reader. Deriving cold from cache truthiness is a probe that resolves
 * unknown to absent — a guard that fails open (Law 31). Cold is `!everFetched`,
 * read off this record, and nothing else.
 */

import { seedSource, peekSource } from '@/lib/sourceCache';
import { osirisLayer } from '@/lib/layers-catalog';
import { earthServerEnabled, EARTH_ARMED_TOKEN } from './settings';
import { EARTH_LAYERS, PRE_WARM, type EarthItem, type EarthLayer } from './registry';

/**
 * What this server knows about one layer's fetching, as opposed to what it
 * knows about that layer's data. Every field is set by this module only.
 */
export interface LayerRecord {
  layerId: string;
  /** false is the ONLY meaning of cold. Set true by the first completed fetch,
   *  including one that completed with zero rows. */
  everFetched: boolean;
  /** When the last fetch COMPLETED, success or empty. Null until one does.
   *  A failed attempt does not move this: the age of the data we still hold
   *  keeps counting from when we actually got it. */
  fetchedAt: number | null;
  /** Rows the last completed fetch returned. Zero is a real, warm answer. */
  rowCount: number;
  /** The most recent attempt's failure, or null if the most recent succeeded. */
  lastError: string | null;
  /**
   * The last refresh succeeded but returned nothing, while we still held older
   * rows. seedSource declines to overwrite with an empty list
   * (sourceCache.ts:122), so those older rows are what the door still serves,
   * and it must call them stale rather than fresh.
   */
  lastRefreshEmpty: boolean;
  inFlight: boolean;
  /** Ticks dropped because a fetch was still running. Counted, never silent. */
  skippedTicks: number;
  attempts: number;
}

/** The cache key a layer's items live under. One writer: this module. */
export function earthCacheKey(layerId: string): string {
  return `earth:${layerId}`;
}

const records = new Map<string, LayerRecord>();
const timers = new Map<string, ReturnType<typeof setInterval>>();

function blankRecord(layerId: string): LayerRecord {
  return {
    layerId,
    everFetched: false,
    fetchedAt: null,
    rowCount: 0,
    lastError: null,
    lastRefreshEmpty: false,
    inFlight: false,
    skippedTicks: 0,
    attempts: 0,
  };
}

/** The record for a layer, or undefined if this server never registered it. */
export function layerRecord(layerId: string): LayerRecord | undefined {
  const r = records.get(layerId);
  return r ? { ...r } : undefined;
}

/** Every record, copied. Used by the door to report what is warm. */
export function allRecords(): LayerRecord[] {
  return [...records.values()].map(r => ({ ...r }));
}

/** Read a layer's items without triggering anything. Stale reads are allowed
 *  on purpose: stale-and-said-so beats empty-and-silent. */
export function layerItems(layerId: string): EarthItem[] {
  return peekSource<EarthItem>(earthCacheKey(layerId), true) ?? [];
}

/**
 * A promise that rejects once the clock passes timeoutMs.
 *
 * The fetch itself cannot be cancelled — a promise has no abort — so the
 * dangling work may still complete later and is simply ignored. What this
 * guarantees is that the RECORD and the in-flight flag are released on time,
 * which is what stops one wedged upstream from muting a layer forever.
 */
function timeoutAfter(ms: number, layerId: string): { promise: Promise<never>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`${layerId} fetch timed out after ${ms}ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * One cycle for one layer. Never runs twice concurrently for the same layer.
 *
 * Exported for the pins: a test that can only reach this through setInterval
 * has to fake timers to assert anything about overlap, and then it is testing
 * the timer rather than the skip.
 */
export async function tickLayer(layer: EarthLayer): Promise<void> {
  const record = records.get(layer.id);
  if (!record) return;

  if (record.inFlight) {
    // The previous cycle is still out. Starting a second one would put two
    // writers on one cache key and two answers in flight for the same layer.
    record.skippedTicks++;
    return;
  }

  record.inFlight = true;
  record.attempts++;
  // The signal is what makes the timeout REAL. Promise.race alone only stops
  // this function waiting; the underlying request keeps running, and the next
  // tick then starts a second one against the same upstream while the first is
  // still open. That is precisely the overlap `inFlight` exists to prevent,
  // reached by a path `inFlight` cannot see. Found by the outside voice.
  const controller = new AbortController();
  const timeout = timeoutAfter(layer.timeoutMs, layer.id);

  try {
    const items = await Promise.race([layer.fetch(controller.signal), timeout.promise]);
    record.everFetched = true;
    record.lastError = null;

    const held = layerItems(layer.id);
    if (items.length === 0 && held.length > 0) {
      // seedSource will not overwrite with an empty list (sourceCache.ts:122),
      // so `held` is still what the door will serve. Stamping fetchedAt and
      // rowCount=0 here would tell two lies at once: the door would serve those
      // older rows while calling them freshly fetched, and the report would say
      // we hold nothing while the query returns things.
      record.lastRefreshEmpty = true;
    } else {
      record.lastRefreshEmpty = false;
      record.fetchedAt = Date.now();
      record.rowCount = items.length;
      seedSource<EarthItem>(earthCacheKey(layer.id), items, layer.ttlMs);
    }
  } catch (e) {
    record.lastError = e instanceof Error ? e.message : String(e);
    // fetchedAt, rowCount and everFetched are deliberately untouched: whatever
    // we last got is still what we hold, and the door reports it as warm and
    // stale with its real age rather than pretending it is gone.
    console.warn(`[OSIRIS earth] ${layer.id} fetch failed: ${record.lastError}`);
  } finally {
    timeout.cancel();
    // Unconditional: on the timeout path this is what actually cancels the
    // request, and on the success path the request has already settled so it
    // is a no-op. Either way nothing is left running once the slot is freed.
    controller.abort();
    record.inFlight = false;
  }
}

export interface EarthServerHandle {
  armed: boolean;
  /** Why the server is in the state it is in, in a word a log can carry. */
  reason: 'disabled' | 'armed';
  /** Layer ids that got a timer. Empty when dark. */
  started: string[];
  /** Settles when the pre-warm cycles have finished, so a caller can wait for
   *  a warm server instead of racing it. Resolves immediately when dark. */
  warmed: Promise<void>;
  stop(): void;
}

export interface StartOptions {
  /** Defaults to the real registry. A fixture registry is how the pins drive
   *  this without standing up two live upstreams. */
  layers?: readonly EarthLayer[];
  /** Defaults to process.env. A test proves the dark path without mutating the
   *  worker's environment. */
  env?: NodeJS.ProcessEnv;
  preWarm?: readonly string[];
  log?: (message: string) => void;
}

/**
 * Arm the earth server, or do precisely nothing.
 *
 * The dark path creates no timer, no record and no cache entry, and calls no
 * upstream. That is the byte-identical guarantee, and it is asserted by
 * counting timers and records rather than by reading the flag back.
 */
export function startEarthServer(opts: StartOptions = {}): EarthServerHandle {
  const {
    layers = EARTH_LAYERS,
    env = process.env,
    preWarm = PRE_WARM,
    log = (m: string) => console.log(m),
  } = opts;

  if (!earthServerEnabled(env)) {
    return {
      armed: false,
      reason: 'disabled',
      started: [],
      warmed: Promise.resolve(),
      stop() {},
    };
  }

  stopEarthServer(); // never two schedulers on one key (Law 19)

  const started: string[] = [];
  const skipped: string[] = [];
  for (const layer of layers) {
    // The status gate lives HERE and not only in registryProblems(). A
    // validator is advice a caller may never ask for; the scheduler is what
    // actually creates the timer, so the scheduler is what has to refuse. A
    // row that is dead, catalogued or render_only gets no fetcher whatever its
    // cadence prose says, and the door answers it from the catalogue instead.
    const row = osirisLayer(layer.id);
    if (!row || row.status !== 'live') {
      skipped.push(`${layer.id} (${row ? row.status : 'not in catalogue'})`);
      continue;
    }

    records.set(layer.id, blankRecord(layer.id));
    const timer = setInterval(() => { void tickLayer(layer); }, layer.intervalMs);
    // Node keeps the process alive for an interval; this one should not hold a
    // server open on its own.
    (timer as unknown as { unref?: () => void }).unref?.();
    timers.set(layer.id, timer);
    started.push(layer.id);
  }

  // The witness: an armed server says so, by name, with what it armed AND what
  // it refused to arm. A capability that cannot be witnessed while armed is
  // unshippable (Law 32), and a skip nobody can see is a skip nobody can audit.
  log(
    `${EARTH_ARMED_TOKEN} ${started.length} layers: ${started.join(', ') || 'none'}` +
    (skipped.length ? ` | not live, no fetcher: ${skipped.join(', ')}` : ''),
  );

  const warmSet = layers.filter(l => preWarm.includes(l.id));
  const warmed = Promise.all(warmSet.map(l => tickLayer(l))).then(() => undefined);

  return { armed: true, reason: 'armed', started, warmed, stop: stopEarthServer };
}

/** Drop every timer. Records are kept so the door can still say what it knew. */
export function stopEarthServer(): void {
  for (const timer of timers.values()) clearInterval(timer);
  timers.clear();
}

/** Test seam — drops timers AND records, so one case cannot warm the next. */
export function resetEarthScheduler(): void {
  stopEarthServer();
  records.clear();
}

/** How many timers are live. The dark-path pin counts this rather than
 *  trusting the handle to report itself honestly (Law 31). */
export function activeTimerCount(): number {
  return timers.size;
}
