# The Globe — building the asking

**Design spec · 2026-09-14 · branch `feat/globe-asking-spine`**

Source document: `GLOBE-BLACKBOX-ADRIAN-day314.md`. Every file:line claim in that
document was re-read against this repo at `29dfb09` before this spec was
written; the corrections are recorded in §0.

> *The fork can already measure, draw, and extract. It cannot be asked. Build the asking.*

## Status

| Step | State |
|---|---|
| 1 Places | **built** — resolve + confirm doors, cache, geosearch carries the bbox |
| 2 `power_plants` | **blocked** on the 313-24 licence read. Not started, deliberately. |
| 3 Measure + draw | **built**, less `drop_pin` — it has no Point render path yet |
| 4 Return path | **built** — `ring` scope on the query door |
| 5 Generic paint | not started — the biggest and riskiest |
| 6 Teach the verb | not started — different repo |
| 7 Filter grammar | not started — and it is two rows, not one |

Suite at the time of writing: **914 passing, 16 skipped, 0 failing** (799 at the
branch point). `tsc --noEmit` silent. Lint unchanged from baseline.

---

## 0. Corrections to the source document

The day-314 black box was measured on a different rig. Three of its statements
do not hold for this clone, and one finding it makes is materially optimistic.

| Claim | Reality at `29dfb09` |
|---|---|
| §5.5 "the fork's local room is dirty" — uncommitted `pr-checks.yml`, untracked `off` | Tree is clean on `master`. `node_modules` is absent; a clean clone needs `npm install` (npm, not pnpm — `package-lock.json`). **The untracked `off` is not mess — it is a bug, and it is fixed on this branch.** See §0.1. |
| §3 `fly_to` "refuses anything but finite coordinates" | It also range-checks: `abs(lat) <= 90`, `abs(lng) <= 180`, and `zoom` within `0..24` when sent. `control-door.ts:302-321`. |
| §5.1 "there is no geocoder" | There is one: `src/app/api/geosearch/route.ts`, merging Photon and Nominatim. The control door refuses to call it for a *stated* reason — `maxDuration = 20`, a 20-second worst case on a verb path. The gap is not the absence of a geocoder; it is that nothing may call it synchronously. |
| §4.3 / §6.3 the draw-measure-select verbs are "exposing them, not writing them" | True for **measure**. False for **select**. See below. |

### 0.1 The `off` file is a bug, not mess

`cctv-snapshot.ts:44` treats `OSIRIS_CCTV_SNAPSHOT='off'` as a sentinel meaning
*this run touches no disk at all*, and says so in a comment: real disk I/O
cannot be flushed deterministically under fake timers. `readSnapshot` kept that
promise. `writeSnapshot` did not — it passed the same variable to
`snapshotPath()`, got the literal string `'off'` back as a relative filename,
and wrote the entire camera catalogue to a file called `off` in the repo root.

`api/cctv/route.test.ts` triggers it, so **every full test run dirtied the
working tree**, on any rig. The day-314 document found the file, read it as
housekeeping, and told the next person to delete it — which would have worked
until the next `npm test`.

Fixed on this branch: `snapshotsDisabled()` is asked by both ends, and pinned by
a test that switches snapshots off, writes, and asserts no such file appears.
A switch kept by one half of a pair is worse than one kept by neither — it
reads as isolation while the isolation is not there.

### The select finding

`selectInPolygon(ring, data)` (`aoi.ts:132`) sweeps `data: Record<string, any>`,
and `AOI_LAYERS` (`aoi.ts:61`) keys it by `commercial_flights`, `private_jets`,
`satellites`, `cameras`, `maritime_ships` and seven more. That is **page.tsx's
browser-side live store**. The earth server holds two layers, as `EarthItem`s,
in a different shape entirely.

So "extract everything inside this shape" has two possible homes returning two
different universes of data, and §6 step 3 does not pick one.

