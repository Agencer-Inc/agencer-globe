/**
 * OSIRIS — the layer catalogue.
 *
 * Two things live here, and the second is checked against the first.
 *
 *   DEFAULT_ACTIVE_LAYERS   the layer vocabulary, and the app's real defaults
 *   OSIRIS_LAYERS           one row per layer, saying what it is and where it
 *                           comes from
 *
 * The vocabulary is not a copy. page.tsx seeds its `activeLayers` state from
 * this const, and the remote-control door validates `set_layers` against
 * `Object.keys(activeLayers)` (page.tsx:414 -> control-door.ts:268). So the
 * list below IS the door's vocabulary at runtime, not a mirror of it, and the
 * both-ways pin in layers-catalog.test.ts compares the rows against the same
 * object the app boots from. Add a layer and forget its row, and the pin names
 * the id it is missing.
 *
 * That property is the whole design. An earlier plan for this file generated
 * the rows by parsing page.tsx by line range; a parser is a second thing that
 * can lie and would need a pin of its own (Law 31). A real import needs none.
 *
 *      page.tsx  useState({ ...DEFAULT_ACTIVE_LAYERS })
 *          |                      |
 *          |  Object.keys         |  LAYER_IDS
 *          v                      v
 *      knownLayerIds          set-equality pin  <---- OSIRIS_LAYERS[].id
 *          |
 *          v
 *      control-door planVerb: refuses any layer not in the list
 *
 * External sources that are NOT on the globe yet (power, World-Monitor) live in
 * source-catalog.ts, which has no vocabulary to check itself against and must
 * not borrow this file's green light.
 *
 * @see source-catalog.ts for the rows this file deliberately does not hold.
 */

/**
 * Every layer the app has, with the default it boots with.
 *
 * Written for page.tsx, which is the only consumer that needs the boolean
 * values; everything else here wants the keys (Law 6: name the consumer a
 * default was written for, at the definition site). Most layers default OFF so
 * the initial load stays fast.
 *
 * Deliberately NOT `as const`: page.tsx flips these at runtime, and literal
 * `false` types would reject `true`. The inferred type is the same one the
 * inline object produced before it was extracted, so page.tsx typechecks
 * identically.
 */
export const DEFAULT_ACTIVE_LAYERS = {
  flights: false,
  private: false,
  jets: false,
  military: false,
  maritime: true,
  satellites: false,
  sat_comms: false,
  sat_military: false,
  sat_navigation: false,
  sat_earth: false,
  sat_science: false,
  balloons: false,
  cctv: true,
  /* The live preview tiles over the camera dots — see CctvPreviews. */
  cctv_previews: true,
  live_news: true,
  earthquakes: true,
  fires: false,
  weather: false,
  radiation: false,
  infrastructure: false,
  global_incidents: true,
  war_alerts: false,
  day_night: true,
  cables: true,
  sdk_sea: true,
  sdk_air: true,
  sdk_naval: true,
  terrain_3d: false,
  terrain_elevation: false,
  malware: false,
  cyber_attacks: false,
  gdelt_events: false,
  cf_outages: false,
  cf_attacks: false,
};

/** Every layer id the door accepts. Drift here fails the build, not a review. */
export type LayerId = keyof typeof DEFAULT_ACTIVE_LAYERS;

export const LAYER_IDS = Object.keys(DEFAULT_ACTIVE_LAYERS) as LayerId[];

/**
 * What a row is actually backed by. There is no `unknown`: a row that cannot
 * say which of these it is has not been researched, and a text field reading
 * "unknown" would pass a not-empty check while proving nothing (Law 31).
 *
 *   live         a real feed answers, today, on the stated cadence
 *   dead         wired up in the app but nothing answers, or nothing reads it
 *   render_only  a drawing toggle with no data behind it by design
 *   unsourced    real data ships, but hardcoded in this repo with no upstream
 */
export type SourceStatus = 'live' | 'dead' | 'render_only' | 'unsourced';

export interface CatalogRow {
  /** Stable snake_case. For osiris rows this is the door key, verbatim. */
  id: string;
  kind: 'osiris' | 'power' | 'world_monitor';
  /**
   * ONE plain sentence saying what this layer is, for a human reading a page.
   * Never synonyms, never a phrase list, and never read by code to route on:
   * matching a user's wording against this field would be exactly the
   * regex-on-meaning this catalogue exists to avoid.
   */
  words: string;
  /** Who publishes it, in their own name. When status is not `live`, this says why. */
  source: string;
  /** How often it refreshes, as the app actually polls it or the source states. */
  cadence: string;
  /** The licence in the source's own words. Never a guess. */
  licence: string;
  status: SourceStatus;
  /** Required and must parse as a URL when status is `live`. */
  sourceUrl: string | null;
  /** The control-door key, where one exists. */
  doorKey: string | null;
}

export interface OsirisRow extends CatalogRow {
  kind: 'osiris';
  id: LayerId;
  doorKey: LayerId;
}

/**
 * One row per layer id. Empty until commit 2 fills it; the pin is red until
 * then, and it is red by naming all 34 missing ids rather than by failing to
 * resolve an import.
 */
export const OSIRIS_LAYERS: OsirisRow[] = [];

/** Built once at module scope: 313-21 and 313-23 look rows up per layer. */
const OSIRIS_BY_ID: ReadonlyMap<string, OsirisRow> = new Map(
  OSIRIS_LAYERS.map(row => [row.id, row]),
);

export function osirisLayer(id: string): OsirisRow | undefined {
  return OSIRIS_BY_ID.get(id);
}
