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
 *   catalogued   a real upstream exists and is named, and nothing here fetches
 *                it yet; the state every row in source-catalog.ts starts in
 */
export type SourceStatus = 'live' | 'dead' | 'render_only' | 'unsourced' | 'catalogued';

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
 * The rules every row obeys, whichever catalogue it lives in.
 *
 * Returns the problems in words rather than throwing or returning a boolean.
 * A boolean would make a caller collapse "this row is wrong" into "something is
 * wrong somewhere", and the whole reason this catalogue exists is that a
 * not-empty check which cannot say WHAT is empty teaches nobody anything.
 *
 * This function is itself a verifier, so layers-catalog.test.ts pins it against
 * rows built to break each rule. A validator nobody proved rejects anything is
 * a validator that passes everything (Law 31).
 */
export function catalogRowProblems(row: CatalogRow): string[] {
  const problems: string[] = [];
  const text = ['words', 'source', 'cadence', 'licence'] as const;

  for (const field of text) {
    if (typeof row[field] !== 'string' || row[field].trim() === '') {
      problems.push(`${field} is empty`);
      continue;
    }
    // "unknown" is non-empty, so a not-empty check passes on a row nobody
    // researched. Banning the word is what makes the not-empty check mean
    // something: say what is actually true, or set status and explain.
    if (row[field].trim().toLowerCase() === 'unknown') {
      problems.push(`${field} is the word "unknown" — say what is true, or use status`);
    }
  }

  if (typeof row.id !== 'string' || row.id.trim() === '') problems.push('id is empty');

  // words is ONE sentence a person can read. If it ever became a list,
  // something would start matching a user's phrasing against it, and that is
  // the regex-on-meaning this catalogue exists to avoid.
  if (typeof row.words === 'string') {
    if (!/^[^\n]+\.$/.test(row.words)) problems.push('words must be one line ending in a full stop');
    if (/;|\band\/or\b/.test(row.words)) problems.push('words reads as a list, not a sentence');
  }

  // A url is required whenever the row claims a real upstream. `live` is the
  // case the rule was written for; `catalogued` is held to it too, because a
  // catalogued row exists precisely so someone can go and read that source's
  // licence, and a row pointing nowhere cannot be read.
  if (row.status === 'live' || row.status === 'catalogued') {
    if (row.sourceUrl === null) {
      problems.push(`status is ${row.status}, so sourceUrl is required`);
    } else {
      try {
        new URL(row.sourceUrl);
      } catch {
        problems.push(`sourceUrl is not a URL: ${row.sourceUrl}`);
      }
    }
  } else if (row.sourceUrl === null && row.source.trim().length <= 20) {
    // A null url is allowed away from `live`, but only when the row says why.
    problems.push(`status is ${row.status} with no url, so source must say why`);
  }

  return problems;
}

/**
 * The honest answer for most of this globe, and the reason it is a named
 * constant rather than a repeated string literal: grep it and the count tells
 * you how many layers ship with no licence recorded anywhere in this repo.
 * At the time of writing that is most of them, and none of the code that
 * fetches them says otherwise.
 */
const LICENCE_NOT_READ =
  'Not recorded in this repo. The publisher states its own terms; read them before redistributing.';

/** Four layers are slices of one ADS-B request, so they share a provenance. */
const ADSB = 'adsb.fi open data, falling back to the OpenSky Network (api/flights/route.ts:123, :345).';
const ADSB_URL = 'https://opendata.adsb.fi/api/v2';

/** Six layers are mission-classified slices of one orbital-element fetch. */
const TLE = 'CelesTrak general perturbations element sets, with SatNOGS DB as a fallback (api/satellites/route.ts:78, :115).';
const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const TLE_CADENCE = 'Fetched once per session and never re-polled; positions are propagated from the element-set epoch.';

/**
 * One row per layer id, in the same order as the vocabulary above.
 *
 * Three of these rows say something the app has never admitted anywhere else:
 * `balloons` and `radiation` are polled every five minutes against routes that
 * do not exist, and `war_alerts` is read by nothing at all. The door accepts
 * all three. Recording that was the point of the status field.
 */