**Decision: server-side, over `EarthItem`s.** Rows come back through the query
door with provenance attached, which is what keeps the §2 Job-4 return path
intact. The cost is that a sweep only reaches layers that have a fetcher — two
today — and breadth therefore rides on step 2 and on every fetcher after it.
The alternative, posting a select verb into the page and carrying an `AoiReport`
back on the ack, was rejected: it would make the control door answer *what is
there*, which §7 freezes as the query door's job.

---

## 1. The shape of it

Three doors. Each keeps one job and never learns another's.

```
brain ──resolve──> candidates, with context      NEW. slow, deliberate, writes nothing
      ──query────> rows + provenance             existing. synchronous, never fetches
      ──control──> acks: what changed            existing. postMessage, 4 verbs -> 7
```

The rule that decides where anything new lands: **control performs, query
knows.** A verb that would do both is wrong and goes on the other door instead.

`resolve` is a third thing because it does neither. It answers "what could this
name mean?" — a question whose answer is a *choice*, not a fact, and the choice
belongs to the brain.

---

## 2. Step 1 — Places

**Card: 313-23b.** 313-54 in the earlier globe document names the same work and
is retired as a duplicate id.

### What changes

**Built**, with three changes from the draft — recorded below the table.

| File | Change |
|---|---|
| `src/lib/earth/places.ts` | `resolvePlace` reads `PLACES ∪ cache`. Synchronous, exact, unchanged in every way that matters. Holds the cache itself. |
| `src/lib/earth/geocode.ts` | NEW. A geosearch hit → a `PlaceCandidate`, and the point→box rules. |
| `src/app/api/earth/resolve/route.ts` | NEW. Offers candidates. Writes nothing. |
| `src/app/api/earth/resolve/confirm/route.ts` | NEW. Writes the one the caller chose. |
| `src/app/api/geosearch/route.ts` | Carries the bbox both providers already send. |

**What changed from the draft:**

- **The cache lives in `places.ts`, not a `place-cache.ts`.** A separate module
  would have needed `normalisePlace` and `bboxProblems` from `places.ts` while
  `places.ts` needed the cache back — a circular import for no gain. What *did*
  earn its own file is the derivation side (`geocode.ts`), which imports
  `places.ts` and is imported by nothing in it.
- **`api/geosearch` had to be extended first.** The draft assumed the bbox would
  be available; it was not. `GeoResult` carried a point, and Photon's `extent`
  and Nominatim's `boundingbox` were both parsed and discarded. Fanning out to
  Photon a second time would have violated Law 19, so geosearch now carries the
  box it already receives — additive, optional, existing consumers untouched.
- **`confirm` refuses `hand_written` (409)** when a name is already in `PLACES`.
  The draft let the write land harmlessly, since `resolvePlace` prefers the hand
  table. But that is a success ack for a write that changed nothing, which is
  the quiet lie this repo keeps refusing. It says so instead.
- **`tools/promote-place.mjs` is not built.** Promoting a cached row to a
  reviewed hand row is still the right escape hatch for anything demo-critical,
  but nothing needs it until a demo depends on a resolved place. Its own row.

`planQuery` is untouched. `resolvePlace` keeps its signature, keeps returning
`PlaceLookup`, and keeps refusing by name. The only thing that changes is the
size of the table it looks in.

### Why the resolve door is separate

`places.ts:70-74` argues, in writing, that fuzzy matching is untestable: there
is no way to prove "it never guessed wrong" against an open-ended input space.
Photon is *explicitly* a fuzzy index — `geosearch/route.ts:11-13` advertises
that it resolves `sydny opera house`. Wiring it behind `resolvePlace` would
make "Springfield" silently become one of forty Springfields, which is the
exact failure `places.ts:19` exists to prevent.

Moving the call to its own door does not soften that standard; it moves the
choice up to the only party that can reason about context. A refusal still
beats a guess. A brain choosing between "Paris, Île-de-France, France" and
"Paris, Texas, United States" is neither.

### The contract

`POST /api/earth/resolve` — behind `NEXT_PUBLIC_EARTH_SERVER`, naming its
caller via `x-osiris-user`, exactly as the query door does.

