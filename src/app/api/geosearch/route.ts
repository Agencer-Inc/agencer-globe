import { NextResponse } from 'next/server';
import { httpJson, optional } from '@/lib/httpJson';
import { cachedSource } from '@/lib/sourceCache';

export const maxDuration = 20;

/**
 * OSIRIS — Location search for the route planner.
 *
 * Nominatim alone was the problem: it is a *geocoder*, not a type-ahead index,
 * so it needs near-complete input. Measured side by side, "eiffel tow" returns
 * nothing from Nominatim and the correct Paris landmark from Photon; "sydny
 * opera house" (typo) returns one weak hit vs six good ones.
 *
 * Photon is Komoot's autocomplete index over the same OSM data — prefix and
 * fuzzy tolerant — so it leads. Nominatim still runs as a supplement because it
 * resolves some structured/administrative phrasings Photon ranks poorly, and
 * merging the two is what closes the "location is 100% missing" gap.
 *
 * Both are keyless OSM community services and both ask for an identifying
 * User-Agent, which lib/httpJson supplies.
 */

const PHOTON = 'https://photon.komoot.io/api';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export interface GeoResult {
  name: string;
  context: string;
  lat: number;
  lng: number;
  kind: string;
  source: 'photon' | 'nominatim';
  /** Nominatim importance, when the hit came from there. Ranking only. */
  score?: number;
  /**
   * [west, south, east, north], when the provider reported one.
   *
   * Both upstreams send a real box for administrative features and both were
   * read for their centre point alone. The earth server's place table stores a
   * BOX rather than a dot — "flights over Paris" needs an area — so this is the
   * whole reason a country or a region can be resolved there at all.
   *
   * Absent when the provider sent none. It is never derived here: a box this
   * route invented would be indistinguishable from one the publisher stated,
   * and the consumer needs to know which it got.
   */
  bbox?: [number, number, number, number];
  /** Only ever 'upstream' here. Present so a consumer can tell it apart from a
   *  box derived downstream, without inspecting the numbers. */
  bboxSource?: 'upstream';
}

/**
 * The Photon fields this route reads, named rather than left to a string index
 * signature — `extent` is an array, and an index signature of strings cannot
 * hold one without widening every other field to match.
 */
interface PhotonProps {
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
  osm_key?: string;
  osm_value?: string;
  /** [west, north, east, south] — Photon's own order, not GeoJSON's. */
  extent?: number[];
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: PhotonProps;
}

interface NominatimRow {
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  name?: string;
  importance?: number;
  /** [south, north, west, east], as strings. Nominatim's own order. */
  boundingbox?: string[];
}

/** Four finite numbers, in range, south below north. Anything else is dropped
 *  rather than half-read: a partly-parsed box is a wrong answer that looks
 *  right, and the earth server would filter a whole layer through it. */
function validBbox(box: number[]): [number, number, number, number] | undefined {
  if (box.length !== 4 || !box.every(n => Number.isFinite(n))) return undefined;
  const [west, south, east, north] = box;
  if (west < -180 || west > 180 || east < -180 || east > 180) return undefined;
  if (south < -90 || south > 90 || north < -90 || north > 90) return undefined;
  if (south > north) return undefined;
  return [west, south, east, north];
}

/**
 * Nominatim's importance above which a hit is treated as globally prominent.
 * Photon is the better prefix matcher but ranks purely lexically — searching
 * "heathrow" puts Heathrow, Florida above London Heathrow Airport. Nominatim
 * scores the airport 0.606 and the town 0.352, so this promotes the former
 * without disturbing queries Nominatim can't answer at all.
 */
const PROMINENT = 0.5;

/** Collapse OSM class/value pairs into the handful of kinds the UI icons. */
export function classifyKind(key?: string, value?: string): string {
  if (!key) return 'place';
  if (key === 'place' && ['country'].includes(value || '')) return 'country';
  if (key === 'place' && ['state', 'region', 'province', 'county'].includes(value || '')) return 'region';
  if (key === 'place' && ['city', 'town', 'village', 'hamlet', 'municipality'].includes(value || '')) return 'city';
  if (key === 'boundary') return 'region';
  if (key === 'highway' || key === 'street') return 'street';
  if (key === 'building' || key === 'address' || value === 'house') return 'address';
  if (['amenity', 'tourism', 'shop', 'leisure', 'historic', 'office', 'railway', 'aeroway', 'natural', 'man_made'].includes(key)) {
    return 'poi';
  }
  return 'place';
}

