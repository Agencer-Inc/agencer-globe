import { describe, it, expect } from 'vitest';
import {
  filterProblems, matchesClauses, readField,
  FILTER_OPS, MAX_FILTER_CLAUSES, type FilterClause,
} from './filter';
import type { EarthItem } from './registry';

const plant = (over: Partial<EarthItem> = {}): EarthItem => ({
  id: 'WRI1',
  lat: 51.266,
  lng: 19.33,
  label: 'Belchatow',
  kind: 'coal',
  props: { capacityMw: 5298, country: 'Poland', owner: 'PGE', commissioningYear: 1988 },
  ...over,
});

describe('filterProblems rejects what it claims to reject', () => {
  it('accepts a well-formed filter', () => {
    expect(filterProblems([{ field: 'capacityMw', op: 'gt', value: 1000 }])).toEqual([]);
    expect(filterProblems([{ field: 'owner', op: 'exists' }])).toEqual([]);
  });

  it('rejects a filter that is not an array of clauses', () => {
    for (const bad of [null, 42, {}, 'coal']) {
      expect(filterProblems(bad), String(bad)).not.toEqual([]);
    }
  });

  it('rejects an empty filter, which is not the same as no filter', () => {
    expect(filterProblems([])).not.toEqual([]);
  });

  /* A typo'd operator that quietly matched nothing would read as an empty sky
     rather than as a mistake the caller can fix. */
  it('names an unknown operator and lists the ones it has', () => {
    const problems = filterProblems([{ field: 'kind', op: 'like', value: 'coal' }]);
    expect(problems.join(' ')).toMatch(/like/);
    for (const op of FILTER_OPS) expect(problems.join(' ')).toContain(op);
  });

  it('rejects a clause with no field, and names the clause', () => {
    expect(filterProblems([{ op: 'eq', value: 1 }]).join(' ')).toMatch(/clause 0/);
    expect(filterProblems([{ field: 'a', op: 'eq', value: 1 }, { field: '', op: 'eq', value: 1 }])
      .join(' ')).toMatch(/clause 1/);
  });

  it('requires a value for every op except exists', () => {
    expect(filterProblems([{ field: 'kind', op: 'eq' }]).join(' ')).toMatch(/needs a value/);
    expect(filterProblems([{ field: 'kind', op: 'exists' }])).toEqual([]);
  });

  it('rejects more clauses than it will apply', () => {
    const many = Array.from({ length: MAX_FILTER_CLAUSES + 1 }, () => ({ field: 'a', op: 'exists' }));
    expect(filterProblems(many)).not.toEqual([]);
  });
});

describe('readField reaches into props as well as the item', () => {
  it('reads a top-level field', () => {
    expect(readField(plant(), 'kind')).toBe('coal');
    expect(readField(plant(), 'label')).toBe('Belchatow');
  });

  it('reads a prop by its bare name', () => {
    expect(readField(plant(), 'capacityMw')).toBe(5298);
  });

  it('reads a prop explicitly, so one can share a name with a top-level field', () => {
    const odd = plant({ props: { kind: 'a prop called kind' } });
    expect(readField(odd, 'kind')).toBe('coal');
    expect(readField(odd, 'props.kind')).toBe('a prop called kind');
  });

  it('is undefined for a field nothing has', () => {
    expect(readField(plant(), 'nope')).toBeUndefined();
  });
});

