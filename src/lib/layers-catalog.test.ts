import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_LAYERS,
  LAYER_IDS,
  OSIRIS_LAYERS,
  osirisLayer,
  type CatalogRow,
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

/** Shared by both catalogue files: the rules a row obeys whatever its kind. */
export function assertRowShape(row: CatalogRow, where: string) {
  for (const field of ['id', 'words', 'source', 'cadence', 'licence'] as const) {
    expect(row[field], `${where}: ${row.id} has an empty ${field}`).not.toBe('');
    expect(typeof row[field], `${where}: ${row.id} has a non-string ${field}`).toBe('string');
  }

  // The whole point of the status field. "unknown" is non-empty, so a
  // not-empty check passes on a row nobody researched; banning the word is
  // what makes the not-empty check mean something (Law 31).
  for (const field of ['words', 'source', 'cadence', 'licence'] as const) {
    expect(
      row[field].trim().toLowerCase(),
      `${where}: ${row.id}.${field} is the word "unknown" — say what is actually true, or set status`,
    ).not.toBe('unknown');
  }

  // words is ONE sentence a person can read. Not a phrase list, and nothing
  // routes on it: if it ever became a list, something would start matching
  // against it and that is the regex-on-meaning this catalogue avoids.
  expect(row.words, `${where}: ${row.id}.words must be one sentence ending in a full stop`)
    .toMatch(/^[^\n]+\.$/);
  expect(row.words, `${where}: ${row.id}.words looks like a list, not a sentence`)
    .not.toMatch(/;|\band\/or\b|,\s*\w+\s*,\s*\w+\s*,/);

  if (row.status === 'live') {
    expect(row.sourceUrl, `${where}: ${row.id} is live, so it needs a sourceUrl`).not.toBeNull();
    expect(
      () => new URL(row.sourceUrl as string),
      `${where}: ${row.id}.sourceUrl is not a URL: ${row.sourceUrl}`,
    ).not.toThrow();
  } else {
    // A null url is allowed only when the row says why in its own source field.
    expect(
      row.source.length,
      `${where}: ${row.id} is ${row.status} with no url, so source must say why`,
    ).toBeGreaterThan(12);
  }
}

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
    for (const row of OSIRIS_LAYERS) assertRowShape(row, 'osiris');
  });

  it('backs a live row with a real url', () => {
    const live = OSIRIS_LAYERS.filter(row => row.status === 'live');
    expect(live.length, 'no live layers catalogued at all').toBeGreaterThan(0);
    for (const row of live) {
      expect(row.sourceUrl, `${row.id} is live with no url`).not.toBeNull();
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
