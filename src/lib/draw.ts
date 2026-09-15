import type { LngLat } from './geo';
import { circleToRing, haversine, pathLength, polygonArea, rectToRing, ringPerimeter } from './geo';

/**
 * OSIRIS — AOI shape model
 *
 * Four ways to describe an area, one canonical geometry.
 *
 * Whatever the operator draws, the result carries a closed GeoJSON ring (or a
 * LineString for a path). Everything downstream — the contents sweep, the map
 * render, the export — reads only that, so adding a shape here never ripples
 * into the query or the renderer. The originating parameters are kept in
 * `meta` so a circle can still say "12 km radius" rather than "64 vertices".
 */

export type DrawMode = 'polygon' | 'rectangle' | 'circle' | 'line';

export interface DrawnShape {
  id: string;
  name: string;
  kind: DrawMode;
  /** Canonical geometry. Polygon for areas, LineString for a path. */
  geojson: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>;
  /** 0 for a line — a path encloses nothing. */
  areaKm2: number;
  /** Ring perimeter for areas, total length for a path. */
  perimeterKm: number;
  color: string;
  createdAt: number;
  /** What produced the geometry, for shapes with parameters worth keeping. */
  meta?: { center?: LngLat; radiusKm?: number };
}

/** Live figures shown while a shape is still being drawn. */
export interface DrawProgress {
  mode: DrawMode;
  vertices: number;
  areaKm2: number;
  lengthKm: number;
  radiusKm?: number;
  /** True once the shape has enough points to be finished. */
  closable: boolean;
}

/** Raw output of the map's draw interaction, before naming and colouring. */
export interface DrawResult {
  kind: DrawMode;
  /** Closed ring for areas; the ordered points for a line. */
  coords: number[][];
  meta?: { center?: LngLat; radiusKm?: number };
}

const PALETTE = [
  '#00E5FF', '#FF3D57', '#FFD700', '#00E676', '#E040FB',
  '#FF9800', '#29B6F6', '#AB47BC', '#26A69A', '#EC407A',
];

export function nextColor(existing: { color: string }[]): string {
  return PALETTE[existing.length % PALETTE.length];
}

/** Minimum points before a shape can be completed. */
export function minPoints(mode: DrawMode): number {
  switch (mode) {
    case 'polygon': return 3;
    case 'line': return 2;
    case 'rectangle': return 2; // two opposite corners
    case 'circle': return 2;    // centre + a point on the rim
  }
}

/**
 * Turn in-progress input into the geometry for that mode.
 *
 * Rectangle and circle are defined by exactly two clicks, so their preview and
 * their final geometry come from the same call — the cursor simply stands in
 * for the second point until it is committed.
 */
export function buildGeometry(mode: DrawMode, points: number[][]): number[][] {
  if (mode === 'rectangle' && points.length >= 2) {
    return rectToRing(points[0] as LngLat, points[points.length - 1] as LngLat);
  }
  if (mode === 'circle' && points.length >= 2) {
    const centre = points[0] as LngLat;
    const rim = points[points.length - 1] as LngLat;
    return circleToRing(centre, haversine(centre, rim));
  }
  return points;
}

/** Live measurement for the in-progress shape. */
export function measure(mode: DrawMode, points: number[][]): DrawProgress {
  const enough = points.length >= minPoints(mode);

  if (mode === 'circle') {
    const radiusKm = points.length >= 2
      ? haversine(points[0] as LngLat, points[points.length - 1] as LngLat)
      : 0;
    const ring = enough ? buildGeometry('circle', points) : [];
    return {
      mode, vertices: points.length, radiusKm, closable: enough,
      areaKm2: ring.length ? polygonArea(ring) : 0,
      lengthKm: ring.length ? ringPerimeter(ring) : 0,
    };
  }

  if (mode === 'rectangle') {
    const ring = enough ? buildGeometry('rectangle', points) : [];
    return {
      mode, vertices: points.length, closable: enough,
      areaKm2: ring.length ? polygonArea(ring) : 0,
      lengthKm: ring.length ? ringPerimeter(ring) : 0,
    };
  }

  if (mode === 'line') {
    return {
      mode, vertices: points.length, closable: enough,
      areaKm2: 0,
      lengthKm: pathLength(points),
    };
  }

  // polygon — area only becomes meaningful at three points
  return {
    mode, vertices: points.length, closable: enough,
    areaKm2: enough ? polygonArea(points) : 0,
    lengthKm: enough ? ringPerimeter(points) : pathLength(points),
  };
}