describe('the operators', () => {
  const match = (clauses: FilterClause[], item = plant()) => matchesClauses(item, clauses);

  it('eq is case-insensitive for strings, because publishers are not consistent', () => {
    expect(match([{ field: 'kind', op: 'eq', value: 'Coal' }])).toBe(true);
    expect(match([{ field: 'country', op: 'eq', value: 'poland' }])).toBe(true);
    expect(match([{ field: 'kind', op: 'eq', value: 'gas' }])).toBe(false);
  });

  it('eq is exact for numbers', () => {
    expect(match([{ field: 'capacityMw', op: 'eq', value: 5298 }])).toBe(true);
    expect(match([{ field: 'capacityMw', op: 'eq', value: '5298' }])).toBe(false);
  });

  it('ne matches an item that lacks the field entirely', () => {
    // The alternative — absent meaning "no opinion" — makes "not grounded"
    // quietly drop every aircraft whose upstream said nothing, producing a
    // smaller answer that looks complete.
    expect(match([{ field: 'nope', op: 'ne', value: 'x' }])).toBe(true);
    expect(match([{ field: 'kind', op: 'ne', value: 'coal' }])).toBe(false);
  });

  it('compares numbers, and only numbers', () => {
    expect(match([{ field: 'capacityMw', op: 'gt', value: 1000 }])).toBe(true);
    expect(match([{ field: 'capacityMw', op: 'lt', value: 1000 }])).toBe(false);
    expect(match([{ field: 'capacityMw', op: 'gte', value: 5298 }])).toBe(true);
    expect(match([{ field: 'capacityMw', op: 'lte', value: 5298 }])).toBe(true);
  });

  /**
   * Number(null) is 0 and Number(undefined) is NaN, so a coercing comparison
   * would make "capacity < 1000" true of every station that never reported one.
   * A comparison against a missing field does not match, full stop.
   */
  it('does not coerce a missing or non-numeric field into a comparison', () => {
    const quiet = plant({ props: { capacityMw: null } });
    expect(matchesClauses(quiet, [{ field: 'capacityMw', op: 'lt', value: 1000 }])).toBe(false);
    expect(matchesClauses(quiet, [{ field: 'capacityMw', op: 'gt', value: -1 }])).toBe(false);
    expect(match([{ field: 'nope', op: 'lt', value: 1000 }])).toBe(false);
    expect(match([{ field: 'owner', op: 'gt', value: 1 }])).toBe(false);
  });

  it('contains looks inside a string, case-insensitively', () => {
    expect(match([{ field: 'label', op: 'contains', value: 'belcha' }])).toBe(true);
    expect(match([{ field: 'label', op: 'contains', value: 'zzz' }])).toBe(false);
  });

  it('contains looks for membership in an array', () => {
    const tagged = plant({ props: { fuels: ['Coal', 'Biomass'] } });
    expect(matchesClauses(tagged, [{ field: 'fuels', op: 'contains', value: 'biomass' }])).toBe(true);
    expect(matchesClauses(tagged, [{ field: 'fuels', op: 'contains', value: 'solar' }])).toBe(false);
  });

  it('exists asks only whether the field is there, and null is not there', () => {
    expect(match([{ field: 'owner', op: 'exists' }])).toBe(true);
    expect(match([{ field: 'nope', op: 'exists' }])).toBe(false);
    expect(matchesClauses(plant({ props: { owner: null } }), [{ field: 'owner', op: 'exists' }])).toBe(false);
  });

  it('exists can be asked the other way round', () => {
    expect(match([{ field: 'nope', op: 'exists', value: false }])).toBe(true);
    expect(match([{ field: 'owner', op: 'exists', value: false }])).toBe(false);
  });

  it('ANDs every clause', () => {
    expect(match([
      { field: 'kind', op: 'eq', value: 'coal' },
      { field: 'capacityMw', op: 'gt', value: 1000 },
    ])).toBe(true);

    expect(match([
      { field: 'kind', op: 'eq', value: 'coal' },
      { field: 'capacityMw', op: 'gt', value: 999_999 },
    ])).toBe(false);
  });

  /** The question the black box said could not be expressed at all. */
  it('answers "the big coal stations in this set", which kind+label never could', () => {
    const fleet = [
      plant({ id: 'big-coal', kind: 'coal', props: { capacityMw: 5298 } }),
      plant({ id: 'small-coal', kind: 'coal', props: { capacityMw: 40 } }),
      plant({ id: 'big-gas', kind: 'gas', props: { capacityMw: 3000 } }),
    ];
    const clauses: FilterClause[] = [
      { field: 'kind', op: 'eq', value: 'coal' },
      { field: 'capacityMw', op: 'gte', value: 1000 },
    ];
    expect(fleet.filter(p => matchesClauses(p, clauses)).map(p => p.id)).toEqual(['big-coal']);
  });
});
