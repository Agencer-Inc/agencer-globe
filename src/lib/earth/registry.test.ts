import { describe, it, expect } from 'vitest';
import {
  EARTH_LAYERS, PRE_WARM, earthLayer, registryProblems, unservedLiveLayers, selfOrigin,
  type EarthLayer,
} from './registry';
import { osirisLayer, OSIRIS_LAYERS } from '@/lib/layers-catalog';

const fixture = (over: Partial<EarthLayer> = {}): EarthLayer => ({
  id: 'earthquakes',
  intervalMs: 60_000,
  ttlMs: 60_000,
  timeoutMs: 10_000,
  fetch: async () => [],
  ...over,
});

describe('the real registry', () => {
  it('has no problems', () => {
    expect(registryProblems()).toEqual([]);
  });

  it('registers only layers the catalogue calls live', () => {
    for (const layer of EARTH_LAYERS) {
      expect(osirisLayer(layer.id)?.status).toBe('live');
    }
  });

  it('gives every fetcher a timeout shorter than its own cadence', () => {
    for (const layer of EARTH_LAYERS) {
      expect(layer.timeoutMs).toBeLessThan(layer.intervalMs);
    }
  });

  it('pre-warms only layers it actually registered', () => {
    for (const id of PRE_WARM) expect(earthLayer(id)).toBeDefined();
  });

  it('reaches its own routes by IP, because localhost DNS is unreliable on the rig', () => {
    expect(selfOrigin({} as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:3000');
    expect(selfOrigin({ EARTH_SELF_ORIGIN: 'http://example.test' } as unknown as NodeJS.ProcessEnv))
      .toBe('http://example.test');
  });
});

describe('unservedLiveLayers', () => {
  // Computed, never hand-listed: a hand-written list of what is missing goes
  // stale the moment someone serves one of them.
  it('names every live catalogue row with no fetcher, and none that has one', () => {
    const unserved = unservedLiveLayers();
    for (const id of unserved) expect(osirisLayer(id)?.status).toBe('live');
    for (const layer of EARTH_LAYERS) expect(unserved).not.toContain(layer.id);

    const liveCount = OSIRIS_LAYERS.filter(r => r.status === 'live').length;
    expect(unserved.length).toBe(liveCount - EARTH_LAYERS.length);
  });

  it('does not claim a dead row is merely unserved', () => {
    expect(unservedLiveLayers()).not.toContain('balloons');
    expect(unservedLiveLayers()).not.toContain('war_alerts');
  });
});

// registryProblems is itself a verifier, so it is pinned against rows built to
// break each rule. A validator nobody proved rejects anything passes
// everything (Law 31).
describe('registryProblems rejects', () => {
  it('an id the catalogue does not have', () => {
    expect(registryProblems([fixture({ id: 'not_a_layer' })]))
      .toContain('not_a_layer is not a catalogue layer id');
  });

  // The load-bearing one: `balloons` cadence prose reads "Requested every 5
  // minutes while the layer is on. Nothing answers." A regex over that field
  // would schedule a fetcher against a route that does not exist.
  it('a dead catalogue row, whatever its cadence prose says', () => {
    expect(registryProblems([fixture({ id: 'balloons' })]))
      .toContain('balloons has catalogue status dead, so it must not have a fetcher');
  });

  it('a render_only row', () => {
    expect(registryProblems([fixture({ id: 'day_night' })]))
      .toContain('day_night has catalogue status render_only, so it must not have a fetcher');
  });

  it('a timeout that is not shorter than the cadence', () => {
    const problems = registryProblems([fixture({ intervalMs: 1000, timeoutMs: 1000 })]);
    expect(problems.join(' ')).toContain('is not less than intervalMs');
  });

  it('a non-positive interval, ttl or timeout', () => {
    expect(registryProblems([fixture({ intervalMs: 0 })]).join(' ')).toContain('intervalMs must be positive');
    expect(registryProblems([fixture({ ttlMs: 0 })]).join(' ')).toContain('ttlMs must be positive');
    expect(registryProblems([fixture({ timeoutMs: -1 })]).join(' ')).toContain('timeoutMs must be positive');
  });

  it('the same layer registered twice', () => {
    expect(registryProblems([fixture(), fixture()])).toContain('earthquakes is registered twice');
  });

  it('a row with no fetch function', () => {
    expect(registryProblems([fixture({ fetch: undefined as unknown as EarthLayer['fetch'] })]).join(' '))
      .toContain('has no fetch function');
  });

  it('and passes a well-formed row, so the rejections above mean something', () => {
    expect(registryProblems([fixture()])).toEqual([]);
  });
});