export function normalizePhoton(f: PhotonFeature): GeoResult | null {
  const c = f?.geometry?.coordinates;
  const p = f?.properties;
  if (!c || c.length < 2 || !p) return null;
  const [lng, lat] = c;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Photon splits an address across name/housenumber/street
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || street || p.city || p.country || 'Unnamed place';
  const context = [p.name && street ? street : null, p.district, p.city, p.state, p.country]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3)
    .join(', ');

  // Photon states its extent as [west, north, east, south] — north and south
  // the opposite way round from a GeoJSON bbox. Reordered here, at the one
  // place that reads it, and pinned in the test against a country whose box
  // can be checked on a map.
  const extent = Array.isArray(p.extent)
    ? validBbox([p.extent[0], p.extent[3], p.extent[2], p.extent[1]])
    : undefined;

  return {
    name, context, lat, lng,
    kind: classifyKind(p.osm_key, p.osm_value),
    source: 'photon',
    ...(extent ? { bbox: extent, bboxSource: 'upstream' as const } : {}),
  };
}

export function normalizeNominatim(r: NominatimRow): GeoResult | null {
  const lat = parseFloat(r?.lat || '');
  const lng = parseFloat(r?.lon || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const parts = (r.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);

  // Nominatim states its box as [south, north, west, east], as STRINGS.
  // Reordered and parsed here, and pinned in the test the same way Photon's is.
  const box = Array.isArray(r.boundingbox)
    ? validBbox([r.boundingbox[2], r.boundingbox[0], r.boundingbox[3], r.boundingbox[1]].map(Number))
    : undefined;

  return {
    name: r.name || parts[0] || 'Unnamed place',
    context: parts.slice(1, 4).join(', '),
    lat,
    lng,
    kind: classifyKind(r.class, r.type),
    source: 'nominatim',
    score: typeof r.importance === 'number' ? r.importance : undefined,
    ...(box ? { bbox: box, bboxSource: 'upstream' as const } : {}),
  };
}

/** Roughly 100 m — close enough that two hits are the same place. */
const DEDUPE_DEG = 0.001;

/**
 * Merge provider results, Photon first, dropping anything the other provider
 * already covers at effectively the same coordinate with the same name.
 */
export function mergeResults(primary: GeoResult[], secondary: GeoResult[], limit = 8): GeoResult[] {
  const out: GeoResult[] = [];

  const isDuplicate = (r: GeoResult) =>
    out.some(
      (o) =>
        Math.abs(o.lat - r.lat) < DEDUPE_DEG &&
        Math.abs(o.lng - r.lng) < DEDUPE_DEG &&
        o.name.toLowerCase() === r.name.toLowerCase(),
    );

  // A landmark the world knows leads, whichever index found it; everything else
  // keeps Photon's ordering, which is what makes partial input work.
  const prominent = secondary
    .filter((r) => (r.score ?? 0) >= PROMINENT)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const rest = secondary.filter((r) => (r.score ?? 0) < PROMINENT);

  for (const r of [...prominent, ...primary, ...rest]) {
    if (out.length >= limit) break;
    if (!isDuplicate(r)) out.push(r);
  }
  return out;
}

async function searchPhoton(q: string, lat?: number, lng?: number): Promise<GeoResult[]> {
  let url = `${PHOTON}/?q=${encodeURIComponent(q)}&limit=8&lang=en`;
  // Bias toward what the operator is currently looking at
  if (Number.isFinite(lat) && Number.isFinite(lng)) url += `&lat=${lat}&lon=${lng}`;
  const json = await httpJson<{ features?: PhotonFeature[] }>(url, { timeoutMs: 8000 });
  return (json.features || []).map(normalizePhoton).filter((r): r is GeoResult => r !== null);
}

async function searchNominatim(q: string): Promise<GeoResult[]> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=0`;
  const json = await httpJson<NominatimRow[]>(url, { timeoutMs: 8000 });
  return (Array.isArray(json) ? json : []).map(normalizeNominatim).filter((r): r is GeoResult => r !== null);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const lat = parseFloat(searchParams.get('lat') || '');
    const lng = parseFloat(searchParams.get('lng') || '');

    if (q.length < 2) return NextResponse.json({ results: [] });

    // Bias is rounded so panning slightly still reuses the cached search.
    const biasKey = Number.isFinite(lat) && Number.isFinite(lng)
      ? `${lat.toFixed(1)},${lng.toFixed(1)}`
      : 'global';
    const key = `geosearch:${q.toLowerCase()}|${biasKey}`;

    const results = await cachedSource<GeoResult>(
      key,
      async () => {
        const [photon, nominatim] = await Promise.all([
          optional(searchPhoton(q, lat, lng)),
          optional(searchNominatim(q)),
        ]);
        return mergeResults(photon || [], nominatim || []);
      },
      10 * 60 * 1000,
    )();

    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' } },
    );
  } catch (error) {
    console.error('[OSIRIS] Geosearch error:', error);
    return NextResponse.json({ results: [], error: 'Search failed' }, { status: 500 });
  }
}
