/**
 * OSIRIS — sources that are NOT on the globe yet.
 *
 * Power infrastructure and the first World-Monitor sources, recorded so that
 * 313-21 can pick from them and 313-23 knows what to fetch. No data lands here
 * and nothing in the app reads this file at runtime today.
 *
 * WHY THIS IS A SECOND FILE. layers-catalog.ts can prove itself: its rows are
 * set-equal to the vocabulary the app boots from, so a wrong row fails a test
 * by name. Nothing here can do that. These rows are prose about the outside
 * world, and the only thing a test can check is that they are well formed and
 * point somewhere real. Welding the two together would have put both under one
 * green light, and the green would have been earned by the half that can prove
 * itself while laundering the half that cannot.
 *
 * The deviation is deliberate: row 313-22 asked for one catalogue file. Two
 * lifecycles, two files.
 *
 * WHAT A GREEN RUN HERE DOES NOT MEAN. It does not mean a licence is correct,
 * a cadence is current, or a source still exists. It means the row is filled
 * in, says one readable sentence, and carries a URL that parses. Reading the
 * Global Energy Monitor licence before any of its data lands is 313-24's job
 * and has not been done (Law 3).
 *
 * @see layers-catalog.ts for the half that is pinned against the real door.
 */

import { catalogRowProblems, type CatalogRow } from './layers-catalog';

export interface SourceRow extends CatalogRow {
  kind: 'power' | 'world_monitor';
  /** Always null here. Nothing in this file is wired to the control door. */
  doorKey: null;
}

/**
 * The two power layers. Catalogued with their source and licence words and no
 * data, exactly as row 313-22 asked.
 */
const POWER: SourceRow[] = [
  /*
   * power_plants HAS GRADUATED to layers-catalog.ts.
   *
   * A row lives here while a source is named and nothing fetches it. Something
   * fetches this one now, so it belongs in the catalogue that can prove itself
   * against the door's real vocabulary — that is the whole distinction between
   * these two files, and leaving a copy here would give one id two licence
   * statements that are free to drift apart.
   *
   * Its licence is STILL UNREAD, and the graduated row says so verbatim. The
   * move records that something fetches it, not that anyone read the terms.
   */
  {
    id: 'power_lines', kind: 'power', doorKey: null, status: 'catalogued',
    words: 'High-voltage transmission lines and substations that move power between places.',
    source: 'OpenInfraMap, which renders infrastructure tagged in OpenStreetMap rather than holding a dataset of its own.',
    cadence: 'OpenStreetMap is edited continuously, so the underlying data has no release interval.',
    licence: 'NOT READ on this leg. The data is OpenStreetMap, and OSM states its own terms on its copyright page; those terms carry attribution and share-alike obligations that must be read before any of it is redrawn here.',
    sourceUrl: 'https://openinframap.org/',
  },
];

/**
 * The first five World-Monitor sources.
 *
 * Three of these overlap something this globe already draws, and the rows say
 * so rather than pretending to be new. That overlap is the useful part: it is
 * what stops 313-21 and 313-23 building a second opinion on a feed this app
 * already holds one on.
 */
const WORLD_MONITOR: SourceRow[] = [
  {
    id: 'military_bases', kind: 'world_monitor', doorKey: null, status: 'unsourced',
    words: 'Permanent military installations and the forces based at them.',
    source: 'No upstream has been chosen. This is the only one of the five with nothing behind it and nothing comparable already in the app: a search of src/ for bases, airbases or military_bases returns nothing. Until a dataset is named this row carries no information beyond its own name.',
    cadence: 'Not applicable until a source exists.',
    licence: 'Nothing to read yet, because no source has been named.',
    sourceUrl: null,
  },
  {
    id: 'nuclear_sites', kind: 'world_monitor', doorKey: null, status: 'unsourced',
    words: 'Nuclear power stations, research reactors and fuel-cycle facilities.',
    source: 'No upstream dataset has been chosen. This globe ALREADY draws nuclear sites on the infrastructure layer, but from a hand-written constant in this repo (api/infrastructure/route.ts:35 onward) with per-row Wikipedia links and no dataset behind it. A real source would replace that constant rather than add a second opinion beside it.',
    cadence: 'Not applicable until a source exists.',
    licence: 'Nothing to read yet, because no source has been named.',
    sourceUrl: null,
  },
  {
    id: 'ports', kind: 'world_monitor', doorKey: null, status: 'unsourced',
    words: 'Seaports and the container or energy volume that moves through them.',
    source: 'No upstream dataset has been chosen. This globe ALREADY draws ports on the maritime layer, but from a hand-written constant in this repo (api/maritime/route.ts:9) carrying no source and no licence on any row. A real source would replace that constant.',
    cadence: 'Not applicable until a source exists.',
    licence: 'Nothing to read yet, because no source has been named.',
    sourceUrl: null,
  },
  {
    id: 'gdacs_disasters', kind: 'world_monitor', doorKey: null, status: 'catalogued',
    words: 'Global disaster alerts covering cyclones, floods, droughts and earthquakes.',
    source: 'The GDACS RSS feed. NOTE BEFORE WIRING ANYTHING: this app already fetches this exact URL TWICE, at api/gdelt/route.ts:29 for the global_incidents layer and again at api/weather/route.ts:159 for the weather layer, which deliberately drops the earthquake and wildfire types because other layers carry them. A third consumer would be a third opinion on one feed.',
    cadence: 'GDACS publishes to the RSS feed as alerts are raised. Both existing consumers read it once per layer activation rather than polling.',
    licence: 'NOT READ on this leg. GDACS is run under the EU and UN umbrella and states its own terms; neither existing consumer in this repo records them.',
    sourceUrl: 'https://www.gdacs.org/xml/rss.xml',
  },
  {
    id: 'military_aircraft', kind: 'world_monitor', doorKey: null, status: 'catalogued',
    words: 'Military aircraft currently airborne, reported by crowd-sourced ADS-B receivers.',
    source: 'adsb.lol trace files, already used by this repo at api/aircraft/route.ts:22 for single-aircraft traces. NOTE: the globe ALREADY draws airborne military aircraft on the military layer, from adsb.fi and OpenSky. This row is a different publisher for the same real-world thing, not a new capability.',
    cadence: 'adsb.lol publishes readsb trace files continuously. The existing military layer refreshes every 5 minutes.',
    licence: 'NOT READ on this leg. adsb.lol states its own terms and nothing in this repo records them, including the route that already uses it.',
    sourceUrl: 'https://adsb.lol/',
  },
];

/** Power first, then World-Monitor, in the order row 313-22 named them. */
export const SOURCE_ROWS: readonly SourceRow[] = [...POWER, ...WORLD_MONITOR];

/**
 * Built once at module scope, so it is a snapshot, which is why SOURCE_ROWS is
 * readonly: a pushed row would be in the array and invisible to sourceRow().
 */
const SOURCE_BY_ID: ReadonlyMap<string, SourceRow> = new Map(
  SOURCE_ROWS.map(row => [row.id, row]),
);

export function sourceRow(id: string): SourceRow | undefined {
  return SOURCE_BY_ID.get(id);
}

/** The same rules the osiris half obeys. Re-exported so consumers need one import. */
export { catalogRowProblems };