```ts
// request
{ name: string, limit?: number }

// answer
{
  ok: true,
  name: string,                 // as sent
  candidates: PlaceCandidate[], // ranked, never one, never auto-chosen
}

interface PlaceCandidate {
  key: string;          // the normalised key a confirm would write
  label: string;        // "Paris"
  context: string;      // "Île-de-France, France" — what disambiguates
  bbox: Bbox;
  bboxSource: 'upstream' | 'derived';
  kind: string;         // the upstream's own type string
  resolvedBy: 'photon' | 'nominatim';
}
```

This route **writes nothing.** `POST /api/earth/resolve/confirm` takes
`{ name, candidate }` and writes one cache row keyed by `normalisePlace(name)`.
Two calls, because a resolve that wrote on its own would be a geocoder with
extra steps.

### Point to box

Geosearch returns a point. `PLACES` stores a box, because "flights over Paris"
needs an area and not a dot (`places.ts:37-43`).

The rule, stated in `place-cache.ts` at the definition site:

1. **Upstream extent wins, verbatim.** Photon returns `properties.extent`
   (`[west, north, east, south]` — note the order differs from GeoJSON bbox and
   must be reordered, not assumed). Nominatim returns `boundingbox`
   (`[south, north, west, east]`, as *strings*). Both are real boxes on
   administrative hits — countries, regions, cities — which is Poland, the
   United States and the Canary Islands solved from the publisher's own data
   rather than from a rule this repo invented. Row records `bboxSource: 'upstream'`.
2. **Otherwise, a radius by `kind`**, from a small table written out in prose in
   the file, converted to a box with `geo.ts`'s `destination()` so the box is a
   true geodesic extent rather than a naive degree offset. Row records
   `bboxSource: 'derived'`.

A caller can always tell which it got. A derived box for a landmark is honest;
a derived box silently presented as an administrative boundary would not be.

### Lifetime

The cache is memory, and dies with the server. That is not a compromise
smuggled in — it is the same swap point THE-GATE rule 2 already names for
`sourceCache` (`api/earth/query/route.ts:22-25`), stated here rather than
invented. Everything in it is re-resolvable from a public upstream.

`tools/promote-place.mjs` writes a chosen row into `PLACES` as an ordinary hand
row with its note, so anything demo-critical stops depending on an upstream
being reachable at demo time.

### Refusals

`place_unknown` stays the only refusal, and stays the same word. Its detail
gains one sentence naming the resolve door. A second refusal was considered and
dropped: `resolvePlace` cannot tell "no such place anywhere on earth" from
"never resolved here" without making the network call it exists to avoid, so a
refusal claiming to distinguish them would be asserting something it did not
check.

### Done when

- `resolvePlace('poland')` returns a box after one resolve+confirm, and refuses
  before it, with both paths pinned.
- A prototype-pollution key (`constructor`, `__proto__`) still misses through
  the cache as well as through `PLACES` — `places.ts:93-100` found this once and
  the cache must not reintroduce it.
- The Photon and Nominatim extent orderings are each pinned against a recorded
  upstream payload, both ways round. Getting one of these backwards produces a
  box that is wrong but plausible, which is the failure mode this repo refuses.
- No synchronous path to the network exists from `planQuery`. Pinned by the
  types: `resolvePlace` is not `async`.

---

## 3. Step 2 — `power_plants`, end to end

**Blocking prerequisite, its own row (313-24):** `source-catalog.ts:46` records
the GEM licence as `NOT READ`, and says so deliberately. No data lands until it
is read. If GEM's terms do not permit this use, WRI GPPD is the named fallback
and needs the same read. This spec does not assume the outcome.

### The registry mismatch

`EARTH_LAYERS` is built for polled feeds: `intervalMs`, `ttlMs`, and
`timeoutMs < intervalMs` enforced by `registryProblems` (`registry.ts:250`).
GEM publishes on a **release schedule**, not a feed (`source-catalog.ts:45`).

**Decision: no new concept.** The row takes `intervalMs: 24h` with a matching
`ttlMs`, which satisfies every rule the registry already enforces and costs one
redundant fetch a day. Adding a `static` layer kind would earn a second code
path through the scheduler for a single row, and `registryProblems` would stop
meaning what it means today.

