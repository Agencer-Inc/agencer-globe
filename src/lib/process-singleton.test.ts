import { describe, it, expect } from 'vitest';
import { processSingleton, singletonKeys } from './process-singleton';

describe('processSingleton', () => {
  it('hands back the SAME object for the same key', () => {
    const first = processSingleton('pin.same', () => new Map<string, number>());
    const second = processSingleton('pin.same', () => new Map<string, number>());

    expect(second).toBe(first);
    first.set('a', 1);
    expect(second.get('a')).toBe(1);
  });

  it('runs the factory at most once, however many callers ask', () => {
    let made = 0;
    const create = () => { made++; return { n: made }; };

    processSingleton('pin.once', create);
    processSingleton('pin.once', create);
    processSingleton('pin.once', create);

    expect(made).toBe(1);
  });

  it('keeps different keys apart', () => {
    const a = processSingleton('pin.a', () => new Map());
    const b = processSingleton('pin.b', () => new Map());
    expect(a).not.toBe(b);
  });

  /**
   * The property the whole module exists for. A second MODULE INSTANCE cannot
   * be conjured inside one test file, but what makes it work across instances
   * is that the registry lives on globalThis under a Symbol.for key rather than
   * in this module's closure — so reaching it through a freshly-computed symbol,
   * with no reference to anything this module exported, must find the same
   * object. If that ever stops being true, the Turbopack split silently
   * reappears and the earth door goes back to reporting an empty cache over a
   * warm one.
   */
  it('lives on globalThis, which is what survives a second module instance', () => {
    const value = processSingleton('pin.global', () => ({ marker: 'found' }));

    const viaGlobal = (globalThis as unknown as Record<symbol, Map<string, unknown>>)[
      Symbol.for('osiris.process.singletons')
    ];

    expect(viaGlobal).toBeInstanceOf(Map);
    expect(viaGlobal.get('pin.global')).toBe(value);
  });

  it('holds a falsy value without rebuilding it every call', () => {
    // `has`, not a truthiness check: a singleton that is legitimately 0, '' or
    // null would otherwise be rebuilt on every ask and never be singular.
    let made = 0;
    const zero = processSingleton('pin.falsy', () => { made++; return 0; });
    const again = processSingleton('pin.falsy', () => { made++; return 0; });

    expect(zero).toBe(0);
    expect(again).toBe(0);
    expect(made).toBe(1);
  });

  it('names what it is holding, for a human chasing a duplicate', () => {
    processSingleton('pin.named', () => ({}));
    expect(singletonKeys()).toContain('pin.named');
  });
});
