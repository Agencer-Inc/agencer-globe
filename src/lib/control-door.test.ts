// @vitest-environment happy-dom
//
// The rest of the repo's suite runs under `node` (vitest.config.ts). The door
// installs a window listener, so its pins need a DOM or they would be asserting
// against a hand-rolled fake window — a test whose green is guaranteed by its
// own stub is not a test (Law 31).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ControlQueue,
  DEFAULT_ALLOWED_ORIGINS,
  MAX_QUEUE,
  PROTOCOL,
  type Command,
  type DoorContext,
  installControlDoor,
  isDoorOpen,
  isOriginAllowed,
  parseAllowedOrigins,
  planVerb,
} from './control-door';

const PARENT = 'https://app.example.test';

/** Every layer key the app really has, abbreviated to the ones under test. */
const ctx = (over: Partial<DoorContext> = {}): DoorContext => ({
  knownLayerIds: ['flights', 'maritime', 'cctv', 'terrain_3d', 'terrain_elevation', 'cf_outages'],
  capabilities: { cloudflare: false },
  cameraIds: new Set(['il-israel-multicam', 'nl-a10-west']),
  ...over,
});

const msg = (over: Record<string, unknown> = {}) => ({ v: PROTOCOL, id: 'r1', ...over });

/**
 * Accepted verbs are applied on a scheduled flush, not inside the message
 * handler, because that is the only way a bounded queue can coalesce a burst
 * that arrives as separate events. Pins that assert on `apply` wait for it.
 * This waits for the flush; it does not weaken what is asserted after it.
 */
const flush = () => Promise.resolve();

afterEach(() => vi.restoreAllMocks());

describe('the flag arms the door', () => {
  it('is shut with no flag, and open with one', () => {
    expect(isDoorOpen('')).toBe(false);
    expect(isDoorOpen('?layers=cctv,maritime')).toBe(false);
    expect(isDoorOpen('?control=1')).toBe(true);
    expect(isDoorOpen('?layers=cctv&control=1')).toBe(true);
  });

  it('installs no listener at all when the flag is absent', async () => {
    const win = window as unknown as Window;
    const add = vi.spyOn(win, 'addEventListener');
    const apply = vi.fn();

    const stop = installControlDoor(win, {
      allowedOrigins: [PARENT],
      readContext: () => ctx(),
      apply,
      search: '?layers=cctv',
    });

    expect(add).not.toHaveBeenCalledWith('message', expect.anything(), expect.anything());

    // A verb posted at a disarmed door changes nothing.
    win.dispatchEvent(new MessageEvent('message', {
      data: msg({ verb: 'set_projection', projection: 'mercator' }),
      origin: PARENT,
    }));
    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });
});

describe('the allowlist', () => {
  it('falls back to the localhost default and splits a configured list', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    expect(parseAllowedOrigins('   ')).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    expect(parseAllowedOrigins(`${PARENT}, https://two.test `)).toEqual([PARENT, 'https://two.test']);
  });

  it('matches on exact origin, never on a prefix', () => {
    expect(isOriginAllowed(PARENT, [PARENT])).toBe(true);
    expect(isOriginAllowed('https://app.example.test.evil.test', [PARENT])).toBe(false);
    expect(isOriginAllowed('http://app.example.test', [PARENT])).toBe(false);
    expect(isOriginAllowed('null', [PARENT])).toBe(false);
  });

  it('refuses an unlisted origin by name, changes nothing, and does not reply', () => {
    const decision = planVerb(msg({ verb: 'set_projection', projection: 'mercator' }), false, ctx());

    expect(decision.outcome).toBe('refuse');
    if (decision.outcome !== 'refuse') throw new Error('unreachable');
    expect(decision.ack.ok).toBe(false);
    if (decision.ack.ok) throw new Error('unreachable');
    expect(decision.ack.refused).toBe('origin_not_allowed');
    // Never ack a stranger: this page also hosts third-party camera iframes
    // that post at it, and replying would make the door a reflector.
    expect(decision.deliverAck).toBe(false);
  });

  it('drives nothing when the posting origin is not on the allowlist', async () => {
    const apply = vi.fn();
    const stop = installControlDoor(window as unknown as Window, {
      allowedOrigins: [PARENT],
      readContext: () => ctx(),
      apply,
      search: '?control=1',
    });

    window.dispatchEvent(new MessageEvent('message', {
      data: msg({ verb: 'set_projection', projection: 'mercator' }),
      origin: 'https://evil.test',
    }));

    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });
});

