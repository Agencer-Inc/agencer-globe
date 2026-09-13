/**
 * OSIRIS — the remote-control door.
 *
 * A parent web app drives this globe without a reload by posting messages at
 * the window. Four verbs: set layers, fly to a coordinate, set the projection,
 * open a camera. Every accepted verb answers with an ack naming what changed;
 * every rejected one answers with a refusal named in words.
 *
 * The door is shut unless BOTH hold:
 *   1. the page URL carries the control flag  (?control=1)
 *   2. the sender's origin is on the allowlist (NEXT_PUBLIC_CONTROL_ORIGINS)
 *
 * Nothing here touches React or the DOM except installControlDoor, and nothing
 * here imports from next/server or node:*. The module is isomorphic on purpose:
 * next.config.ts reads the same allowlist to build the CSP frame-ancestors
 * header, so the browser's framing policy and this origin check are always the
 * same list.
 *
 *      parent (allowlisted origin)
 *            |  postMessage {v, id, verb, ...}
 *            v
 *      installControlDoor  --- origin not allowed? --> refuse, DO NOT reply
 *            |                  (never ack a stranger: the page also hosts
 *            |                   third-party camera iframes that post at us)
 *            v
 *      planVerb (pure)  --> refuse(reason, detail)  --> ack back to parent
 *            |
 *            +--> Command --> ControlQueue --> applyCommand (the React side)
 *                                                    |
 *                                                    v
 *                                              ack: what changed
 *
 * @see LayerPanel.tsx for the layer vocabulary this validates against.
 */

/** URL query flag that arms the door. Absent -> no listener is ever installed. */
export const CONTROL_FLAG = 'control';

/** Bumped when the wire shape changes. The parent sends it; we refuse mismatches. */
export const PROTOCOL = 1;

/**
 * Written for the Mac rig, which serves the parent on localhost. Named here
 * rather than left implicit because a default written for the first consumer
 * becomes a landmine for the second (Law 6).
 */
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/**
 * A flood cannot starve the map. Verbs beyond this are refused by name rather
 * than silently dropped, so a parent that overruns learns that it did.
 */
export const MAX_QUEUE = 32;

/**
 * Mirrors the `requires` keys in LayerPanel.tsx:135-136. Duplicated rather than
 * imported because that file exports only its memoized component, and this
 * leg's blast radius forbids editing the layer panel to widen its exports.
 * If a third gated layer appears, both places move.
 */
export const LAYER_REQUIREMENTS: Readonly<Record<string, string>> = {
  cf_outages: 'cloudflare',
  cf_attacks: 'cloudflare',
};

export type Projection = 'globe' | 'mercator';

export type ControlVerb = 'set_layers' | 'fly_to' | 'set_projection' | 'open_camera';

export type RefusalReason =
  | 'origin_not_allowed'
  | 'bad_protocol'
  | 'malformed'
  | 'unknown_verb'
  | 'unknown_layer'
  | 'layer_unavailable'
  | 'invalid_coordinates'
  | 'invalid_projection'
  | 'unknown_camera'
  | 'camera_catalogue_not_ready'
  | 'queue_overflow';

export type Ack =
  | {
      v: typeof PROTOCOL;
      ok: true;
      id: string | null;
      verb: ControlVerb;
      /** What actually changed, in the app's own vocabulary. */
      changed: Record<string, unknown>;
    }
  | {
      v: typeof PROTOCOL;
      ok: false;
      id: string | null;
      verb: ControlVerb | null;
      refused: RefusalReason;
      /** Names the offending value, so the caller does not have to guess. */
      detail: string;
    };

export type Command =
  | { verb: 'set_layers'; on: string[]; off: string[] }
  | { verb: 'fly_to'; lat: number; lng: number; zoom?: number }
  | { verb: 'set_projection'; projection: Projection; clearTerrain: boolean }
  | { verb: 'open_camera'; cameraId: string };

