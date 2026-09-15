/**
 * OSIRIS — state that must be ONE thing per process.
 *
 * A module-level `const store = new Map()` is a singleton only while the module
 * is instantiated once. Under Next 16 with Turbopack that assumption is false:
 * `instrumentation.ts` and the route handlers are compiled into SEPARATE module
 * graphs, so a module imported by both is instantiated TWICE and each copy gets
 * its own Map.
 *
 * MEASURED, NOT ASSUMED. The earth server armed and pre-warmed at boot —
 *
 *     [OSIRIS earth] ARMED 3 layers: flights, earthquakes, power_plants
 *     GET /api/power-plants 200 in 1995ms
 *
 * — and GET /api/earth/query, in the same process, answered `armed: false,
 * activeTimers: 0, layers: []`. Both were telling the truth about the copy they
 * could see. The rows existed; the door was looking at the other Map.
 *
 * That failure is silent and it reads like a dead feature: a scheduler that
 * fetched 12MB and a door that reports nothing cached, with no error anywhere.
 *
 * So state whose whole point is being singular is hung off `globalThis` under a
 * `Symbol.for` key, which is per-PROCESS rather than per-module-instance. This
 * is the same shape as the well-worn Next.js database-client-on-global pattern,
 * and it fixes the sibling case too: dev HMR re-instantiates a module on edit,
 * which would otherwise drop every cached row on an unrelated save.
 *
 * WHAT DOES NOT BELONG HERE: anything that is merely convenient to share. A
 * global is a thing two tests can see, so the rule is narrow — only state that
 * is WRONG when duplicated, and each of those still owns its own reset for the
 * pins (resetEarthScheduler, clearSourceCache).
 */

/** One registry for the whole process. Symbol.for, not a bare string key, so a
 *  stray `globalThis.singletons` from anything else cannot collide with it. */
const REGISTRY_KEY = Symbol.for('osiris.process.singletons');

type Registry = Map<string, unknown>;

function registry(): Registry {
  const host = globalThis as unknown as Record<symbol, Registry | undefined>;
  const existing = host[REGISTRY_KEY];
  if (existing) return existing;
  const made: Registry = new Map();
  host[REGISTRY_KEY] = made;
  return made;
}

/**
 * The one instance of `key` for this process, creating it on first ask.
 *
 * `create` runs AT MOST ONCE per process. A second module instance asking for
 * the same key gets the first one's object, which is the entire point.
 */
export function processSingleton<T>(key: string, create: () => T): T {
  const store = registry();
  if (store.has(key)) return store.get(key) as T;
  const made = create();
  store.set(key, made);
  return made;
}

/** Every key taken so far. For the pins and for a human debugging a duplicate. */
export function singletonKeys(): string[] {
  return [...registry().keys()].sort();
}
