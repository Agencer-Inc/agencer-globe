import { parseCsv, csvColumns } from './csv';

/**
 * OSIRIS — the power station dataset, as rows.
 *
 * THE LICENCE FOR THIS DATA HAS NOT BEEN READ. The catalogue row says so in its
 * own licence field and the query door carries that sentence verbatim onto
 * every answer. This module says what the rows LOOK like; it says nothing about
 * whether they may be used, and 313-24 is still the row that answers that.
 *
 * Parsing lives here rather than in the route or the earth fetcher because both
 * of them need it and neither should own it: api/power-plants owns the upstream
 * and its cache, lib/earth/registry reads that route, and this is the mapping
 * they share. Pure and synchronous, so it can be pinned without a network.
 */

export interface PowerPlant {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** The publisher's primary fuel, lowercased. Becomes the EarthItem `kind`. */
  fuel: string;
  capacityMw: number | null;
  country: string | null;
  owner: string | null;
  commissioningYear: number | null;
}

/**
 * An EMPTY cell is not a zero.
 *
 * `Number('')` is 0 and 0 is finite, so a plain Number() on a blank latitude
 * passes every check and puts the station at [0, 0] — a real place in the Gulf
 * of Guinea. The pin for this caught it on the way in.
 */
const num = (value: string | undefined): number =>
  value === undefined || value.trim() === '' ? NaN : Number(value);

const text = (value: string | undefined): string | null =>
  value === undefined || value.trim() === '' ? null : value;

/**
 * Map the published CSV to rows.
 *
 * Throws when a column this needs is absent, naming what it wanted and what it
 * got: a publisher that renames a column should produce a loud failure, not a
 * layer that silently holds nothing.
 */
export function parsePowerPlants(csv: string): PowerPlant[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('power plant database returned no rows');

  // By NAME, never by position. Column order is not part of the publisher's
  // promise, and reading latitude from a fixed index works right up until a
  // column is inserted before it, at which point every plant moves silently.
  const at = csvColumns(rows[0]);
  const { latitude, longitude, name, gppd_idnr: id, primary_fuel: fuel } = at;
  if (latitude === undefined || longitude === undefined || id === undefined) {
    throw new Error(
      'power plant database is missing a column this reader needs ' +
      `(latitude, longitude, gppd_idnr); it has: ${rows[0].join(', ')}`,
    );
  }

  const plants: PowerPlant[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const lat = num(row[latitude]);
    const lng = num(row[longitude]);
    // A row without a real position is skipped, not defaulted.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const capacity = at.capacity_mw === undefined ? NaN : num(row[at.capacity_mw]);
    const year = at.commissioning_year === undefined ? NaN : num(row[at.commissioning_year]);

    plants.push({
      id: row[id] || `${lat},${lng}`,
      name: (name === undefined ? '' : row[name]) || 'Unnamed station',
      lat,
      lng,
      fuel: ((fuel === undefined ? '' : row[fuel]) || 'unknown').toLowerCase(),
      capacityMw: Number.isFinite(capacity) ? capacity : null,
      country: at.country_long === undefined ? null : text(row[at.country_long]),
      owner: at.owner === undefined ? null : text(row[at.owner]),
      commissioningYear: Number.isFinite(year) ? year : null,
    });
  }
  return plants;
}
