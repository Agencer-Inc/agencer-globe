/**
 * OSIRIS earth server — the fetcher registry.
 *
 * One row per layer this server actually fetches, keyed by the catalogue id.
 * The catalogue (layers-catalog.ts) says what a layer IS; this file says how
 * this server pulls it and how often. A row here whose id is not in the
 * catalogue, or whose catalogue status is not `live`, is a bug that
 * registryProblems() names rather than a thing that quietly runs.
 *
 *   layers-catalog.ts  OSIRIS_LAYERS[]  ── status, licence, source, cadence prose
 *            |                                        ^
 *            |  osirisLayer(id)                       |  registryProblems()
 *            v                                        |  cross-checks both ways
 *   EARTH_LAYERS[]  ── intervalMs, ttlMs, timeoutMs, fetch()
 *            |
 *            v
 *   scheduler.ts  ── owns the timer, one writer per cache key
 *
 * WHY intervalMs IS DECLARED HERE AND NOT PARSED FROM THE ROW.
 * CatalogRow.cadence is prose, on purpose (layers-catalog.ts:129), and the
 * catalogue is explicit that its text fields are not read by code to route on
 * (:124-126). Two rows show why a regex over it would be a guard that fails
 * open: `balloons` reads "Requested every 5 minutes while the layer is on.
 * Nothing answers." and `radiation` the same — both are status `dead`, and a
 * naive /every (\d+) minutes/ would happily schedule a 5-minute fetcher against
 * a route that does not exist. So the machine-readable interval is declared
 * here, in a number, with the row's own prose quoted beside it for a human to
 * check. registryProblems() pins that every declared row is live in the
 * catalogue; a human checks the number against the quote.
 */

import { osirisLayer, OSIRIS_LAYERS } from '@/lib/layers-catalog';
import { httpJson } from '@/lib/httpJson';
import { parseCsv, csvColumns } from '@/lib/csv';

/**
 * One thing on the earth, flattened to what a bounded query needs.
 *
 * Deliberately NOT the upstream's own shape. The door answers from this, so a
 * feed that changes its field names breaks its own fetcher's mapping and not
 * every consumer of the door.
 */
export interface EarthItem {
  /** Stable within a layer, so a caller can de-duplicate across two answers. */
  id: string;
  lat: number;
  lng: number;
  /** What a person would call this thing. */
  label: string;
  /** The sub-kind `filter` matches against, lowercase. Never free text. */
  kind: string;
  /** Everything else the fetcher chose to carry through. Not searched. */
  props: Record<string, unknown>;
}

export interface EarthLayer {
  /** Must be an id in OSIRIS_LAYERS, and that row's status must be `live`. */
  id: string;
  /**
   * How often the scheduler ticks this layer. A NUMBER, not a parse of prose.
   * The row's own cadence sentence is quoted at each definition below.
   */
  intervalMs: number;
  /** How long a fetched result stays warm in the cache. */
  ttlMs: number;
  /**
   * Hard cap on one fetch. MUST be < intervalMs: a fetch that outlives its own
   * cadence guarantees the next tick collides with it, which is the overlap the
   * scheduler then has to skip forever. registryProblems() pins it.
   */
  timeoutMs: number;
  /**
   * The signal is aborted when timeoutMs elapses. A fetcher MUST pass it to
   * whatever it calls, or the timeout only stops the scheduler waiting while
   * the request itself keeps running and collides with the next tick.
   */
  fetch: (signal: AbortSignal) => Promise<EarthItem[]>;
}

/** Where this server reaches its own routes. 127.0.0.1 because localhost DNS
 *  is unreliable on the build rig; a hostname here has cost a leg before. */
export function selfOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return env.EARTH_SELF_ORIGIN || 'http://127.0.0.1:3000';
}

/** The catalogue's own url for a layer. Read, never retyped: a second copy of
 *  a url is a second thing that can drift from the licence recorded beside it. */