/** The live state planVerb needs to decide. Read at call time, never closed over. */
export interface DoorContext {
  /** Every layer id the app actually has. Supplied by the caller so this module
   *  never freezes a catalogue that the app is free to grow (Law 26). */
  knownLayerIds: readonly string[];
  /** Which server-side capabilities this deployment proved it has. */
  capabilities: Readonly<Record<string, boolean>>;
  /** Camera ids currently loaded. `null` means the catalogue has not arrived —
   *  which is NOT the same as a camera being unknown, and must not be reported
   *  as one. The catalogue loads progressively with backoff and only when the
   *  cctv layer is on, so `null` is the normal state early in a session. */
  cameraIds: ReadonlySet<string> | null;
}

export type Decision =
  /** Not for us, or not from anyone we answer. No state change, no reply. */
  | { outcome: 'ignore'; ack: Ack | null }
  | { outcome: 'refuse'; ack: Ack; deliverAck: boolean }
  | { outcome: 'apply'; command: Command; ack: Ack };

/**
 * True when the page URL carries the control flag.
 *
 * PRESENCE, not truthiness. This used to treat `?control=0` and `?control=false`
 * as shut, which half-armed the system: next.config.ts matches the flag with
 * Next's `has: [{ type: 'query' }]`, which can only test that a parameter is
 * PRESENT. So `?control=0` opened the framing exception while leaving the
 * listener uninstalled — the header policy and the door disagreeing about what
 * armed means. One rule, testable the same way in both places, beats a
 * friendlier-looking flag (Law 32: flags flipped together must fail the same
 * way, or they half-arm).
 */
export function isDoorOpen(search: string): boolean {
  return new URLSearchParams(search).has(CONTROL_FLAG);
}

/**
 * Exactly `scheme://host[:port]` and nothing else. The round-trip comparison is
 * what does the work: anything carrying a path, a trailing slash, whitespace or
 * a `;` fails to reproduce itself and is dropped.
 */
function isWellFormedOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return `${url.protocol}//${url.host}` === value;
  } catch {
    return false;
  }
}

/**
 * Splits the configured allowlist; falls back to the localhost default only
 * when nothing was configured at all.
 *
 * Entries are validated because next.config.ts interpolates this list straight
 * into a Content-Security-Policy string. An entry containing `;` would close
 * frame-ancestors and append a directive of its own, so a typo in an env var
 * could quietly rewrite the page's security policy.
 *
 * A configured-but-entirely-invalid list returns EMPTY rather than falling back
 * to localhost. Falling back would be a quiet failure that leaves the door open
 * to an origin the operator never named; empty fails closed and visibly, which
 * is what an operator-armed switch owes you (Law 5).
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  const listed = (raw ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  if (!listed.length) return [...DEFAULT_ALLOWED_ORIGINS];
  return listed.filter(isWellFormedOrigin);
}

export function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  // Exact match only. A prefix or suffix test would let app.example.test.evil
  // .test through, which is the whole reason an allowlist exists.
  return allowed.includes(origin);
}

function refusal(
  id: string | null,
  verb: ControlVerb | null,
  refused: RefusalReason,
  detail: string,
): Extract<Ack, { ok: false }> {
  return { v: PROTOCOL, ok: false, id, verb, refused, detail };
}

const VERBS: readonly string[] = ['set_layers', 'fly_to', 'set_projection', 'open_camera'];

const isVerb = (value: string): value is ControlVerb => VERBS.includes(value);

/** Every entry must be a string naming a layer this build actually has. */
function badLayerId(ids: unknown, known: readonly string[]): string | null {
  if (!Array.isArray(ids)) return null;
  for (const id of ids) {
    if (typeof id !== 'string' || !known.includes(id)) return String(id);
  }
  return null;
}

const asIdList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * The verb table. Pure: same inputs, same decision, no side effects.
 * `trusted` says the origin check already passed.
 */
