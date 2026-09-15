/**
 * OSIRIS earth server — the filter grammar.
 *
 * `matchesFilter` read `kind` and `label` and nothing else, so every "which
 * ones are X" question was unanswerable however it was worded: EarthItem
 * carries a `props` bag and the filter could not see into it. An aircraft's
 * altitude, a power station's capacity and fuel, an earthquake's magnitude were
 * all right there and unreachable.
 *
 *   filter: "coal"                                  substring, kind + label
 *   filter: [{ field, op, value }]                  reaches into props
 *
 * THE STRING FORM IS UNCHANGED. It is deliberately dumb — anything cleverer
 * would be matching a user's wording against meaning — and it stays exactly
 * that, pinned by the tests that already existed. The structured form arrives
 * BESIDE it rather than replacing it, so nothing that worked stops working.
 *
 * CLAUSES ARE ANDed. Every clause must match. `or` was left out on purpose: it
 * needs nesting to mean anything, nesting needs precedence, and precedence is a
 * query language. A caller that needs a union can ask twice and merge, and will
 * know exactly what it asked for both times.
 *
 * A FIELD AN ITEM LACKS SIMPLY DOES NOT MATCH, and is not an error. A feed is
 * heterogeneous — one aircraft reports a model and the next does not — and
 * refusing the whole query because one row is missing a field would make the
 * odd row break the answer for all the others. An unknown OPERATOR is a
 * different thing entirely: that is the caller's typo, and it is refused by
 * name, because silently matching nothing would look like an empty sky.
 */

import type { EarthItem } from './registry';

export const FILTER_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'exists'] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterClause {
  /**
   * An EarthItem field, or a key in its props bag.
   *
   * Resolution order: an explicit `props.x` reads the bag; a bare name that is
   * a top-level EarthItem field reads that; anything else falls back to the
   * bag. So `capacityMw` and `props.capacityMw` both work, and `props.kind`
   * can still reach a prop that shares a name with a top-level field.
   */
  field: string;
  op: FilterOp;
  /** Not read by `exists`, which asks only whether the field is there. */
  value?: unknown;
}

/** The most clauses one filter may carry. A bounded door bounds its inputs. */
export const MAX_FILTER_CLAUSES = 16;

const TOP_LEVEL = new Set(['id', 'lat', 'lng', 'label', 'kind']);

const isOp = (value: unknown): value is FilterOp =>
  typeof value === 'string' && (FILTER_OPS as readonly string[]).includes(value);

/**
 * The rules a structured filter must obey, in words.
 *
 * Pinned against filters built to break each rule, the same standard
 * bboxProblems and registryProblems hold (Law 31).
 */
export function filterProblems(filter: unknown): string[] {
  if (!Array.isArray(filter)) {
    return ['a structured filter must be an array of { field, op, value } clauses'];
  }
  if (filter.length === 0) {
    return ['a structured filter must carry at least one clause; send no filter at all to match everything'];
  }
  if (filter.length > MAX_FILTER_CLAUSES) {
    return [`filter has ${filter.length} clauses, more than the ${MAX_FILTER_CLAUSES} this door applies`];
  }

  const problems: string[] = [];
  filter.forEach((clause, i) => {
    if (typeof clause !== 'object' || clause === null || Array.isArray(clause)) {
      problems.push(`clause ${i} must be an object { field, op, value }`);
      return;
    }
    const { field, op, value } = clause as Record<string, unknown>;

    if (typeof field !== 'string' || field.trim() === '') {
      problems.push(`clause ${i} field must be a non-empty string`);
    }
    if (!isOp(op)) {
      // Named, never ignored: an unrecognised operator that quietly matched
      // nothing would read as an empty sky rather than as a typo.
      problems.push(`clause ${i} op must be one of ${FILTER_OPS.join(', ')}, got ${String(op)}`);
    }
    if (op !== 'exists' && value === undefined) {
      problems.push(`clause ${i} needs a value for op ${String(op)}`);
    }
  });
  return problems;
}

/** Read one field off an item, following the resolution order above. */
export function readField(item: EarthItem, field: string): unknown {
  if (field.startsWith('props.')) return item.props?.[field.slice(6)];
  if (TOP_LEVEL.has(field)) return (item as unknown as Record<string, unknown>)[field];
  return item.props?.[field];
}

/** Case-insensitive for strings, exact for everything else. A caller asking for
 *  "Coal" and a publisher writing "coal" mean the same thing. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Both sides must be real numbers. A comparison against a missing or
 *  non-numeric field does not match, rather than coercing its way to true:
 *  Number(null) is 0, and "altitude < 1000" would then be true of every
 *  aircraft that did not report one. */
function compare(left: unknown, right: unknown, op: 'lt' | 'lte' | 'gt' | 'gte'): boolean {
  const a = typeof left === 'number' ? left : NaN;
  const b = typeof right === 'number' ? right : Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b;
}

function matchesClause(item: EarthItem, clause: FilterClause): boolean {
  const actual = readField(item, clause.field);

  switch (clause.op) {
    case 'exists': {
      const there = actual !== undefined && actual !== null;
      // `{ op: 'exists', value: false }` asks the opposite question, which is
      // the only reason exists reads a value at all.
      return clause.value === false ? !there : there;
    }
    case 'eq':
      return same(actual, clause.value);
    case 'ne':
      // A field that is absent is NOT equal to the value, so it matches `ne`.
      // The alternative — absent means no opinion — makes "not grounded" quietly
      // exclude every aircraft whose upstream said nothing, which is a smaller
      // answer that looks complete.
      return !same(actual, clause.value);
    case 'contains': {
      if (Array.isArray(actual)) return actual.some(entry => same(entry, clause.value));
      if (typeof actual !== 'string') return false;
      return actual.toLowerCase().includes(String(clause.value).toLowerCase());
    }
    default:
      return compare(actual, clause.value, clause.op);
  }
}

/** Every clause must match. */
export function matchesClauses(item: EarthItem, clauses: readonly FilterClause[]): boolean {
  return clauses.every(clause => matchesClause(item, clause));
}