/**
 * Turn a mode and the points that define it into a finished DrawResult, or
 * undefined when there are not enough points for that mode.
 *
 * THE ONE PLACE THAT STEP HAPPENS. It was inlined in the reducer's `complete`
 * until the control door grew a draw verb, and a second caller building its own
 * result would have got two of these subtly wrong: a circle is defined by
 * centre + rim but STORED as a 64-vertex ring with its radius in meta, and a
 * rectangle by two corners but stored as a closed five-vertex ring. A caller
 * that skipped buildGeometry would put a two-point "polygon" on the map.
 *
 * So a brain-sent shape and a mouse-drawn one take the same path and cannot
 * disagree — which is the only reason the renderer, the contents sweep, the
 * export and the tripwires need no idea which one drew it.
 */
export function toDrawResult(mode: DrawMode, points: number[][]): DrawResult | undefined {
  if (points.length < minPoints(mode)) return undefined;
  const coords = buildGeometry(mode, points);
  const meta =
    mode === 'circle'
      ? {
          center: points[0] as LngLat,
          radiusKm: haversine(points[0] as LngLat, points[points.length - 1] as LngLat),
        }
      : undefined;
  return { kind: mode, coords, meta };
}

/** Promote a finished draw into a stored shape. */
export function toShape(result: DrawResult, existing: { color: string }[], index: number): DrawnShape {
  const isLine = result.kind === 'line';
  const coords = result.coords;

  const geometry: GeoJSON.Polygon | GeoJSON.LineString = isLine
    ? { type: 'LineString', coordinates: coords }
    : { type: 'Polygon', coordinates: [closeRing(coords)] };

  const labels: Record<DrawMode, string> = {
    polygon: 'Area', rectangle: 'Box', circle: 'Radius', line: 'Path',
  };

  return {
    id: `aoi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${labels[result.kind]} ${index + 1}`,
    kind: result.kind,
    geojson: { type: 'Feature', properties: {}, geometry },
    areaKm2: isLine ? 0 : polygonArea(coords),
    perimeterKm: isLine ? pathLength(coords) : ringPerimeter(coords),
    color: nextColor(existing),
    createdAt: Date.now(),
    meta: result.meta,
  };
}

/** GeoJSON requires a polygon ring to repeat its first position last. */
export function closeRing(coords: number[][]): number[][] {
  if (coords.length === 0) return coords;
  const [f, l] = [coords[0], coords[coords.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? coords : [...coords, f];
}

/** The ring used for spatial queries. A line has no interior, so none. */
export function queryRing(shape: DrawnShape): number[][] | null {
  return shape.geojson.geometry.type === 'Polygon'
    ? (shape.geojson.geometry.coordinates[0] as number[][])
    : null;
}

/* ────────────────────────────────────────────────────────────────────────────
   Draw state machine

   The interaction is a pure reducer so its correctness does not depend on a
   browser. The map effect becomes a thin adapter that translates map events
   into actions and renders the returned state — which means click ordering,
   undo, the two-click shapes and the double-click duplicate can all be proven
   in tests rather than by clicking around and hoping.
   ──────────────────────────────────────────────────────────────────────────── */

export interface DrawState {
  mode: DrawMode;
  points: number[][];
}

export type DrawAction =
  | { type: 'click'; at: [number, number] }
  | { type: 'dblclick' }
  | { type: 'undo' }
  | { type: 'finish' }
  | { type: 'cancel' };

export interface DrawTransition {
  state: DrawState;
  /** Present when the action completed a shape. */
  result?: DrawResult;
  /** True when the operator abandoned the shape. */
  cancelled?: boolean;
}

export function initialDrawState(mode: DrawMode): DrawState {
  return { mode, points: [] };
}

/** Build the finished result for the points collected so far, if it is valid. */
function complete(state: DrawState): DrawResult | undefined {
  return toDrawResult(state.mode, state.points);
}

export function drawReducer(state: DrawState, action: DrawAction): DrawTransition {
  switch (action.type) {
    case 'click': {
      const points = [...state.points, action.at];
      const next = { ...state, points };
      // Rectangle and circle are fully defined by two clicks, so the second
      // one commits rather than waiting for an explicit finish.
      if ((state.mode === 'rectangle' || state.mode === 'circle') && points.length >= 2) {
        return { state: initialDrawState(state.mode), result: complete(next) };
      }
      return { state: next };
    }

    case 'dblclick': {
      // The first half of a double click already arrived as a click, so the
      // last point is a duplicate — but only drop it if doing so still leaves
      // a valid shape, otherwise a fast triple-click would eat a real vertex.
      const trimmed =
        state.points.length > minPoints(state.mode) ? state.points.slice(0, -1) : state.points;
      const candidate = { ...state, points: trimmed };
      const result = complete(candidate);
      return result ? { state: initialDrawState(state.mode), result } : { state: candidate };
    }

    case 'finish': {
      const result = complete(state);
      return result ? { state: initialDrawState(state.mode), result } : { state };
    }

    case 'undo':
      return { state: { ...state, points: state.points.slice(0, -1) } };

    case 'cancel':
      return { state: initialDrawState(state.mode), cancelled: true };
  }
}