### What changes

| File | Change |
|---|---|
| `src/lib/layers-catalog.ts` | `power_plants` row arrives, status `live`, licence recorded verbatim from the read. |
| `src/lib/source-catalog.ts` | `power_plants` row leaves. Two lifecycles, two files — the row has graduated. |
| `src/lib/earth/registry.ts` | `fetchPowerPlants`, `AbortSignal` passed through, row in `EARTH_LAYERS`. |

`PRE_WARM` is left alone: a daily dataset does not need warming to answer a demo
in five seconds.

Moving the row into `layers-catalog.ts` is what makes the control door accept
`power_plants` as vocabulary, since §7 freezes the catalogue as the door's live
vocabulary rather than a copy of it.

### Done when

- `layers-catalog.test.ts` stays green — the row is set-equal to the app's boot
  vocabulary, or the test names the id that was missed.
- `registryProblems()` returns `[]` with the new row present.
- A query for `power_plants` with no place returns rows with the licence string
  read verbatim off the catalogue row.
- The fetcher's abort is pinned: an aborted signal stops the request, not just
  our waiting on it (`registry.ts:71-76`).

---

## 4. Step 3 — Measure and draw

Two halves, two doors, on purpose.

### Measuring is knowing → the query side

`POST /api/earth/measure`, beside the query door, behind the same flag, naming
its caller by the same header.

```ts
// request
{ path: [[lng, lat], ...] }   // two points or many; GeoJSON axis order

// answer
{
  ok: true,
  points: number,             // what was measured, so a caller can check
  km: number,
  formatted: string,          // formatDistance(), verbatim
  bearing: number,            // the course it LEAVES on = legs[0].bearing
  compass: string,            // compassPoint(), verbatim
  legs: { km: number, bearing: number }[],
  accuracyNote: string,       // the ~0.5% said out loud, on every answer
}
```

**Built. `src/lib/earth/measure.ts`, `src/app/api/earth/measure/route.ts`, 35 tests.**
Two things changed from the draft above during implementation:

- `bearing` and `compass` are **not nullable**. The draft hedged for a path with
  no legs, but `pathProblems` refuses anything under two points, so there is
  always at least one leg and the nullable type described a state that cannot
  exist. A type that admits an impossible value is a type every caller has to
  write dead code against.
- `accuracyNote` was added. `geo.ts:1-14` states the ~0.5% spherical-versus-WGS84
  cost; leaving it one file away from the number it applies to meant a consumer
  drawing conclusions from a distance would never see it.
- `USER_HEADER` moved from `api/earth/query/route.ts` to `earth/settings.ts` and
  is re-exported from its old home. Two doors now read it, and one rule with two
  spellings is how they drift (Law 15). No importer moved.

Every number comes from `geo.ts` — `haversine`, `pathLength`, `bearing`,
`compassPoint`, `formatDistance`. **Nothing new is computed.** This module is an
adapter over tested code, and the tests say so by exercising the door against
the same fixtures `geo.test.ts` already uses.

The `~0.5%` spherical-versus-WGS84 cost that `geo.ts:1-14` states out loud is
carried into the answer's documentation rather than silently dropped. A consumer
putting a number on screen should know its accuracy.

### Drawing is performing → the control door

**Built: `draw_shape` and `clear_shapes`, verbs 5 and 6, wired at both ends.**

```ts
type ControlVerb =
  | 'set_layers' | 'fly_to' | 'set_projection' | 'open_camera'
  | 'draw_shape' | 'clear_shapes';
```

**`drop_pin` is deferred to its own row, and is not in this work.** A pin is a
Point; the drawn-shape renderer at `OsirisMap.tsx:2408` handles `Polygon` and
`LineString` only, and `drawnPolygons` is typed to match. Shipping the verb
without a Point render path would arm a sender with no receiver — the exact
half-arming §8 forbids. It needs a branch in that effect, which is a change to
the 2,805-line file and deserves its own review.

