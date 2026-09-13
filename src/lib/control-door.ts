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

/** True when the page URL carries the control flag. */
export function isDoorOpen(_search: string): boolean {
  throw new Error('control-door: isDoorOpen not implemented');
}

/** Splits the configured allowlist; falls back to the localhost default. */
export function parseAllowedOrigins(_raw: string | undefined): string[] {
  throw new Error('control-door: parseAllowedOrigins not implemented');
}

export function isOriginAllowed(_origin: string, _allowed: readonly string[]): boolean {
  throw new Error('control-door: isOriginAllowed not implemented');
}

/**
 * The verb table. Pure: same inputs, same decision, no side effects.
 * `trusted` says the origin check already passed.
 */
export function planVerb(_raw: unknown, _trusted: boolean, _ctx: DoorContext): Decision {
  throw new Error('control-door: planVerb not implemented');
}

/**
 * Bounded, and coalescing on fly_to. A fly is a 2000ms animation, so a queued
 * run of them would make the map thrash for minutes; the newest target is the
 * only one anybody wanted. Every other verb is cheap and stays FIFO.
 */
export class ControlQueue {
  constructor(_max: number = MAX_QUEUE) {
    throw new Error('control-door: ControlQueue not implemented');
  }
  get size(): number {
    throw new Error('control-door: ControlQueue not implemented');
  }
  push(_command: Command): boolean {
    throw new Error('control-door: ControlQueue not implemented');
  }
  drain(): Command[] {
    throw new Error('control-door: ControlQueue not implemented');
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
export function installControlDoor(_win: Window, _opts: DoorOptions): () => void {
  throw new Error('control-door: installControlDoor not implemented');
}
