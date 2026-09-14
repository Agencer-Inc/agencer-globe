# GATE LINES — the earth server (313-23)

Drafted for the seat to file into `THE-GATE.md` (agencer-brain). THE-GATE.md is
not in this repo, so nothing here edits it. This file is the durable copy: the
PR body carries the same text, and a PR body is not an artifact a later leg can
reliably read back (Law 29).

Everything below describes code that landed in this repo on branch
`313-23-earth-server`, with file:line. Nothing here is aspirational.

---

## 3.6 — Server shape

**No new port.** The earth server is not a service. It is a module tree
(`src/lib/earth/`) plus one route (`src/app/api/earth/query/route.ts`) inside
the fork's existing Next app, sharing its port, its process and its deploy. No
Dockerfile, deploy.sh or nginx file was touched; infra is not this leg's.

**Two processes' worth of behaviour, one process.**

| Part | Where | What it is |
|---|---|---|
| scheduler | `src/lib/earth/scheduler.ts` | `setInterval` per live layer, in the Next node runtime |
| cache | `src/lib/sourceCache.ts` (reused) | in-memory `Map`, TTL per entry, 500-key cap |
| query door | `src/app/api/earth/query/route.ts` | `POST`, answers from cache, never fetches |
| registry | `src/lib/earth/registry.ts` | which layers are fetched, how often, with what timeout |

**Arming.** The scheduler starts from Next's `register()` hook
(`src/instrumentation.ts`), once per server process, and only when
`NEXT_PUBLIC_EARTH_SERVER=1`. Unset, it creates no timer, no record and no
cache entry, and calls no upstream.

**Egress.** Two upstreams today, both already reached by this app before this
leg: the USGS earthquake feed (url read from the catalogue row, never retyped)
and this app's own `/api/flights` route.

That second one defaults to `http://127.0.0.1:3000` and is **overridable** by
`EARTH_SELF_ORIGIN`, so it is an operator-controlled egress destination rather
than a hard loopback guarantee. Nothing validates the value. Unset, it is
loopback; set, it is wherever it points. The seat should know that before
signing the egress line, and whatever it is set to in the deployed environment
is not something this repo can state.

---

## 3.5 — Metric names

These are the names the code emits **today**, readable without authentication
at `GET /api/earth/query` while armed. They are per-layer and they are counters
and timestamps, not gauges derived after the fact.

| Name | Type | Source | Meaning |
|---|---|---|---|
| `layers[].layer` | string | `scheduler.ts` LayerRecord | catalogue layer id |
| `layers[].cold` | bool | `!everFetched` | has never completed a fetch |
| `layers[].rowCount` | int | last completed fetch | rows held. Zero is a real warm answer |
| `layers[].fetchedAt` | epoch ms | last completed fetch | when THIS SERVER retrieved what it holds. Not when the event was observed: nothing here can see that |
| `layers[].lastError` | string or null | last attempt | null means the last attempt succeeded |
| `armed` | bool | `activeTimerCount() > 0` | read from the scheduler, not from the flag |
| `layers[].attempts` | counter | per process | fetch cycles started |
| `layers[].skippedTicks` | counter | per process | ticks dropped because a fetch was still running |
| `unservedLiveLayers[]` | string[] | computed from the catalogue | live layers with no fetcher here |
| `sdkLayers[]` | string[] | the ingest store | our own trove, as `sdk_` layers |
| `maxLimit` | int | `query.ts` | the query ceiling, 50 |

**`skippedTicks` is the one to alert on.** A number that climbs means an
upstream is consistently slower than its own cadence, which is invisible in
every other metric here: the layer keeps answering warm off older data and
nothing else goes red.

**What is NOT measured, said plainly.** There is no latency histogram, no
per-fetch duration and no egress byte count. The catalogue's `status` field is
a reading of the code and not a health check (`layers-catalog.ts:99-104`), and
this server does not upgrade it into one. A consumer that needs real
availability has to measure it (Law 3).

**Nor is observation age.** `ageSeconds` is how long ago this server retrieved
what it holds. An aircraft position is already some seconds old when the
upstream hands it over, and nothing in this diff can see that gap. For push-fed
`sdk_` layers `ageSeconds` is **null**, not zero: the entities carry their own
timestamps from whoever pushed them and this server never polls, so zero would
assert a measurement that was never taken.

---

## Rule 4 — Timed fetchers take the lock when deployed

**This leg creates timed fetchers and does NOT install a lock, because the lock
is infra and infra is not ours.** Stating the obligation rather than silently
inheriting it.