**`clear_shapes` takes no argument.** Clearing one shape needs the door to know
the ids the React side generates, which is a `DoorContext` field it does not
have and a fact the verb could then report back. That is a separate row rather
than a quiet option here, and it is why the draft's `unknown_shape` refusal was
not built.

**One refactor fell out of it.** `toDrawResult` was extracted from the draw
reducer's private `complete()`, because a circle is *defined* by centre + rim
but *stored* as a 64-vertex ring with its radius in `meta`. A verb that built
its own `DrawResult` would have put a two-point "polygon" on the map. Both
paths now go through the one function, which is the only reason a brain-drawn
shape and a hand-drawn one are the same object downstream.

`draw_shape` takes canonical GeoJSON — the same shape `draw.ts:137-139`
produces, so a drawn shape and a brain-sent one are indistinguishable
downstream. It validates through `shapeProblems()`, a problems-in-words
function pinned against geometries built to break it, exactly as
`bboxProblems` and `registryProblems` are. A vertex cap is enforced, because
the queue bounds verbs and nothing currently bounds one verb's payload.

Acks say **what changed** — `{ shapeId }` — and never what is inside the shape.
That is the §7 rule, and it is the whole reason measuring went on the other door.

New refusals: `invalid_geometry`, `unknown_shape`.

### The Hong Kong demo

Three calls the brain orchestrates:

```
fly_to     -> the camera arrives
draw_shape -> the line appears between the two points
measure    -> the number comes back, and the brain can say it
```

Each door does its own job. Neither learns the other's.

### Done when

- `planVerb` refuses a malformed geometry by name, pinned per rule in
  `shapeProblems`.
- The measure door answers Hong Kong → mainland China with a number that matches
  a hand-computed haversine to the digit.
- Queue coalescing is checked for the new verbs: `fly_to` coalesces because a
  fly is a 2000ms animation (`control-door.ts:385-389`); `draw_shape` must
  **not**, since two shapes are two shapes.

---

## 5. Step 4 — The return path

**Built.** `src/lib/earth/select.ts` — `selectEarthItems(ring, items)`.

One change from the draft: the two-scope refusal now **names which two scopes
were sent** rather than repeating a fixed sentence. With three scopes a caller
that sent two needs to know which two, and the old message could not say.

Deliberately **not** in `aoi.ts`. That file sweeps the browser's eleven-layer
live store and keeps doing exactly that; the two functions answer the same
question over different universes and merging them would make one of the two
lie about what it covers.

It imports `pointInPolygon` (`aoi.ts:94`) and `bboxOf` (`aoi.ts:106`) rather
than reimplementing them — including the cheap bbox rejection that makes the
sweep cheap enough to sit in a render path, and the vertex-crossing rule that
keeps a point on the boundary stable instead of flickering. This step really is
exposing tested code.

The query door gains a `ring` scope, mutually exclusive with `place` and
`bbox`. `query.ts:216-218` already refuses two scopes with *"Two scopes cannot
both be the answer"*; the rule extends to three and the message widens.

**No new response type.** Rows return through the existing `EarthAnswer`, with
`matched` (the count before the limit), `limitClamped`, and verbatim provenance
all intact. The brain already knows how to read that shape, and a second answer
shape would be a second thing to keep honest.

### Done when

- A ring over Paris and the `paris` bbox return the same flights, to the row.
- `matched` still reports the count *before* the clamp when a ring holds more
  than 50 — the honest-door property `query.ts:114-118` exists for.
- Sending `ring` with either `place` or `bbox` refuses `malformed` and names
  both scopes it was given.

---

## 6. Step 5 — The generic paint path

§5.3 of the black box, never carded, and the single highest-leverage item on
the list: it is what makes every future layer cheap.

The pipeline is generic; the **drawing** is not. `page.tsx` (1,823 lines)
hand-wires fetch-on-toggle per layer in an if-chain, and `OsirisMap.tsx` (2,805
lines) hand-writes `map.addLayer({...})` per layer with its own paint.

### Approach

