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
  MAX_SHAPE_POINTS,
  PROTOCOL,
  type Command,
  type DoorContext,
  installControlDoor,
  isDoorOpen,
  isOriginAllowed,
  parseAllowedOrigins,
  planVerb,
  shapeProblems,
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

  it('reads the flag as presence, so it cannot disagree with the header rule', () => {
    // next.config.ts gates the framing exception on Next's `has: [{type:
    // 'query'}]`, which can only test presence. If the door treated ?control=0
    // as shut, that URL would open framing while leaving the listener
    // uninstalled — half-armed, with the two halves disagreeing.
    for (const search of ['?control', '?control=', '?control=0', '?control=false', '?control=yes']) {
      expect(isDoorOpen(search)).toBe(true);
    }
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

  it('drops entries that could inject a CSP directive', () => {
    // next.config.ts interpolates this list into frame-ancestors. An entry
    // carrying a `;` would close that directive and append its own, so a typo
    // in an env var could rewrite the page's security policy.
    expect(parseAllowedOrigins(`${PARENT}, https://evil.test; script-src *`)).toEqual([PARENT]);
    expect(parseAllowedOrigins(`${PARENT}/some/path`)).toEqual([]);
    expect(parseAllowedOrigins(`${PARENT}/`)).toEqual([]);
    expect(parseAllowedOrigins('javascript:alert(1)')).toEqual([]);
    expect(parseAllowedOrigins('not a url')).toEqual([]);
  });

  it('fails closed when everything configured is invalid, never back to localhost', () => {
    // Falling back would leave the door open to an origin the operator never
    // named. Empty means nothing is framed and nothing is answered, which is
    // visible and safe (Law 5).
    expect(parseAllowedOrigins('garbage')).toEqual([]);
    expect(parseAllowedOrigins(undefined)).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
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

  it('refuses a non-array payload instead of acking success for doing nothing', () => {
    const d = planVerb(msg({ verb: 'set_layers', on: 'flights' }), true, ctx());
    if (d.outcome !== 'refuse') throw new Error(`expected refuse, got ${d.outcome}`);
    if (d.ack.ok) throw new Error('unreachable');
    expect(d.ack.refused).toBe('malformed');
    expect(d.ack.detail).toContain('on');
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

  it('refuses a zoom that was sent but is out of range, rather than dropping it', () => {
    // Silently omitting it would ack ok for a camera move that ignored half
    // the request. An ABSENT zoom is still fine and means "keep the current".
    const bad = planVerb(msg({ verb: 'fly_to', lat: 0, lng: 0, zoom: 99 }), true, ctx());
    if (bad.outcome !== 'refuse') throw new Error(`expected refuse, got ${bad.outcome}`);
    if (bad.ack.ok) throw new Error('unreachable');
    expect(bad.ack.detail).toContain('zoom');

    const absent = planVerb(msg({ verb: 'fly_to', lat: 0, lng: 0 }), true, ctx());
    expect(absent.outcome).toBe('apply');
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

/**
 * The geometry validator, pinned against shapes built to break each rule, for
 * the same reason bboxProblems and registryProblems are: a validator nobody
 * proved rejects anything is a validator that passes everything (Law 31).
 */
describe('shapeProblems names what is wrong with a geometry, in words', () => {
  const TRIANGLE = [[0, 0], [1, 0], [1, 1]];

  it('accepts each mode at its own minimum', () => {
    expect(shapeProblems('polygon', TRIANGLE)).toEqual([]);
    expect(shapeProblems('line', [[0, 0], [1, 1]])).toEqual([]);
    expect(shapeProblems('rectangle', [[0, 0], [1, 1]])).toEqual([]);
    expect(shapeProblems('circle', [[0, 0], [1, 1]])).toEqual([]);
  });

  it('rejects a mode this app cannot draw', () => {
    expect(shapeProblems('hexagon', TRIANGLE)).not.toEqual([]);
    expect(shapeProblems('', TRIANGLE)).not.toEqual([]);
  });

  /* The minimums are draw.ts's own (minPoints), not a second copy: a polygon
     needs three points to enclose anything and a line needs two to go
     anywhere. A door that accepted fewer would hand the map a shape the
     human-drawn path could never have produced. */
  it('rejects a shape with too few points for its mode, and says the minimum', () => {
    expect(shapeProblems('polygon', [[0, 0], [1, 0]]).join(' ')).toMatch(/3/);
    expect(shapeProblems('line', [[0, 0]]).join(' ')).toMatch(/2/);
  });

  it('rejects coords that are not an array at all', () => {
    for (const bad of [null, undefined, 42, 'x', {}]) {
      expect(shapeProblems('polygon', bad), String(bad)).not.toEqual([]);
    }
  });

  it('names the vertex that was wrong, not just that one was', () => {
    expect(shapeProblems('polygon', [[0, 0], [1, 0], [999, 0]]).join(' ')).toMatch(/vertex 2/);
    expect(shapeProblems('polygon', [[0, 0], [1, 0], [0, 91]]).join(' ')).toMatch(/vertex 2/);
  });

  it('says out loud when a vertex looks like a swapped pair', () => {
    expect(shapeProblems('line', [[0, 0], [22.5, 114.05]]).join(' ')).toMatch(/swapped/);
  });

  /* MAX_QUEUE bounds how MANY verbs may wait; nothing bounded how big ONE of
     them could be. A ring is rendered as its own maplibre source and layer
     per shape (OsirisMap.tsx:2408), so an unbounded one is an unbounded
     render, not merely an unbounded array. */
  it('rejects a shape past the vertex cap', () => {
    const atCap = Array.from({ length: MAX_SHAPE_POINTS }, (_, i) => [i % 180, 0]);
    expect(shapeProblems('polygon', atCap)).toEqual([]);
    expect(shapeProblems('polygon', [...atCap, [0, 0]])).not.toEqual([]);
  });
});

describe('draw_shape puts a shape on the map', () => {
  it('applies a well-formed polygon and acks what changed', () => {
    const got = planVerb(
      msg({ verb: 'draw_shape', kind: 'polygon', coords: [[0, 0], [1, 0], [1, 1]] }),
      true,
      ctx(),
    );

    expect(got.outcome).toBe('apply');
    if (got.outcome !== 'apply') return;
    expect(got.command).toEqual({
      verb: 'draw_shape',
      kind: 'polygon',
      coords: [[0, 0], [1, 0], [1, 1]],
      name: null,
    });
    expect(got.ack.ok).toBe(true);
  });

  it('carries a name through when one is given', () => {
    const got = planVerb(
      msg({ verb: 'draw_shape', kind: 'line', coords: [[0, 0], [1, 1]], name: 'HK to the mainland' }),
      true,
      ctx(),
    );
    expect(got.outcome).toBe('apply');
    if (got.outcome === 'apply' && got.command.verb === 'draw_shape') {
      expect(got.command.name).toBe('HK to the mainland');
    }
  });

  it('refuses a non-string name rather than stringifying it', () => {
    const got = planVerb(
      msg({ verb: 'draw_shape', kind: 'line', coords: [[0, 0], [1, 1]], name: 42 }),
      true,
      ctx(),
    );
    expect(got.outcome).toBe('refuse');
    if (got.outcome === 'refuse' && !got.ack.ok) expect(got.ack.refused).toBe('malformed');
  });

  it('refuses a bad geometry BY NAME and carries the problems as the detail', () => {
    const got = planVerb(
      msg({ verb: 'draw_shape', kind: 'polygon', coords: [[0, 0], [1, 0]] }),
      true,
      ctx(),
    );

    expect(got.outcome).toBe('refuse');
    if (got.outcome !== 'refuse' || got.ack.ok) return;
    expect(got.ack.refused).toBe('invalid_geometry');
    expect(got.ack.detail.length).toBeGreaterThan(0);
    expect(got.ack.verb).toBe('draw_shape');
  });

  /**
   * The ack says what CHANGED, never what is inside the shape. Answering "what
   * is in here" is the query door's job, and a control ack that carried
   * contents would make the two doors inseparable — the one thing §7 of the
   * black box freezes hardest.
   */
  it('acks what changed and nothing about what is inside it', () => {
    const got = planVerb(
      msg({ verb: 'draw_shape', kind: 'polygon', coords: [[0, 0], [1, 0], [1, 1]] }),
      true,
      ctx(),
    );
    if (got.outcome !== 'apply' || !got.ack.ok) throw new Error('expected an applied verb');

    expect(got.ack.changed).toEqual({ kind: 'polygon', points: 3, name: null });
    expect(JSON.stringify(got.ack.changed)).not.toMatch(/count|items|contents|inside|total/);
  });
});

describe('clear_shapes takes them all off again', () => {
  it('applies with no argument at all', () => {
    const got = planVerb(msg({ verb: 'clear_shapes' }), true, ctx());
    expect(got.outcome).toBe('apply');
    if (got.outcome === 'apply') expect(got.command).toEqual({ verb: 'clear_shapes' });
  });

  it('acks that it cleared', () => {
    const got = planVerb(msg({ verb: 'clear_shapes' }), true, ctx());
    if (got.outcome !== 'apply' || !got.ack.ok) throw new Error('expected an applied verb');
    expect(got.ack.changed).toEqual({ cleared: 'all' });
  });
});

describe('the new verbs obey the door the old ones do', () => {
  it('are refused from a stranger, and never acked', () => {
    for (const verb of ['draw_shape', 'clear_shapes']) {
      const got = planVerb(msg({ verb, kind: 'line', coords: [[0, 0], [1, 1]] }), false, ctx());
      expect(got.outcome, verb).toBe('refuse');
      if (got.outcome === 'refuse') {
        expect(got.deliverAck, verb).toBe(false);
        if (!got.ack.ok) expect(got.ack.refused).toBe('origin_not_allowed');
      }
    }
  });

  it('are refused on a protocol mismatch', () => {
    const got = planVerb({ v: 99, id: 'r1', verb: 'clear_shapes' }, true, ctx());
    expect(got.outcome).toBe('refuse');
    if (got.outcome === 'refuse' && !got.ack.ok) expect(got.ack.refused).toBe('bad_protocol');
  });

  /**
   * fly_to coalesces because a fly is a 2000ms animation and only the newest
   * target was ever wanted (control-door.ts:385-389). Two shapes are two
   * shapes: coalescing them would silently drop one the caller asked for and
   * was already acked `ok`.
   */
  it('does NOT coalesce draw_shape the way fly_to does', () => {
    const queue = new ControlQueue();
    const first: Command = { verb: 'draw_shape', kind: 'line', coords: [[0, 0], [1, 1]], name: null };
    const second: Command = { verb: 'draw_shape', kind: 'line', coords: [[2, 2], [3, 3]], name: null };

    expect(queue.push(first)).toBe(true);
    expect(queue.push(second)).toBe(true);
    expect(queue.size).toBe(2);
    expect(queue.drain()).toEqual([first, second]);
  });

  it('still refuses past the queue cap rather than dropping silently', () => {
    const queue = new ControlQueue();
    for (let i = 0; i < MAX_QUEUE; i++) {
      expect(queue.push({ verb: 'clear_shapes' })).toBe(true);
    }
    expect(queue.push({ verb: 'clear_shapes' })).toBe(false);
  });
});