`src/lib/earth/scheduler.ts` creates one `setInterval` per live registry row,
per server process. Two facts follow:

1. **Per process, not per deployment.** Run the image twice and both copies
   poll. The current registry is 2 layers at 5 and 15 minutes, so two replicas
   is 2x that and not a stampede, but it is duplicated egress against USGS and
   against this app's own `/api/flights`, which carries a metered OpenSky
   credential budget (`api/flights/route.ts:222-237`). A second replica halves
   that budget's headroom.

2. **The lock belongs at deploy, not in this module.** Whoever holds rig state
   takes the rule 4 lock before a replica with `NEXT_PUBLIC_EARTH_SERVER=1`
   starts. The in-process guarantee this code makes is narrower, and it is
   stated exactly because an earlier draft of this document overclaimed it:

   - A tick that lands while a fetch is running is skipped and counted in
     `skippedTicks`. Pinned.
   - A fetch that exceeds `timeoutMs` is **aborted**, not merely abandoned.
     `Promise.race` on its own stops the scheduler waiting while the request
     keeps running into the next tick, which is the overlap `inFlight` cannot
     see. `tickLayer` passes an `AbortSignal` to every fetcher and aborts it.
     Pinned by a fetcher that only settles when its signal fires.
   - `fetchFlights` passes that signal to `fetch`, so the request really is
     cancelled. `fetchEarthquakes` calls `httpJson`, which wraps `node:https`
     and takes no signal; it is bounded instead by its own 20s timeout, which
     is shorter than that layer's 30s, so the request cannot outlive the race
     there either. The signal is still checked before it opens a connection.

**Scoping the flag to exactly one replica is the cheap version of the lock**,
and it is what the arming line below assumes.

---

## Rule 2 — The cache is memory, with a stated TTL

**Not local-disk-only. Not disk at all.**

`src/lib/sourceCache.ts` is a module-scope `Map` (`sourceCache.ts:24`), capped
at 500 keys (`:33`), with a TTL per entry and eviction that never drops a
request in flight (`:35-43`). The earth server writes under `earth:<layerId>`
keys and is the only writer of those keys.

**It dies with the server, and that is harmless.** Every row in it is
re-fetchable from a public upstream within one cadence, so a restart costs at
most one interval of staleness and never loses anything that cannot be got
again. Nothing is persisted, so nothing has to be migrated, encrypted at rest,
or deleted on request.

**TTL, stated:** `flights` 60s, `earthquakes` 20 minutes
(`src/lib/earth/registry.ts`, per-row). Past its TTL a layer still answers, and
the answer says `stale: true` with `ageSeconds`.

**The named swap point:** `seedSource` / `peekSource` in
`src/lib/sourceCache.ts:103-127`. Those two functions are the entire storage
surface the earth server touches. Swapping memory for Redis or Postgres is
reimplementing that pair; no caller changes.

---

## Rule 3 — The door names its caller

`POST /api/earth/query` requires a user id, from the `x-osiris-user` header or
a `userId` body field, header winning. Anonymous is refused **by name**
(`refusal: "anonymous"`, HTTP 401) and the check runs before any other
validation, so a stranger cannot learn which layers exist from the shape of the
refusals. Pinned in `query.test.ts` and `route.test.ts`.

No prior user-identification convention existed in this app. This leg names one
rather than leaving it implicit; if the seat has a different one, this is the
single place it changes.

---

## Bounds on the query door

- Every answer is capped at **50 rows** (`MAX_LIMIT`, `src/lib/earth/query.ts`).
  A caller asking for 500 gets 50 and `limitClamped: true`, plus `matched` so
  it knows what it did not see. It is never silently truncated.
- The default when no limit is named is 25.
- The door **never fetches**. It filters arrays already in memory. A cold layer
  is answered as cold immediately rather than making the caller wait to find
  out.
- A place must be in a hand-written table of 5 names, or it is refused as
  `place_unknown`. There is no geocoder and no fuzzy matching.
- `GET /api/earth/query` reports holdings only: counts, timestamps and errors,
  never rows.

---

## The arming line

```
NEXT_PUBLIC_EARTH_SERVER=1
```

- **Scoped to:** exactly one replica of the fork's Next app, per rule 4 above.
- **Rides:** the next restart that absorbs this commit. Merged and dark is not
  delivered (Law 32).
- **Witness that it took:** the server logs `[OSIRIS earth] ARMED 2 layers:
  flights, earthquakes` once at start-up, and `GET /api/earth/query` answers
  200 instead of 503.
- **Reverse:** unset the variable and restart. Nothing persists.
