#!/usr/bin/env node
/**
 * OSIRIS — promote a resolved place into the hand-written table.
 *
 *     node tools/promote-place.mjs <name> [--user <id>] [--pick <n>] [--server <origin>]
 *     node tools/promote-place.mjs Poland
 *     node tools/promote-place.mjs "Canary Islands" --pick 0
 *
 * WHY THIS EXISTS. api/earth/resolve writes into a MEMORY cache that dies with
 * the server, which is the right default — everything in it is re-resolvable
 * from a public upstream, and THE-GATE rule 2 names that swap point. But it
 * means every restart loses the geography, and anything a demo depends on has
 * to be re-confirmed by hand first. That bit twice inside one test session.
 *
 * So this writes the chosen candidate into PLACES as an ordinary hand row, and
 * from then on it resolves at boot with no network and no confirm step.
 *
 * ── WHAT IT DOES NOT DO, AND WHY ──
 *
 * It does not silently accept a geocoder's first answer. It prints every
 * candidate with the context that tells two places of one name apart, and
 * WITHOUT --pick it stops there and writes nothing. That is the same standard
 * the resolve door holds (places.ts: never fuzzy, never nearest): the choice
 * belongs to whoever can tell Poland from Poland, Ohio, and this tool is not
 * that party either.
 *
 * The row it writes is REVIEWABLE — a real diff, in the real file, with a note
 * saying where the box came from and whether the publisher drew it or we
 * derived it. A promoted place that turns out wrong is a line somebody can read
 * and delete, not a cache entry nobody can see.
 *
 * ── THE CAVEAT IT WRITES INTO EVERY NOTE ──
 *
 * A box is geometry; a country is geography. The Poland box holds 563 power
 * stations of which 189 are Polish (places.ts's own header has the measurement).
 * The note records the box's provenance so the next reader is not misled into
 * treating a rectangle as a border.
 */

import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const positional = args.filter((a, i) =>
  !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const name = positional[0];
const user = flag('user', 'promote-place');
const server = flag('server', process.env.EARTH_SELF_ORIGIN || 'http://127.0.0.1:3000');
const pickRaw = flag('pick', undefined);

if (!name) {
  console.error('usage: node tools/promote-place.mjs <name> [--pick <n>] [--user <id>] [--server <origin>]');
  process.exit(2);
}

const PLACES_FILE = new URL('../src/lib/earth/places.ts', import.meta.url);

/** The same normalisation places.ts applies, so the key this writes is the key
 *  resolvePlace will build. A row whose key is not normalised is unreachable,
 *  and placesTableProblems() would fail the suite rather than warn. */
const normalise = (value) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const res = await fetch(`${server}/api/earth/resolve`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-osiris-user': user },
  body: JSON.stringify({ name }),
}).catch((e) => {
  console.error(`could not reach the resolve door at ${server}: ${e.message}`);
  console.error('is the fork running, and is NEXT_PUBLIC_EARTH_SERVER=1 set?');
  process.exit(1);
});

if (!res.ok) {
  const body = await res.text();
  console.error(`resolve answered ${res.status}: ${body}`);
  process.exit(1);
}

const { candidates } = await res.json();
if (!candidates?.length) {
  console.error(`no place matched "${name}". Nothing was written.`);
  process.exit(1);
}

candidates.forEach((c, i) => {
  console.log(
    `[${i}] ${c.label}${c.context ? ` — ${c.context}` : ''}` +
    `  (${c.kind}, box ${c.bboxSource} from ${c.resolvedBy})`,
  );
});

if (pickRaw === undefined) {
  console.log('\nNothing written. Re-run with --pick <n> to promote one of the above.');
  process.exit(0);
}

const pick = Number(pickRaw);
const chosen = candidates[pick];
if (!chosen) {
  console.error(`--pick ${pickRaw} is not one of the ${candidates.length} candidates above.`);
  process.exit(2);
}

const key = normalise(name);
const source = await readFile(PLACES_FILE, 'utf8');

// Reached through the same rule the table itself obeys: a duplicate key would
// make one of the two rows unreachable, which is a row that silently does not
// exist (places.ts, placesTableProblems).
if (new RegExp(`^\\s{2}${key}:\\s*\\{`, 'm').test(source)) {
  console.error(`"${key}" is already a hand row in places.ts. Edit or delete it there; this tool will not overwrite it.`);
  process.exit(1);
}

const [west, south, east, north] = chosen.bbox;
const note =
  `${chosen.label}${chosen.context ? `, ${chosen.context}` : ''}. ` +
  (chosen.bboxSource === 'upstream'
    ? `Bounding box as published by ${chosen.resolvedBy}`
    : `Box DERIVED around the point ${chosen.resolvedBy} returned, not published`) +
  `; promoted from a resolve on ${new Date().toISOString().slice(0, 10)}. ` +
  'A rectangle, so it contains its neighbours: narrow with a filter clause when the rows carry one.';

const row = `  ${key}: {\n    bbox: [${west}, ${south}, ${east}, ${north}],\n    note: ${JSON.stringify(note)},\n  },\n};`;

// Anchored on the PLACES declaration and then on the FIRST terminator after
// it — not on a line number, which rots on the next edit, and not on the first
// `};` in the file, which would land in whatever declaration happens to come
// first the day somebody adds one above this.
const declares = source.indexOf('export const PLACES');
if (declares === -1) {
  console.error('could not find `export const PLACES` in places.ts; nothing written.');
  process.exit(1);
}
const closes = source.indexOf('\n};', declares);
if (closes === -1) {
  console.error('could not find the end of the PLACES object in places.ts; nothing written.');
  process.exit(1);
}
const updated = source.slice(0, closes) + `\n${row}` + source.slice(closes + '\n};'.length);

await writeFile(PLACES_FILE, updated);

console.log(`\npromoted "${key}" into places.ts`);
console.log(`  bbox: [${west}, ${south}, ${east}, ${north}]  (${chosen.bboxSource})`);
console.log('\nREAD THE DIFF before committing, and run the suite: placesTableProblems() pins');
console.log('every row for a normalised key, a well-formed box and a note that says what it is drawn around.');
