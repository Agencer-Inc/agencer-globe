import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_LAYERS,
  LAYER_IDS,
  OSIRIS_LAYERS,
  PAINT_EXEMPT,
  catalogRowProblems,
  genericPaintProblems,
  osirisLayer,
  type CatalogRow,
  type OsirisRow,
} from './layers-catalog';

/**
 * The pins for the catalogue's osiris half.
 *
 * The load-bearing one is set-equality against DEFAULT_ACTIVE_LAYERS, which is
 * the same object page.tsx boots its state from and therefore the same list the
 * control door validates against. It is not a copy, so this is not a test
 * comparing a file to itself.
 *
 * Every assertion below names the offending id. A pin that reports
 * "expected 34 to be 0" tells whoever broke it nothing, and they will re-run it
 * three times before reading the source.
 */

/**
 * A row that breaks nothing, so each validator pin below can break exactly one
 * rule and prove the validator catches that rule specifically. Starting from a
 * known-good row is what makes a red here readable.
 */
const goodRow = (over: Partial<CatalogRow> = {}): CatalogRow => ({
  id: 'a_layer',
  kind: 'osiris',
  words: 'A sentence that says what the layer is.',
  source: 'Somebody who publishes it, named at length so the null-url rule is satisfied.',
  cadence: 'Every so often.',
  licence: 'Stated by the publisher.',
  status: 'live',
  sourceUrl: 'https://example.test/feed',
  doorKey: 'a_layer',
  ...over,
});

describe('the validator rejects what it claims to reject', () => {
  // Law 31: catalogRowProblems is the thing asserting every other row is
  // correct, so it gets the same scrutiny as the rows. A validator nobody
  // proved says no is a validator that says yes to everything.
  it('passes a good row', () => {
    expect(catalogRowProblems(goodRow())).toEqual([]);
  });

  it('catches an empty text field, by name', () => {
    expect(catalogRowProblems(goodRow({ licence: '' }))).toContain('licence is empty');
    expect(catalogRowProblems(goodRow({ cadence: '   ' }))).toContain('cadence is empty');
  });

  it('catches the word unknown, which is the whole point of the status field', () => {
    expect(catalogRowProblems(goodRow({ licence: 'unknown' })).join(' ')).toMatch(/licence is the word/);
    expect(catalogRowProblems(goodRow({ cadence: 'Unknown' })).join(' ')).toMatch(/cadence is the word/);
    // Only the bare word. A sentence that happens to contain it is fine.
    expect(catalogRowProblems(goodRow({ licence: 'The publisher leaves it unknown to the reader.' }))).toEqual([]);
  });

  it('catches words that is not one readable sentence', () => {
    expect(catalogRowProblems(goodRow({ words: 'No full stop' })).join(' ')).toMatch(/one line ending/);
    expect(catalogRowProblems(goodRow({ words: 'Two\nlines.' })).join(' ')).toMatch(/one line ending/);
    expect(catalogRowProblems(goodRow({ words: 'ships; boats; vessels.' })).join(' ')).toMatch(/reads as a list/);
  });

  it('catches a live row with no url, or a url that is not one', () => {
    expect(catalogRowProblems(goodRow({ sourceUrl: null })).join(' ')).toMatch(/sourceUrl is required/);
    expect(catalogRowProblems(goodRow({ sourceUrl: 'not a url' })).join(' ')).toMatch(/is not a URL/);
  });

  it('holds a catalogued row to the same url rule as a live one', () => {
    expect(catalogRowProblems(goodRow({ status: 'catalogued', sourceUrl: null })).join(' '))
      .toMatch(/sourceUrl is required/);
  });

  it('checks a url on EVERY row that has one, not only the live ones', () => {
    // /review caught this: the url parse used to live inside the live branch,
    // so a dead or unsourced row could carry "garbage" as its sourceUrl and
    // nothing ever looked at it. Required-ness and well-formedness are two
    // different rules and they are now checked separately.
    for (const status of ['dead', 'render_only', 'unsourced'] as const) {
      expect(
        catalogRowProblems(goodRow({ status, sourceUrl: 'garbage' })).join(' '),
        `a ${status} row with a malformed url slipped through`,
      ).toMatch(/is not a URL/);
    }
  });

  it('lets a non-live row drop its url only when it says why', () => {
    expect(catalogRowProblems(goodRow({ status: 'dead', sourceUrl: null, source: 'None.' })).join(' '))
      .toMatch(/source must say why/);
    expect(catalogRowProblems(goodRow({ status: 'dead', sourceUrl: null }))).toEqual([]);
  });
});