describe('layers by id', () => {
  it('refuses an unknown layer id by name', () => {
    const d = planVerb(msg({ verb: 'set_layers', on: ['flights', 'chemtrails'] }), true, ctx());
    expect(d.outcome).toBe('refuse');
    if (d.outcome !== 'refuse') throw new Error('unreachable');
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('unknown_layer');
    expect(d.ack.detail).toContain('chemtrails');
    expect(d.deliverAck).toBe(true);
  });

  it('refuses a layer this deployment has no credentials for', () => {
    const d = planVerb(msg({ verb: 'set_layers', on: ['cf_outages'] }), true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('layer_unavailable');
    expect(d.ack.detail).toContain('cloudflare');
  });

  it('accepts known ids and acks exactly what it turned on and off', () => {
    const d = planVerb(msg({ verb: 'set_layers', on: ['flights'], off: ['cctv'] }), true, ctx());
    if (d.outcome !== 'apply') throw new Error(`expected apply, got ${d.outcome}`);
    expect(d.command).toEqual({ verb: 'set_layers', on: ['flights'], off: ['cctv'] });
    if (!d.ack.ok) throw new Error('unreachable');
    expect(d.ack.changed).toEqual({ on: ['flights'], off: ['cctv'] });
    expect(d.ack.id).toBe('r1');
  });
});

describe('fly to a coordinate', () => {
  // Replaces the card's "stops the idle spin" pin, which asserted against dead
  // code: the spin is gated on demoMode (OsirisMap.tsx:224) and nothing in src/
  // ever calls setDemoMode. This pins the path the verb actually drives — the
  // flyToLocation prop effect at OsirisMap.tsx:2311-2313.
  it('carries the target through to the flyTo command and names it in the ack', () => {
    const d = planVerb(msg({ verb: 'fly_to', lat: 32.0853, lng: 34.7818, zoom: 11 }), true, ctx());
    if (d.outcome !== 'apply') throw new Error(`expected apply, got ${d.outcome}`);
    expect(d.command).toEqual({ verb: 'fly_to', lat: 32.0853, lng: 34.7818, zoom: 11 });
    if (!d.ack.ok) throw new Error('unreachable');
    expect(d.ack.changed).toEqual({ lat: 32.0853, lng: 34.7818, zoom: 11 });
  });

  it('takes coordinates only, and refuses a place name rather than guessing', () => {
    // The door does not geocode. 313-21 resolves place -> lat/lng before sending.
    const d = planVerb(msg({ verb: 'fly_to', place: 'Tel Aviv' }), true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('invalid_coordinates');
  });

  it('refuses coordinates off the globe', () => {
    for (const bad of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: NaN, lng: 0 }]) {
      const d = planVerb(msg({ verb: 'fly_to', ...bad }), true, ctx());
      expect(d.outcome).toBe('refuse');
    }
  });
});