function rowUrl(id: string): string {
  const url = osirisLayer(id)?.sourceUrl;
  if (!url) throw new Error(`earth: catalogue row ${id} has no sourceUrl to fetch`);
  return url;
}

interface UsgsFeature {
  id: string;
  geometry?: { coordinates?: [number, number, number] };
  properties?: { mag?: number; place?: string; time?: number; type?: string; alert?: string | null };
}

/**
 * Seismic events, straight from the USGS feed the catalogue row names.
 *
 * The mapping mirrors api/earthquakes/route.ts:24-41 rather than importing it,
 * because that route returns a NextResponse and shaping a Response back into
 * objects to re-flatten them is more moving parts than the eight lines below.
 * Both read the same upstream; neither is the other's cache (Law 19: the route
 * owns its HTTP cache, this owns `earth:earthquakes`, and they never write to
 * each other's key).
 */
async function fetchEarthquakes(signal: AbortSignal): Promise<EarthItem[]> {
  // httpJson wraps node:https and takes no AbortSignal, so its own timeoutMs is
  // what bounds this request. Checked here so an already-aborted tick does not
  // open a connection it has no intention of reading.
  if (signal.aborted) throw new Error('earthquakes fetch aborted before it started');
  const data = await httpJson<{ features?: UsgsFeature[] }>(rowUrl('earthquakes'), { timeoutMs: 20_000 });
  const items: EarthItem[] = [];
  for (const f of data.features ?? []) {
    const coords = f.geometry?.coordinates;
    if (!coords || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') continue;
    const p = f.properties ?? {};
    items.push({
      id: f.id,
      lat: coords[1],
      lng: coords[0],
      label: p.place || `M${p.mag ?? '?'} event`,
      kind: (p.type || 'earthquake').toLowerCase(),
      props: { magnitude: p.mag, depthKm: coords[2], time: p.time, alert: p.alert ?? null },
    });
  }
  return items;
}

interface FlightRow {
  callsign?: string;
  lat?: number;
  lng?: number;
  alt?: number;
  speed_knots?: number | null;
  model?: string;
  icao24?: string;
  airline_code?: string;
  category?: string;
  grounded?: boolean;
}

/**
 * Commercial traffic, via this app's OWN /api/flights route.
 *
 * That route is the single owner of the ADS-B fan-out (Law 19): it holds the
 * OpenSky credential budget, the 429 cooldown and the adsb.fi pacing
 * (api/flights/route.ts:220-251), all of which are correctness-critical and
 * none of which should exist twice. This fetcher therefore takes the route's
 * answer and keeps only the query-shaped projection of it. The earth TTL below
 * is deliberately shorter than the route's own 90s cache, so this copy can
 * never serve something older than the route would have.
 */
async function fetchFlights(signal: AbortSignal): Promise<EarthItem[]> {
  const res = await fetch(`${selfOrigin()}/api/flights`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new Error(`/api/flights answered ${res.status}`);
  const data = (await res.json()) as { commercial_flights?: FlightRow[] };
  const items: EarthItem[] = [];
  for (const f of data.commercial_flights ?? []) {
    if (typeof f.lat !== 'number' || typeof f.lng !== 'number') continue;
    items.push({
      id: f.icao24 || f.callsign || `${f.lat},${f.lng}`,
      lat: f.lat,
      lng: f.lng,
      label: f.callsign || f.icao24 || 'UNKNOWN',
      kind: (f.airline_code || 'flight').toLowerCase(),
      props: {
        altitudeM: f.alt,
        speedKnots: f.speed_knots ?? null,
        model: f.model,
        // null, not false. An absent field means the upstream did not say, and
        // `false` would assert "observed airborne" on no evidence.
        grounded: f.grounded ?? null,
      },
    });
  }
  return items;
}

/**
 * Power stations, from the CSV the catalogue row names.
 *
 * THE LICENCE FOR THIS DATA HAS NOT BEEN READ. The catalogue row says so in its
 * own licence field, and the query door carries that sentence verbatim onto
 * every answer, so nobody consuming this layer can miss it. Reading the terms is
 * 313-24 and it has not happened; this fetcher exists so the shape of the thing
 * can be seen working first.
 *
 * A RELEASE, NOT A FEED. The published database is a versioned file of ~35,000
 * rows and about 12MB. It is read once a day — far more often than it changes —
 * because a long interval satisfies every rule registryProblems already
 * enforces, where a `static` layer kind would have earned a second code path
 * through the scheduler for exactly one row.
 *
 * Parsed with lib/csv.ts rather than a split on commas: owner names in this
 * dataset contain commas, and a naive split shifts latitude out of the
 * longitude column and puts the plant somewhere plausible and wrong.
 */
async function fetchPowerPlants(signal: AbortSignal): Promise<EarthItem[]> {
  const res = await fetch(rowUrl('power_plants'), { headers: { Accept: 'text/csv' }, signal });
  if (!res.ok) throw new Error(`power plant database answered ${res.status}`);

  const rows = parseCsv(await res.text());
  if (rows.length < 2) throw new Error('power plant database returned no rows');

  // By NAME, never by position: column order is not part of the publisher's
  // promise, and reading latitude from a fixed index works right up until a
  // column is inserted before it, at which point every plant moves silently.
  const at = csvColumns(rows[0]);
  const { latitude, longitude, name, gppd_idnr: id, primary_fuel: fuel } = at;
  if (latitude === undefined || longitude === undefined || id === undefined) {
    throw new Error(
      'power plant database is missing a column this fetcher needs ' +
      `(latitude, longitude, gppd_idnr); it has: ${rows[0].join(', ')}`,
    );
  }

  /**
   * An EMPTY cell is not a zero.
   *
   * `Number('')` is 0 and 0 is finite, so a plain Number() on a blank latitude
   * passes every check and puts the station at [0, 0] — a real place in the
   * Gulf of Guinea. The pin for this caught it on the way in.
   */
  const num = (value: string | undefined): number =>
    value === undefined || value.trim() === '' ? NaN : Number(value);

  const items: EarthItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const lat = num(row[latitude]);
    const lng = num(row[longitude]);
    // A row without a real position is skipped, not defaulted.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const capacity = at.capacity_mw === undefined ? NaN : num(row[at.capacity_mw]);

    items.push({
      id: row[id] || `${lat},${lng}`,
      lat,
      lng,
      label: (name === undefined ? '' : row[name]) || 'Unnamed station',
      // The sub-kind `filter` matches on, so "show me the coal plants in Poland"
      // is a filter this door can already answer.
      kind: ((fuel === undefined ? '' : row[fuel]) || 'unknown').toLowerCase(),
      props: {
        capacityMw: Number.isFinite(capacity) ? capacity : null,
        country: at.country_long === undefined ? null : row[at.country_long] || null,
        fuel: fuel === undefined ? null : row[fuel] || null,
        owner: at.owner === undefined ? null : row[at.owner] || null,
        // null, not a guess: an absent commissioning year means the publisher
        // did not say, and 0 would assert a year nobody recorded.
        commissioningYear: at.commissioning_year === undefined
          ? null
          : num(row[at.commissioning_year]) || null,
      },
    });
  }
  return items;
}

/**
 * The layers this server fetches. Everything else in the catalogue is answered
 * honestly as not served here rather than pretended at.
 *
 * Two rows, because two is what the 313-26 demo ride needs and a registry row
 * is one object once the shared ADS-B loader exists (313-24 adds the private /
 * jets / military slices, which are the same request split four ways —
 * layers-catalog.ts:221).
 */
export const EARTH_LAYERS: readonly EarthLayer[] = [
  {
    id: 'flights',
    // Row cadence: "Once when the layer opens, then every 5 minutes (page.tsx:832)."
    intervalMs: 5 * 60_000,
    ttlMs: 60_000,
    timeoutMs: 45_000,
    fetch: fetchFlights,
  },
  {
    id: 'earthquakes',
    // Row cadence: "Every 15 minutes, and only while the tab is visible (page.tsx:684)."
    intervalMs: 15 * 60_000,
    ttlMs: 20 * 60_000,
    timeoutMs: 30_000,
    fetch: fetchEarthquakes,
  },
  {
    id: 'power_plants',
    // Row cadence: "The published database is a versioned release, not a feed.
    // This server re-reads it once a day, which is far more often than it
    // changes." A day is the honest number: the data moves on a release
    // schedule measured in months.
    intervalMs: 24 * 60 * 60_000,
    ttlMs: 24 * 60 * 60_000,
    // Generous against 12MB over a public CDN, and still four orders of
    // magnitude under the interval, so a slow read can never collide with the
    // next tick.
    timeoutMs: 120_000,
    fetch: fetchPowerPlants,
  },
];

/**
 * The pre-warm set: the layers fetched immediately at arming instead of waiting
 * out a first interval.
 *
 * This IS the demo set. `flights` is the 313-26 ride itself ("flights over
 * Paris in five seconds"), and a five-second answer is only possible if the
 * layer was already warm when the question arrived. `earthquakes` warms with
 * it so the ride can show a second layer answering from cache rather than one
 * layer that might be a fluke.
 */
export const PRE_WARM: readonly string[] = ['flights', 'earthquakes'];

const BY_ID: ReadonlyMap<string, EarthLayer> = new Map(EARTH_LAYERS.map(l => [l.id, l]));

export function earthLayer(id: string): EarthLayer | undefined {
  return BY_ID.get(id);
}

/**
 * Catalogue rows that are `live` and that this server does NOT fetch.
 *
 * Computed, never listed by hand: a hand-written list of what is missing is the
 * first thing to go stale, and then the door starts claiming a layer is
 * unserved after someone served it. The door reports these as live-but-not-
 * served-here, which is a different and more useful answer than `cold`.
 */
export function unservedLiveLayers(): string[] {
  return OSIRIS_LAYERS.filter(r => r.status === 'live' && !BY_ID.has(r.id)).map(r => r.id);
}

/**
 * The rules this registry obeys, in words.
 *
 * This function is a verifier, so registry.test.ts pins it against rows built
 * to break each rule (Law 31). A validator nobody proved rejects anything is a
 * validator that passes everything.
 */
export function registryProblems(layers: readonly EarthLayer[] = EARTH_LAYERS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const layer of layers) {
    if (seen.has(layer.id)) problems.push(`${layer.id} is registered twice`);
    seen.add(layer.id);

    const row = osirisLayer(layer.id);
    if (!row) {
      problems.push(`${layer.id} is not a catalogue layer id`);
    } else if (row.status !== 'live') {
      // The whole point of the status field: a dead or catalogued row gets no
      // fetcher, whatever its cadence prose happens to say.
      problems.push(`${layer.id} has catalogue status ${row.status}, so it must not have a fetcher`);
    }

    if (!(layer.intervalMs > 0)) problems.push(`${layer.id} intervalMs must be positive`);
    if (!(layer.ttlMs > 0)) problems.push(`${layer.id} ttlMs must be positive`);
    if (!(layer.timeoutMs > 0)) problems.push(`${layer.id} timeoutMs must be positive`);
    if (layer.timeoutMs >= layer.intervalMs) {
      problems.push(
        `${layer.id} timeoutMs ${layer.timeoutMs} is not less than intervalMs ${layer.intervalMs}: ` +
        'a fetch that outlives its cadence collides with the next tick forever',
      );
    }
    if (typeof layer.fetch !== 'function') problems.push(`${layer.id} has no fetch function`);
  }

  for (const id of PRE_WARM) {
    if (!seen.has(id) && layers === EARTH_LAYERS) {
      problems.push(`pre-warm names ${id}, which has no registry row`);
    }
  }

  return problems;
}