Catalogue rows gain an optional `paint` spec. `OsirisMap` gets one `addLayer`
loop driven by it. `page.tsx`'s if-chain gets a generic branch keyed by the
catalogue.

**Built alongside the hand-wired path, migrated one layer at a time, and the
hand-wired branch deleted only when the last layer has moved.** These are the
two largest files in the repo and a big-bang rewrite of either is how a globe
row stops shipping.

A pin asserts every live catalogue row has either a paint spec or a named,
explicit exemption — so "which layers are still hand-wired" is a test output
rather than something a person has to go and count.

### Done when

- A new layer needs a catalogue row and a fetcher, and nothing else.
- The exemption list is empty, or every entry on it says why in words.

---

## 7. Step 6 — Teach the verb (313-77)

Lives in `Agencer-Inc/agencer`, not this repo. The `canvas_globe` producer is
built (313-21 leg two); the verb is taught to none of the three grammars the
brain picks verbs from, and those are three separate hard-coded literals.

That leg **pinned** the real literal rather than restating it, so whoever
teaches the verb goes red there first and knows exactly what they are changing.
That is deliberate and must not be "fixed".

No dependency on steps 1–5. Until this row is built, nothing typed moves the
globe at all.

---

## 8. Step 7 — The filter grammar

`matchesFilter` (`query.ts:156`) reads `kind` and `label` only. `EarthItem`
carries a `props` bag and the filter ignores it completely, so every "which ones
are X" question is unanswerable no matter how it is worded.

### Additive, not a replacement

Bare-string filters keep working exactly as they do — `query.test.ts` pins that
behaviour and it stays green. Structured filters arrive beside them:

```ts
filter: string                                   // unchanged, substring over kind+label
filter: { field: string, op: Op, value: unknown }[]   // new, reaches into props

type Op = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'exists';
```

An unknown `op` is `malformed` — a caller who typo'd an operator gets told.
A field an item lacks simply does not match, and is not an error: absence is a
normal fact about a heterogeneous feed, and refusing on it would make one odd
row break a whole query.

### The prerequisite the black box missed

"All inbound flights to the United States" needs `destination` and `phase` in
props. `fetchFlights` (`registry.ts:156`) carries `altitudeM`, `speedKnots`,
`model` and `grounded` — and whether `/api/flights` exposes a destination at all
has not been checked.

**So this is two rows, not one:** a grammar row, and a data row whose
feasibility is unknown until that route is read. The grammar row ships on its
own and is useful on its own; the inbound-flights demo is not promised until the
data row is answered.

---

## 9. Dependencies and order

| Step | Depends on |
|---|---|
| 1 Places | nothing |
| 2 `power_plants` | the 313-24 licence read |
| 3 Measure + draw | nothing |
| 4 Return path | nothing to build; interesting once 2 adds layers to sweep |
| 5 Generic paint | nothing |
| 6 Teach the verb | nothing (different repo) |
| 7 Filter grammar | a data question against `/api/flights` |

**Build order: 3 → 1 → 4 → 2 → 5 → 7 → 6.**

Step 3 first because it is the best demo in the list and the maths is already
written and tested — it is an adapter, not an implementation. Then places,
because it unblocks four of fg's six worked examples at once. Then the return
path, which is small and makes the query door answer the question the whole
document is about. `power_plants` follows its licence read whenever that lands.

---

## 10. What this spec does not change

Frozen by §7 of the black box, and by tests that exist to stop it:

- The catalogue **is** the door's vocabulary. No parser over `page.tsx`.
- `cadence` is prose and is never regex'd.
- "Cold" is read from the scheduler's record, never from whether the cache
  happens to have rows.
- Licence, source and cadence are read **verbatim**. Never inferred, never
  defaulted.
- A validator returns problems **in words** and is itself pinned against rows
  built to break it.
- An empty refresh keeps the old rows.
- A fetch that times out is aborted, not abandoned.
- Everything ships dark behind a flag with a witnessable armed state.
- A refusal by name always beats a guess that looks right.

`.env` lines are fg's hand. Nothing here writes one.