export function planVerb(raw: unknown, trusted: boolean, ctx: DoorContext): Decision {
  // Shape first, and silently. This page hosts third-party camera iframes and
  // an analytics script, all of which post at this window; none of it is ours
  // and none of it deserves a reply.
  if (typeof raw !== 'object' || raw === null) return { outcome: 'ignore', ack: null };
  const message = raw as Record<string, unknown>;
  if (typeof message.verb !== 'string') return { outcome: 'ignore', ack: null };

  const id = typeof message.id === 'string' ? message.id : null;
  const name = message.verb;

  // Before anything else is revealed, including whether the protocol matched.
  if (!trusted) {
    return {
      outcome: 'refuse',
      ack: refusal(id, null, 'origin_not_allowed', 'sender origin is not on the control allowlist'),
      deliverAck: false,
    };
  }

  if (message.v !== PROTOCOL) {
    return {
      outcome: 'refuse',
      ack: refusal(id, null, 'bad_protocol', `this door speaks v${PROTOCOL}, got ${String(message.v)}`),
      deliverAck: true,
    };
  }

  if (!isVerb(name)) {
    return {
      outcome: 'refuse',
      ack: refusal(id, null, 'unknown_verb', `no such verb: ${name}`),
      deliverAck: true,
    };
  }

  switch (name) {
    case 'set_layers': {
      // A non-array `on` used to collapse to [] and be acked ok, so a caller
      // that sent a bare string got "changed nothing" reported as success.
      for (const field of ['on', 'off'] as const) {
        if (message[field] !== undefined && !Array.isArray(message[field])) {
          return {
            outcome: 'refuse',
            ack: refusal(id, name, 'malformed', `${field} must be an array of layer ids, got ${typeof message[field]}`),
            deliverAck: true,
          };
        }
      }
      const on = asIdList(message.on);
      const off = asIdList(message.off);
      const unknown = badLayerId(message.on, ctx.knownLayerIds) ?? badLayerId(message.off, ctx.knownLayerIds);
      if (unknown !== null) {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'unknown_layer', `no such layer: ${unknown}`),
          deliverAck: true,
        };
      }
      // The layer panel hides layers this deployment has no credentials for
      // (LayerPanel.tsx:246). Writing the boolean straight past that would turn
      // on a layer that can never carry data and that the operator has no
      // visible toggle to turn back off.
      for (const layer of on) {
        const needs = LAYER_REQUIREMENTS[layer];
        if (needs && !ctx.capabilities[needs]) {
          return {
            outcome: 'refuse',
            ack: refusal(id, name, 'layer_unavailable', `${layer} needs the ${needs} capability, which this deployment has not configured`),
            deliverAck: true,
          };
        }
      }
      return {
        outcome: 'apply',
        command: { verb: name, on, off },
        ack: { v: PROTOCOL, ok: true, id, verb: name, changed: { on, off } },
      };
    }

    case 'fly_to': {
      // Coordinates only. The door does not geocode: resolving a place name is
      // a 20s worst case against an external service (api/geosearch), and the
      // consumer (313-21) already has to know where it is sending the camera.
      const { lat, lng, zoom } = message as { lat?: unknown; lng?: unknown; zoom?: unknown };
      const okLat = typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90;
      const okLng = typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;
      if (!okLat || !okLng) {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'invalid_coordinates', 'fly_to takes a finite lat (-90..90) and lng (-180..180); this door does not resolve place names'),
          deliverAck: true,
        };
      }
      const okZoom = typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= 0 && zoom <= 24;
      // Absent zoom is fine and means "keep the current one". A zoom that was
      // sent but is out of range is a caller error, and silently dropping it
      // would ack success for a camera move that did not do what was asked.
      if (zoom !== undefined && !okZoom) {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'invalid_coordinates', `zoom must be a finite number in 0..24, got ${String(zoom)}`),
          deliverAck: true,
        };
      }
      const command: Command = okZoom ? { verb: name, lat, lng, zoom } : { verb: name, lat, lng };
      return {
        outcome: 'apply',
        command,
        ack: { v: PROTOCOL, ok: true, id, verb: name, changed: { ...(okZoom ? { lat, lng, zoom } : { lat, lng }) } },
      };
    }

    case 'set_projection': {
      const projection = message.projection;
      if (projection !== 'globe' && projection !== 'mercator') {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'invalid_projection', `projection is globe or mercator, got ${String(projection)}`),
          deliverAck: true,
        };
      }
      // Both existing routes to mercator clear terrain first (page.tsx:331-332
      // via selectFlatMap, and the `g` key at page.tsx:437-438). A door that
      // did not would leave the map in a state no other path can produce.
      const clearTerrain = projection === 'mercator';
      return {
        outcome: 'apply',
        command: { verb: name, projection, clearTerrain },
        ack: { v: PROTOCOL, ok: true, id, verb: name, changed: { projection, clearTerrain } },
      };
    }

    case 'open_camera': {
      const cameraId = message.cameraId;
      if (typeof cameraId !== 'string' || !cameraId) {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'malformed', 'open_camera needs a cameraId string'),
          deliverAck: true,
        };
      }
      // Not-loaded-yet is not the same fact as no-such-camera, and collapsing
      // the two would report a real camera as unknown for the first stretch of
      // every session.
      if (ctx.cameraIds === null) {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'camera_catalogue_not_ready', `the camera catalogue has not loaded yet, so ${cameraId} cannot be resolved; retry, or turn the cctv layer on first`),
          deliverAck: true,
        };
      }
      if (!ctx.cameraIds.has(cameraId)) {
        return {
          outcome: 'refuse',
          ack: refusal(id, name, 'unknown_camera', `no such camera: ${cameraId}`),
          deliverAck: true,
        };
      }
      return {
        outcome: 'apply',
        command: { verb: name, cameraId },
        ack: { v: PROTOCOL, ok: true, id, verb: name, changed: { cameraId } },
      };
    }
  }
}