describe('the osiris half mirrors the door vocabulary, both ways', () => {
  it('every layer the app boots with has exactly one catalogue row', () => {
    const catalogued = new Set(OSIRIS_LAYERS.map(row => row.id));
    const missing = LAYER_IDS.filter(id => !catalogued.has(id));
    expect(missing, `layers with no catalogue row: ${missing.join(', ')}`).toEqual([]);
  });

  it('every catalogue row names a layer the app really has', () => {
    const known = new Set<string>(LAYER_IDS);
    const strays = OSIRIS_LAYERS.map(row => row.id).filter(id => !known.has(id));
    expect(strays, `catalogue rows naming no real layer: ${strays.join(', ')}`).toEqual([]);
  });

  it('no id is catalogued twice', () => {
    const seen = new Map<string, number>();
    for (const row of OSIRIS_LAYERS) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
    const doubled = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(doubled, `catalogued more than once: ${doubled.join(', ')}`).toEqual([]);
  });

  it('reads the vocabulary from the object page.tsx actually boots from', () => {
    // Guards the pin itself. If DEFAULT_ACTIVE_LAYERS were ever replaced by a
    // hand-written id list, the tests above would still pass while proving
    // nothing about the door, because the door reads Object.keys of the state
    // page.tsx seeds from this object.
    expect(LAYER_IDS).toEqual(Object.keys(DEFAULT_ACTIVE_LAYERS));
    expect(LAYER_IDS.length).toBeGreaterThan(0);
    for (const id of LAYER_IDS) {
      expect(typeof DEFAULT_ACTIVE_LAYERS[id], `${id} has no boot default`).toBe('boolean');
    }
  });

  it('carries the door key verbatim', () => {
    const wrong = OSIRIS_LAYERS.filter(row => row.doorKey !== row.id).map(row => row.id);
    expect(wrong, `doorKey does not match id: ${wrong.join(', ')}`).toEqual([]);
  });

  it('is entirely kind osiris', () => {
    const wrong = OSIRIS_LAYERS.filter(row => row.kind !== 'osiris').map(row => row.id);
    expect(wrong, `wrong kind in the osiris catalogue: ${wrong.join(', ')}`).toEqual([]);
  });
});

describe('every osiris row says something true', () => {
  it('fills all its fields, with no filler', () => {
    const broken = OSIRIS_LAYERS
      .map(row => ({ id: row.id, problems: catalogRowProblems(row) }))
      .filter(entry => entry.problems.length);
    expect(broken, broken.map(e => `${e.id}: ${e.problems.join('; ')}`).join(' | ')).toEqual([]);
  });

  it('backs a live row with a real url', () => {
    const live = OSIRIS_LAYERS.filter(row => row.status === 'live');
    expect(live.length, 'no live layers catalogued at all').toBeGreaterThan(0);
    for (const row of live) {
      expect(row.sourceUrl, `${row.id} is live with no url`).not.toBeNull();
    }
  });
});

/**
 * The generic paint path was built ALONGSIDE the hand-wired one, because a
 * big-bang rewrite of a 2,805-line renderer is how globe work stops shipping.
 * These pins are what stop "alongside" quietly becoming "forgotten": every live
 * layer is either generic or named as an exemption with a reason, and migrating
 * one is a deletion from that map.
 */
describe('every live layer is either drawn generically or says why not', () => {
  it('has no layer that is silently neither', () => {
    expect(genericPaintProblems()).toEqual([]);
  });

  it('catches a live row with no paint and no exemption', () => {
    const stray = goodRow({ id: 'brand_new', status: 'live' }) as OsirisRow;
    expect(genericPaintProblems([stray]).join(' ')).toMatch(/brand_new/);
  });

  it('catches a row that has migrated but kept its exemption', () => {
    const migrated = {
      ...goodRow({ id: 'flights', status: 'live' }),
      paint: { dataKey: 'flights', color: '#fff', radius: [[1, 2]] },
    } as unknown as OsirisRow;
    expect(genericPaintProblems([migrated]).join(' ')).toMatch(/delete the exemption/);
  });

  it('catches an exemption naming a layer that no longer exists', () => {
    expect(genericPaintProblems([]).join(' ')).toMatch(/not a catalogue row/);
  });

  it('ignores a row that is not live, because nothing draws it anyway', () => {
    // Held against the real catalogue, so the exemption map still has its rows
    // to match. A dead layer needs no paint and must not be reported.
    const dead = goodRow({ id: 'gone', status: 'dead', sourceUrl: null }) as OsirisRow;
    expect(genericPaintProblems([...OSIRIS_LAYERS, dead])).toEqual([]);
  });

  it('draws power_plants generically, with a route and a spec', () => {
    const row = osirisLayer('power_plants');
    expect(row?.appRoute).toBe('/api/power-plants');
    expect(row?.paint?.dataKey).toBe('power_plants');
    expect(PAINT_EXEMPT.power_plants).toBeUndefined();
  });

  it('gives every exemption a reason, not a bare marker', () => {
    for (const [id, reason] of Object.entries(PAINT_EXEMPT)) {
      expect(reason.trim().length, `${id} has an empty reason`).toBeGreaterThan(20);
    }
  });
});

describe('lookup', () => {
  it('finds a catalogued layer by id', () => {
    for (const row of OSIRIS_LAYERS) expect(osirisLayer(row.id)).toBe(row);
  });

  it('returns undefined for an id the app does not have', () => {
    expect(osirisLayer('not_a_layer')).toBeUndefined();
  });
});
