import { describe, expect, it } from 'vitest';
import { catalogRowProblems } from './layers-catalog';
import { SOURCE_ROWS, sourceRow } from './source-catalog';

/**
 * The pins for the sources that are not on the globe yet.
 *
 * These are deliberately weaker than the osiris pins next door, and that is
 * the reason this file exists separately. There is no vocabulary to be
 * set-equal to, so nothing here can prove a licence is right or a source is
 * still up. What it can prove: every row is filled in, says one readable
 * sentence, points somewhere that parses, and does not quietly duplicate an id
 * the globe already uses for something else.
 */

describe('every source row is well formed', () => {
  it('obeys the same row rules as the osiris catalogue', () => {
    const broken = SOURCE_ROWS
      .map(row => ({ id: row.id, problems: catalogRowProblems(row) }))
      .filter(entry => entry.problems.length);
    expect(broken, broken.map(e => `${e.id}: ${e.problems.join('; ')}`).join(' | ')).toEqual([]);
  });

  it('never claims a door key, because none of this is wired to the door', () => {
    const wired = SOURCE_ROWS.filter(row => row.doorKey !== null).map(row => row.id);
    expect(wired, `rows claiming a door key they do not have: ${wired.join(', ')}`).toEqual([]);
  });

  /* There is deliberately NO test that these rows are never kind 'osiris'.
     SourceRow narrows `kind` to 'power' | 'world_monitor', so tsc rejects the
     comparison outright: the assertion could not fail, and a test that cannot
     fail is not a test (Law 31). The type carries that guarantee, not a pin. */

  it('catalogues no id twice', () => {
    const seen = new Map<string, number>();
    for (const row of SOURCE_ROWS) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
    const doubled = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(doubled, `catalogued more than once: ${doubled.join(', ')}`).toEqual([]);
  });
});

describe('the rows row 313-22 asked for are actually here', () => {
  it('carries both power layers', () => {
    const power = SOURCE_ROWS.filter(row => row.kind === 'power').map(row => row.id);
    expect(power).toEqual(['power_plants', 'power_lines']);
  });

  it('carries the first five World-Monitor sources', () => {
    const monitor = SOURCE_ROWS.filter(row => row.kind === 'world_monitor').map(row => row.id);
    expect(monitor).toEqual([
      'military_bases',
      'nuclear_sites',
      'ports',
      'gdacs_disasters',
      'military_aircraft',
    ]);
  });

  it('carries no data, because cataloguing a source is not fetching it', () => {
    // The row is explicit that no data lands on this leg. If a future change
    // starts hanging records off these rows, this pin is the thing that says
    // so, and whoever does it can delete it on purpose rather than by accident.
    for (const row of SOURCE_ROWS) {
      expect(Object.keys(row).sort()).toEqual([
        'cadence', 'doorKey', 'id', 'kind', 'licence', 'source', 'sourceUrl', 'status', 'words',
      ]);
    }
  });
});

describe('the rows say out loud what already overlaps the globe', () => {
  // The useful half of this catalogue. Three of the five World-Monitor sources
  // overlap something this app already draws, and a row that hid that would
  // send 313-21 and 313-23 off to build a second opinion on a feed the app
  // already holds one on.
  it('warns that GDACS is already fetched twice by this app', () => {
    const gdacs = sourceRow('gdacs_disasters');
    expect(gdacs?.source).toMatch(/api\/gdelt\/route\.ts:29/);
    expect(gdacs?.source).toMatch(/api\/weather\/route\.ts:159/);
  });

  it('warns that ports and nuclear sites are hardcoded constants today', () => {
    expect(sourceRow('ports')?.source).toMatch(/api\/maritime\/route\.ts:9/);
    expect(sourceRow('nuclear_sites')?.source).toMatch(/api\/infrastructure\/route\.ts:35/);
  });

  it('warns that military aircraft are already drawn from another publisher', () => {
    expect(sourceRow('military_aircraft')?.source).toMatch(/api\/aircraft\/route\.ts:22/);
  });

  it('says plainly that military bases is the only one with nothing behind it', () => {
    const bases = sourceRow('military_bases');
    expect(bases?.status).toBe('unsourced');
    expect(bases?.sourceUrl).toBeNull();
  });
});

describe('lookup', () => {
  it('finds a catalogued source by id', () => {
    for (const row of SOURCE_ROWS) expect(sourceRow(row.id)).toBe(row);
  });

  it('returns undefined for an id nobody catalogued', () => {
    expect(sourceRow('not_a_source')).toBeUndefined();
  });
});