describe('projection', () => {
  it('clears terrain on the way to mercator, as every other route to it does', () => {
    // selectFlatMap (page.tsx:331-332) and the `g` key (page.tsx:437-438) both
    // clear terrain first. A door verb that did not would leave the map in a
    // state no other path can produce (Law 15).
    const d = planVerb(msg({ verb: 'set_projection', projection: 'mercator' }), true, ctx());
    if (d.outcome !== 'apply') throw new Error(`expected apply, got ${d.outcome}`);
    expect(d.command).toEqual({ verb: 'set_projection', projection: 'mercator', clearTerrain: true });
  });

  it('refuses a projection it does not have', () => {
    const d = planVerb(msg({ verb: 'set_projection', projection: 'flat-earth' }), true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('invalid_projection');
  });
});

describe('a camera by id', () => {
  it('refuses an unknown camera id by name', () => {
    const d = planVerb(msg({ verb: 'open_camera', cameraId: 'no-such-cam' }), true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('unknown_camera');
    expect(d.ack.detail).toContain('no-such-cam');
  });

  it('says the catalogue is not ready rather than calling a real camera unknown', () => {
    // The catalogue loads progressively with 15s/30s backoff and only when the
    // cctv layer is on (page.tsx:641), so "not loaded yet" is the normal state
    // early in a session. Reporting it as `unknown_camera` would be a false
    // refusal for a camera that exists (Law 31: a probe that resolves unknown
    // to absent because its return type is a boolean).
    const d = planVerb(msg({ verb: 'open_camera', cameraId: 'il-israel-multicam' }), true, ctx({ cameraIds: null }));
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('camera_catalogue_not_ready');
    expect(d.ack.refused).not.toBe('unknown_camera');
  });

  it('opens a camera the catalogue knows', () => {
    const d = planVerb(msg({ verb: 'open_camera', cameraId: 'nl-a10-west' }), true, ctx());
    if (d.outcome !== 'apply') throw new Error(`expected apply, got ${d.outcome}`);
    expect(d.command).toEqual({ verb: 'open_camera', cameraId: 'nl-a10-west' });
  });
});

describe('malformed traffic', () => {
  it('ignores the third-party postMessage chatter this page already receives', () => {
    // YouTube camera embeds and @vercel/analytics both post at the parent.
    for (const junk of ['hello', 42, null, { nope: true }, { v: PROTOCOL }]) {
      const d = planVerb(junk, true, ctx());
      expect(d.outcome).not.toBe('apply');
    }
  });

  it('refuses a verb it does not have, by name', () => {
    const d = planVerb(msg({ verb: 'launch_missiles' }), true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('unknown_verb');
    expect(d.ack.detail).toContain('launch_missiles');
  });

  it('refuses a protocol version it does not speak', () => {
    const d = planVerb({ v: 99, id: 'r1', verb: 'set_projection', projection: 'globe' }, true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('bad_protocol');
  });
});

describe('the bounded queue', () => {
  it('coalesces fly_to instead of queueing a run of 2000ms animations', () => {
    const q = new ControlQueue();
    q.push({ verb: 'fly_to', lat: 1, lng: 1 });
    q.push({ verb: 'fly_to', lat: 2, lng: 2 });
    q.push({ verb: 'fly_to', lat: 3, lng: 3 });
    expect(q.drain()).toEqual([{ verb: 'fly_to', lat: 3, lng: 3 }]);
  });

  it('keeps other verbs in order', () => {
    const q = new ControlQueue();
    const a: Command = { verb: 'set_layers', on: ['flights'], off: [] };
    const b: Command = { verb: 'open_camera', cameraId: 'nl-a10-west' };
    q.push(a); q.push(b);
    expect(q.drain()).toEqual([a, b]);
  });

  it('refuses past its bound rather than growing without limit', () => {
    const q = new ControlQueue(3);
    expect(q.push({ verb: 'open_camera', cameraId: 'a' })).toBe(true);
    expect(q.push({ verb: 'open_camera', cameraId: 'b' })).toBe(true);
    expect(q.push({ verb: 'open_camera', cameraId: 'c' })).toBe(true);
    expect(q.push({ verb: 'open_camera', cameraId: 'd' })).toBe(false);
    expect(q.size).toBe(3);
    expect(MAX_QUEUE).toBeGreaterThan(0);
  });

  it('empties on drain', () => {
    const q = new ControlQueue();
    q.push({ verb: 'open_camera', cameraId: 'a' });
    q.drain();
    expect(q.size).toBe(0);
    expect(q.drain()).toEqual([]);
  });
});

describe('end to end through a real window', () => {
  it('applies an allowlisted parent\'s verb and acks what changed', async () => {
    const apply = vi.fn();
    const stop = installControlDoor(window as unknown as Window, {
      allowedOrigins: [PARENT],
      readContext: () => ctx(),
      apply,
      search: '?control=1',
    });

    const source = { postMessage: vi.fn() };
    const event = new MessageEvent('message', {
      data: msg({ verb: 'fly_to', lat: 51.5, lng: -0.12, zoom: 9 }),
      origin: PARENT,
    });
    Object.defineProperty(event, 'source', { value: source });
    window.dispatchEvent(event);

    await flush();
    expect(apply).toHaveBeenCalledWith({ verb: 'fly_to', lat: 51.5, lng: -0.12, zoom: 9 });
    expect(source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, id: 'r1', verb: 'fly_to' }),
      PARENT,
    );
    stop();
  });

  it('refuses a verb the page posts at itself, even on an allowlisted origin', async () => {
    // Unembedded, window.parent === window, so a script running on the globe
    // could otherwise post with the page's own origin and drive the map. A verb
    // has to come from another window.
    const apply = vi.fn();
    const stop = installControlDoor(window as unknown as Window, {
      allowedOrigins: [PARENT],
      readContext: () => ctx(),
      apply,
      search: '?control=1',
    });

    const event = new MessageEvent('message', {
      data: msg({ verb: 'set_projection', projection: 'mercator' }),
      origin: PARENT,
    });
    Object.defineProperty(event, 'source', { value: window });
    window.dispatchEvent(event);

    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('stops listening after teardown', async () => {
    const apply = vi.fn();
    const stop = installControlDoor(window as unknown as Window, {
      allowedOrigins: [PARENT],
      readContext: () => ctx(),
      apply,
      search: '?control=1',
    });
    // Post a message that WOULD be applied by a live door — allowlisted origin
    // and a real foreign source. Without both, this pin passes against a door
    // that never tore anything down, which is how it read before a mutation
    // run caught it.
    const live = new MessageEvent('message', {
      data: msg({ verb: 'set_projection', projection: 'mercator' }),
      origin: PARENT,
    });
    Object.defineProperty(live, 'source', { value: { postMessage: vi.fn() } });

    window.dispatchEvent(live);
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);

    stop();
    apply.mockClear();
    window.dispatchEvent(live);
    await flush();
    expect(apply).not.toHaveBeenCalled();
  });
});
