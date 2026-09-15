/**
 * OSIRIS — the generic paint path.
 *
 * Adding a source to this globe used to be three generic steps plus one
 * hand-written one, and the hand-written one is the one that does not scale:
 * page.tsx wires fetch-on-toggle per layer in an if-chain, and OsirisMap.tsx
 * hand-writes map.addLayer({...}) per layer with its own paint. Every new layer
 * therefore costs an edit in two of the largest files in the repo.
 *
 * A catalogue row that carries a `paint` spec needs neither. The row says what
 * the layer looks like; one effect in OsirisMap draws every row that has one,
 * and one branch in page.tsx fetches every row that names a route.
 *
 *   catalogue row ── appRoute ──> page.tsx fetches into data[id]
 *                 └─ paint ─────> OsirisMap adds source + circle + label
 *
 * BUILT ALONGSIDE THE HAND-WIRED PATH, NOT INSTEAD OF IT. The existing layers
 * keep their bespoke paint until each is migrated deliberately; a big-bang
 * rewrite of a 2,805-line renderer is how globe work stops shipping.
 * layers-catalog.ts carries a named exemption for every live layer still
 * hand-wired, and a pin asserts the two sets cover everything — so "which
 * layers are still hand-wired" is a test output rather than something a person
 * has to go and count.
 *
 * Nothing here imports maplibre. It builds plain objects that happen to be
 * valid maplibre specs, so the whole thing is testable without a GPU.
 */

/** A colour, or a colour chosen by the value of a field. */
export type PaintColor =
  | string
  | {
      /** Feature property to switch on. */
      field: string;
      /** Lowercased value -> colour. */
      match: Record<string, string>;
      /** Used for any value not named above. Never omitted: a match expression
       *  without a fallback drops the features it does not recognise, which
       *  reads as missing data rather than as an unstyled category. */
      fallback: string;
    };

export interface PaintSpec {
  /**
   * Where the rows live in the page's data store. Usually the layer id, but
   * named explicitly because a route may answer under a different key.
   */
  dataKey: string;
  /**
   * The property of the route's JSON body holding the array of rows.
   *
   * Named rather than assumed, because a route is entitled to call its own
   * payload what it is — api/power-plants answers `{ plants }` — and forcing
   * every route to rename its field to match a layer id would be the generic
   * path dictating terms to things that existed first.
   */
  rowsKey: string;
  color: PaintColor;
  /** Circle size across zoom, as [zoom, px] stops. */
  radius: [number, number][];
  /** Optionally grow the circle by a numeric property, as [value, px] stops.
   *  Takes precedence over `radius` when the property is present. */
  sizeBy?: { field: string; stops: [number, number][] };
  opacity?: number;
  strokeColor?: string;
  label?: { field: string; minZoom: number };
}

/**
 * The catalogue rows the generic path actually handles.
 *
 * A row needs BOTH a route to fetch and a spec to draw. One without the other
 * is half a layer — fetched and invisible, or styled and empty — so the pair is
 * required together rather than each being optional on its own.
 */
export function isGenericLayer<T extends { appRoute?: string; paint?: PaintSpec }>(
  row: T,
): row is T & { appRoute: string; paint: PaintSpec } {
  return typeof row.appRoute === 'string' && row.paint !== undefined;
}

/** Every map id this layer owns, derived so nothing is typed twice. */
export function paintIds(layerId: string) {
  return {
    source: `gen-${layerId}`,
    circle: `gen-${layerId}-circle`,
    label: `gen-${layerId}-label`,
  };
}

/** All the layer ids a generic row draws, for visibility toggling. */
export function paintLayerIds(layerId: string, spec: PaintSpec): string[] {
  const ids = paintIds(layerId);
  return spec.label ? [ids.circle, ids.label] : [ids.circle];
}

interface HasPosition {
  lat?: unknown;
  lng?: unknown;
  [key: string]: unknown;
}

/**
 * Rows to point features, keeping every other field as a property.
 *
 * A row whose position is not a pair of real numbers is SKIPPED, never
 * defaulted: [0, 0] is a real place in the Gulf of Guinea, and a defaulted row
 * puts a power station or an aircraft in it.
 */
export function rowsToFeatures(rows: unknown): GeoJSON.Feature[] {
  if (!Array.isArray(rows)) return [];

  const features: GeoJSON.Feature[] = [];
  for (const row of rows as HasPosition[]) {
    if (!row || typeof row !== 'object') continue;
    const { lat, lng } = row;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: row as Record<string, unknown>,
    });
  }
  return features;
}

export function rowsToFeatureCollection(rows: unknown): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: rowsToFeatures(rows) };
}

/** A maplibre interpolate expression from [input, output] stops. */
function interpolate(input: unknown[], stops: [number, number][]): unknown[] {
  return ['interpolate', ['linear'], input, ...stops.flat()];
}

/** The colour expression for a spec. A plain string stays a plain string. */
export function colorExpression(color: PaintColor): unknown {
  if (typeof color === 'string') return color;
  const pairs = Object.entries(color.match).flatMap(([value, shade]) => [value, shade]);
  // `downcase` so a publisher writing "Coal" and a spec written in lowercase
  // agree without every spec having to guess the upstream's capitalisation.
  return ['match', ['downcase', ['to-string', ['get', color.field]]], ...pairs, color.fallback];
}

/** The circle layer's paint block. */
export function circlePaint(spec: PaintSpec): Record<string, unknown> {
  const radius = spec.sizeBy
    ? interpolate(['coalesce', ['to-number', ['get', spec.sizeBy.field], 0], 0], spec.sizeBy.stops)
    : interpolate(['zoom'], spec.radius);

  return {
    'circle-radius': radius,
    'circle-color': colorExpression(spec.color),
    'circle-opacity': spec.opacity ?? 0.85,
    'circle-stroke-width': spec.strokeColor ? 1 : 0,
    'circle-stroke-color': spec.strokeColor ?? '#000000',
    'circle-stroke-opacity': 0.7,
  };
}

export function labelLayout(spec: PaintSpec): Record<string, unknown> {
  return {
    'text-field': ['get', spec.label!.field],
    'text-size': 9,
    'text-font': ['Open Sans Regular'],
    'text-offset': [0, 1.4],
    'text-max-width': 12,
    'text-allow-overlap': false,
  };
}

export function labelPaint(spec: PaintSpec): Record<string, unknown> {
  return {
    'text-color': typeof spec.color === 'string' ? spec.color : spec.color.fallback,
    'text-halo-color': '#000000',
    'text-halo-width': 1.5,
    'text-opacity': 0.85,
  };
}