/**
 * Bounded, and coalescing on fly_to. A fly is a 2000ms animation, so a queued
 * run of them would make the map thrash for minutes; the newest target is the
 * only one anybody wanted. Every other verb is cheap and stays FIFO.
 */
export class ControlQueue {
  private items: Command[] = [];

  constructor(private readonly max: number = MAX_QUEUE) {}

  get size(): number {
    return this.items.length;
  }

  /** False when the queue is full, so the caller can refuse by name. */
  push(command: Command): boolean {
    if (command.verb === 'fly_to') {
      const pending = this.items.findIndex(item => item.verb === 'fly_to');
      if (pending >= 0) {
        this.items[pending] = command;
        return true;
      }
    }
    if (this.items.length >= this.max) return false;
    this.items.push(command);
    return true;
  }

  drain(): Command[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }
}

export interface DoorOptions {
  allowedOrigins: readonly string[];
  /** Read at call time so the handler never serves a stale snapshot. */
  readContext: () => DoorContext;
  apply: (command: Command) => void;
  /** Defaults to the window's own search string. */
  search?: string;
}

/**
 * Installs the message listener, but only when the flag is present. Returns the
 * teardown. When the door is shut this installs nothing and returns a no-op, so
 * the caller can bind it unconditionally.
 */
export function installControlDoor(win: Window, opts: DoorOptions): () => void {
  const search = opts.search ?? win.location?.search ?? '';
  if (!isDoorOpen(search)) return () => { /* door shut: nothing was installed */ };

  const queue = new ControlQueue();
  let flushScheduled = false;
  let stopped = false;

  const flush = () => {
    flushScheduled = false;
    if (stopped) return;
    for (const command of queue.drain()) opts.apply(command);
  };

  const reply = (event: MessageEvent, ack: Ack) => {
    const source = event.source as { postMessage?: (data: unknown, origin: string) => void } | null;
    // Targeted at the origin the message came from, never '*': a wildcard would
    // hand the ack to whatever happens to be listening.
    try { source?.postMessage?.(ack, event.origin); } catch { /* parent went away */ }
  };

  const onMessage = (event: MessageEvent) => {
    if (stopped) return;

    const trusted =
      isOriginAllowed(event.origin, opts.allowedOrigins) &&
      // Unembedded, window.parent === window, so anything running on this page
      // could post with this page's own origin and pass an allowlist that
      // happens to contain it. A verb has to come from another window.
      event.source !== null &&
      event.source !== win;

    const decision = planVerb(event.data, trusted, opts.readContext());

    if (decision.outcome === 'ignore') return;
    if (decision.outcome === 'refuse') {
      if (decision.deliverAck) reply(event, decision.ack);
      return;
    }

    if (!queue.push(decision.command)) {
      reply(event, refusal(
        decision.ack.id,
        decision.command.verb,
        'queue_overflow',
        `more than ${MAX_QUEUE} verbs are already waiting; this one was not applied`,
      ));
      return;
    }

    reply(event, decision.ack);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  };

  win.addEventListener('message', onMessage);
  return () => {
    stopped = true;
    win.removeEventListener('message', onMessage);
  };
}