export const OSIRIS_LAYERS: OsirisRow[] = [
  {
    id: 'flights', kind: 'osiris', doorKey: 'flights', status: 'live',
    words: 'Commercial airliners currently in the air, from crowd-sourced ADS-B receivers.',
    source: ADSB,
    cadence: 'Once when the layer opens, then every 5 minutes (page.tsx:832).',
    licence: LICENCE_NOT_READ, sourceUrl: ADSB_URL,
  },
  {
    id: 'private', kind: 'osiris', doorKey: 'private', status: 'live',
    words: 'Privately registered aircraft, split out of the same ADS-B feed as commercial traffic.',
    source: ADSB,
    cadence: 'Once when the layer opens, then every 5 minutes (page.tsx:832).',
    licence: LICENCE_NOT_READ, sourceUrl: ADSB_URL,
  },
  {
    id: 'jets', kind: 'osiris', doorKey: 'jets', status: 'live',
    words: 'Business jets, split out of the same ADS-B feed by aircraft type.',
    source: ADSB,
    cadence: 'Once when the layer opens, then every 5 minutes (page.tsx:832).',
    licence: LICENCE_NOT_READ, sourceUrl: ADSB_URL,
  },
  {
    id: 'military', kind: 'osiris', doorKey: 'military', status: 'live',
    words: 'Aircraft carrying military identifiers, split out of the same ADS-B feed.',
    source: ADSB,
    cadence: 'Once when the layer opens, then every 5 minutes (page.tsx:832).',
    licence: LICENCE_NOT_READ, sourceUrl: ADSB_URL,
  },
  {
    id: 'maritime', kind: 'osiris', doorKey: 'maritime', status: 'live',
    words: 'Vessels under way, drawn together with the world major ports and chokepoints.',
    source: 'aisstream.io for the vessels. The ports and chokepoints are NOT a feed: they are a hand-written constant in this repo (api/maritime/route.ts:9) with no upstream and no licence on any row.',
    cadence: 'Once when the layer opens, then every 10 seconds (page.tsx:842).',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://aisstream.io/',
  },
  {
    id: 'satellites', kind: 'osiris', doorKey: 'satellites', status: 'live',
    words: 'Every tracked satellite in orbit, positioned from published orbital elements.',
    source: TLE, cadence: TLE_CADENCE, licence: LICENCE_NOT_READ, sourceUrl: TLE_URL,
  },
  {
    id: 'sat_comms', kind: 'osiris', doorKey: 'sat_comms', status: 'live',
    words: 'Communications satellites including Starlink, classified by name from the same element set.',
    source: TLE, cadence: TLE_CADENCE, licence: LICENCE_NOT_READ, sourceUrl: TLE_URL,
  },
  {
    id: 'sat_military', kind: 'osiris', doorKey: 'sat_military', status: 'live',
    words: 'Military and intelligence satellites, classified by name from the same element set.',
    source: TLE, cadence: TLE_CADENCE, licence: LICENCE_NOT_READ, sourceUrl: TLE_URL,
  },
  {
    id: 'sat_navigation', kind: 'osiris', doorKey: 'sat_navigation', status: 'live',
    words: 'Navigation constellations such as GPS and Galileo, from the same element set.',
    source: TLE, cadence: TLE_CADENCE, licence: LICENCE_NOT_READ, sourceUrl: TLE_URL,
  },
  {
    id: 'sat_earth', kind: 'osiris', doorKey: 'sat_earth', status: 'live',
    words: 'Earth-observation satellites, classified by name from the same element set.',
    source: TLE, cadence: TLE_CADENCE, licence: LICENCE_NOT_READ, sourceUrl: TLE_URL,
  },
  {
    id: 'sat_science', kind: 'osiris', doorKey: 'sat_science', status: 'live',
    words: 'Crewed stations and science platforms, classified by name from the same element set.',
    source: TLE, cadence: TLE_CADENCE, licence: LICENCE_NOT_READ, sourceUrl: TLE_URL,
  },
  {
    id: 'balloons', kind: 'osiris', doorKey: 'balloons', status: 'dead',
    words: 'High-altitude balloons, wired into the app but never delivered by anything.',
    source: 'None. page.tsx:747 fetches /api/balloons when the layer opens and page.tsx:836 re-fetches it every 5 minutes, and src/app/api/balloons does not exist. The door accepts this layer and the layer panel has no toggle for it.',
    cadence: 'Requested every 5 minutes while the layer is on. Nothing answers.',
    licence: 'None to record. No data has ever reached this layer.',
    sourceUrl: null,
  },
  {
    id: 'cctv', kind: 'osiris', doorKey: 'cctv', status: 'live',
    words: 'Public road and city webcams, gathered per country and loaded in batches.',
    source: 'National road-authority camera feeds, collected per country in api/cctv/ (ASFINAG for Austria, Rijkswaterstaat for the Netherlands, plus Bulgaria, Greece and Serbia).',
    cadence: 'Loaded progressively in regional batches, three attempts with backoff (camera-catalog.ts:45).',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://odo.asfinag.at/odo/rest/sec/resource/001/json/webcams',
  },
  {
    id: 'cctv_previews', kind: 'osiris', doorKey: 'cctv_previews', status: 'render_only',
    words: 'Draws a live preview tile over each camera dot instead of a plain marker.',
    source: 'No source of its own. It is a drawing mode over the cctv layer, declared with an empty dataKey at LayerPanel.tsx:97.',
    cadence: 'Redraws with the cctv layer it sits on top of.',
    licence: 'Inherits whatever the cctv layer carries. Nothing new is fetched.',
    sourceUrl: null,
  },
  {
    id: 'live_news', kind: 'osiris', doorKey: 'live_news', status: 'unsourced',
    words: 'Round-the-clock news broadcasts pinned to the city each one comes from.',
    source: 'A hand-written list of YouTube channel URLs in this repo (api/live-news/route.ts:15 onward), each flagged for whether the broadcaster permits embedding. No upstream directory is consulted.',
    cadence: 'Read once when the layer opens. The list only changes when someone edits the file.',
    licence: 'Each broadcaster sets its own terms on YouTube. None of them is recorded here.',
    sourceUrl: null,
  },
  {
    id: 'earthquakes', kind: 'osiris', doorKey: 'earthquakes', status: 'live',
    words: 'Seismic events of magnitude 2.5 and above from the past 24 hours.',
    source: 'The USGS earthquake feed, no API key required (api/earthquakes/route.ts:11).',
    cadence: 'Every 15 minutes, and only while the tab is visible (page.tsx:684).',
    licence: LICENCE_NOT_READ,
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  },
  {
    id: 'fires', kind: 'osiris', doorKey: 'fires', status: 'live',
    words: 'Active wildfire detections from orbit, plus currently erupting volcanoes.',
    source: 'NASA FIRMS VIIRS and MODIS 24-hour active fire products, with NASA EONET for volcanoes (api/fires/route.ts:18, :44).',
    cadence: 'Read once when the layer opens. The upstream products cover a rolling 24 hours.',
    licence: LICENCE_NOT_READ,
    sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
  },
  {
    id: 'weather', kind: 'osiris', doorKey: 'weather', status: 'live',
    words: 'Severe weather events worldwide, from storms and floods to droughts.',
    source: 'NASA EONET and the US NWS alert feed, plus GDACS. NOTE: this is the SECOND consumer of the GDACS RSS feed in this app; api/gdelt/route.ts:29 fetches the same URL for global_incidents. This route deliberately drops the earthquake and wildfire types because other layers already carry them (api/weather/route.ts:84).',
    cadence: 'Read once when the layer opens.',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://eonet.gsfc.nasa.gov/api/v3/events',
  },
  {
    id: 'radiation', kind: 'osiris', doorKey: 'radiation', status: 'dead',
    words: 'Environmental radiation monitoring stations, wired into the app but never delivered.',
    source: 'None. page.tsx:752 fetches /api/radiation when the layer opens and page.tsx:839 re-fetches it every 5 minutes, and src/app/api/radiation does not exist. The door accepts this layer and the layer panel has no toggle for it.',
    cadence: 'Requested every 5 minutes while the layer is on. Nothing answers.',
    licence: 'None to record. No data has ever reached this layer.',
    sourceUrl: null,
  },
  {
    id: 'infrastructure', kind: 'osiris', doorKey: 'infrastructure', status: 'unsourced',
    words: 'Nuclear power stations and research reactors, with their operator and status.',
    source: 'NOT a feed: a hand-written constant in this repo (api/infrastructure/route.ts:35 onward). Individual rows carry a Wikipedia link, and the seven Dutch installations are annotated as ANVS-licensed (:28), but there is no upstream dataset behind any of it.',
    cadence: 'Read once when the layer opens. The list only changes when someone edits the file.',
    licence: 'No dataset licence to record, because there is no dataset. The per-row Wikipedia links carry Wikipedia terms.',
    sourceUrl: null,
  },
  {
    id: 'global_incidents', kind: 'osiris', doorKey: 'global_incidents', status: 'live',
    words: 'Disaster alerts worldwide, despite the route that serves them being called gdelt.',
    source: 'The GDACS disaster RSS feed (api/gdelt/route.ts:29). NOTE: the route name is misleading and api/gdelt-events/route.ts:11 says so out loud. This is the FIRST of two consumers of the same GDACS URL; the weather layer fetches it again at api/weather/route.ts:159.',
    cadence: 'Read once when the layer opens.',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://www.gdacs.org/xml/rss.xml',
  },
  {
    id: 'war_alerts', kind: 'osiris', doorKey: 'war_alerts', status: 'dead',
    words: 'Nothing. This layer id exists and no code anywhere reads it.',
    source: 'None. The id appears exactly once in the whole of src/, as its own boot default in this file. Nothing fetches it, nothing draws it, and the layer panel has no toggle for it, yet the control door accepts it and acks a change that cannot happen.',
    cadence: 'Never. There is nothing to refresh.',
    licence: 'None to record. This layer has never carried data.',
    sourceUrl: null,
  },
  {
    id: 'day_night', kind: 'osiris', doorKey: 'day_night', status: 'render_only',
    words: 'Shades the half of the globe currently in darkness.',
    source: 'No source. The terminator is computed from the clock, declared with an empty dataKey at LayerPanel.tsx:144.',
    cadence: 'Recomputed as the clock moves. Nothing is fetched.',
    licence: 'Nothing to licence. No third-party data is involved.',
    sourceUrl: null,
  },
  {
    id: 'cables', kind: 'osiris', doorKey: 'cables', status: 'unsourced',
    words: 'Submarine communications cables drawn as routes across the sea floor.',
    source: 'A GeoJSON file committed to this repo at public/data/submarine-cables.json. It is served as a static asset, not fetched from anywhere, and nothing records where it came from.',
    cadence: 'Read once when the layer opens. The file only changes when someone commits a new one.',
    licence: LICENCE_NOT_READ, sourceUrl: null,
  },
  {
    id: 'sdk_sea', kind: 'osiris', doorKey: 'sdk_sea', status: 'render_only',
    words: 'Draws the sea domain of the intelligence-fusion mesh as lines between vessels.',
    source: 'No source of its own. It derives from the maritime layer that is already loaded (page.tsx:928 onward) and draws lines only, deliberately not duplicating the markers.',
    cadence: 'Redrawn whenever the maritime data underneath it changes.',
    licence: 'Inherits the maritime layer terms. Nothing new is fetched.',
    sourceUrl: null,
  },
  {
    id: 'sdk_air', kind: 'osiris', doorKey: 'sdk_air', status: 'render_only',
    words: 'Draws the air domain of the same mesh from flights already on the map.',
    source: 'No source of its own. It samples the flight layers already loaded (page.tsx:928 onward) and draws lines only. The layer panel has no toggle for it.',
    cadence: 'Redrawn whenever the flight data underneath it changes.',
    licence: 'Inherits the ADS-B terms. Nothing new is fetched.',
    sourceUrl: null,
  },
  {
    id: 'sdk_naval', kind: 'osiris', doorKey: 'sdk_naval', status: 'render_only',
    words: 'Draws the naval domain of the same mesh from vessels already on the map.',
    source: 'No source of its own. It derives from the maritime layer already loaded (page.tsx:928 onward) and draws lines only. The layer panel has no toggle for it.',
    cadence: 'Redrawn whenever the maritime data underneath it changes.',
    licence: 'Inherits the maritime layer terms. Nothing new is fetched.',
    sourceUrl: null,
  },
  {
    id: 'terrain_3d', kind: 'osiris', doorKey: 'terrain_3d', status: 'render_only',
    words: 'Extrudes building footprints into blocks once you are zoomed in past 14.5.',
    source: 'No data layer of its own. It switches on building extrusion in the basemap style, declared with an empty dataKey at LayerPanel.tsx:145.',
    cadence: 'Redrawn as you move the camera. Nothing is polled.',
    licence: 'Carried by whatever basemap style is configured, not by this layer.',
    sourceUrl: null,
  },
  {
    id: 'terrain_elevation', kind: 'osiris', doorKey: 'terrain_elevation', status: 'live',
    words: 'Raises mountains into real relief using elevation tiles, near the camera only.',
    source: 'Terrarium elevation tiles from the AWS elevation-tiles-prod bucket (terrain-tiles.ts:6). The app already surfaces the credits link in the layer panel.',
    cadence: 'Tiles are fetched and cached as you move, only after the camera stops.',
    licence: 'The Tilezen Joerd attribution page states the terms, and map-terrain.ts:55 links it in the UI.',
    sourceUrl: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  },
  {
    id: 'malware', kind: 'osiris', doorKey: 'malware', status: 'live',
    words: 'Hosts newly reported as serving malware, placed where they are hosted.',
    source: 'The abuse.ch URLhaus recent-URLs feed (malware-live.ts:84), pushed to the browser over server-sent events rather than polled.',
    cadence: 'Pushed as URLhaus reports it, so there is no client poll interval at all.',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://urlhaus.abuse.ch/downloads/csv_recent/',
  },
  {
    id: 'cyber_attacks', kind: 'osiris', doorKey: 'cyber_attacks', status: 'live',
    words: 'Animated arcs from an attributed origin region to a live command-and-control server.',
    source: 'The abuse.ch Feodo Tracker IP blocklist for the destinations (api/cyber-attacks/route.ts:73). The origin end of each arc is NOT measured: it is a family-to-region guess from a lookup table in that route.',
    cadence: 'Once when the layer opens, then every 10 seconds (page.tsx:845).',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://feodotracker.abuse.ch/downloads/ipblocklist.json',
  },
  {
    id: 'gdelt_events', kind: 'osiris', doorKey: 'gdelt_events', status: 'live',
    words: 'Geocoded world news events from the GDELT project, the real one.',
    source: 'The GDELT 2.0 fifteen-minute events export, free and without auth (api/gdelt-events/route.ts:7). This is the layer actually backed by GDELT, unlike global_incidents.',
    cadence: 'Read once when the layer opens, capped at 600 events. GDELT itself publishes every 15 minutes.',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://www.gdeltproject.org/',
  },
  {
    id: 'cf_outages', kind: 'osiris', doorKey: 'cf_outages', status: 'live',
    words: 'Countries currently seeing an internet disruption, as Cloudflare observes it.',
    source: 'Cloudflare Radar, which needs a CLOUDFLARE_API_TOKEN scoped to Radar Read. Without the token the route reports itself unconfigured and the toggle stays hidden, so the door refuses this layer by name.',
    cadence: 'Read once when the layer opens. One request backs this layer and cf_attacks together.',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://radar.cloudflare.com/',
  },
  {
    id: 'cf_attacks', kind: 'osiris', doorKey: 'cf_attacks', status: 'live',
    words: 'Where network attack traffic is originating, as Cloudflare observes it.',
    source: 'Cloudflare Radar, same credential and same request as cf_outages (page.tsx:818). Also hidden and door-refused when the token is absent.',
    cadence: 'Read once when the layer opens. One request backs both Cloudflare layers.',
    licence: LICENCE_NOT_READ, sourceUrl: 'https://radar.cloudflare.com/',
  },
];

/** Built once at module scope: 313-21 and 313-23 look rows up per layer. */
const OSIRIS_BY_ID: ReadonlyMap<string, OsirisRow> = new Map(
  OSIRIS_LAYERS.map(row => [row.id, row]),
);

export function osirisLayer(id: string): OsirisRow | undefined {
  return OSIRIS_BY_ID.get(id);
}
