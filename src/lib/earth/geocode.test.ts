import { describe, it, expect } from 'vitest';
import {
  boxAround, toCandidate, toCandidates,
  RADIUS_KM_BY_KIND, DEFAULT_RADIUS_KM, type GeoHit,
} from './geocode';
import { bboxProblems, inBbox } from './places';
import { haversine } from '@/lib/geo';

const hit = (over: Partial<GeoHit> = {}): GeoHit => ({
  name: 'Polska',
  context: 'Poland',
  lat: 52.215,
  lng: 19.134,
  kind: 'country',
  source: 'nominatim',
  ...over,
});

describe('boxAround builds a true geodesic extent', () => {
  it('produces a well-formed box centred on the point', () => {
    const box = boxAround(52.215, 19.134, 50);
    expect(bboxProblems(box)).toEqual([]);
    expect(inBbox(52.215, 19.134, box)).toBe(true);
  });

  it('reaches about the radius asked for, north and south', () => {
    const [, south, , north] = boxAround(0, 0, 100);
    expect(haversine([0, 0], [0, north])).toBeCloseTo(100, 1);
    expect(haversine([0, 0], [0, south])).toBeCloseTo(100, 1);
  });

  /**
   * A naive degree offset becomes an ellipse at high latitude — over Svalbard
   * the difference is not subtle (geo.ts:117-128). Walking a true bearing keeps
   * the east-west reach a real distance, which means the box is WIDER in
   * degrees the further north it sits.
   */
  it('widens in degrees at high latitude, because a degree of longitude is shorter there', () => {
    const equator = boxAround(0, 0, 100);
    const arctic = boxAround(70, 0, 100);
    const width = (b: number[]) => b[2] - b[0];

    expect(width(arctic)).toBeGreaterThan(width(equator) * 2);
    expect(haversine([0, 70], [arctic[2], 70])).toBeCloseTo(100, 0);
  });

  it('clamps at the pole rather than producing a latitude past 90', () => {
    const box = boxAround(89.7, 0, 200);
    expect(bboxProblems(box)).toEqual([]);
    expect(box[3]).toBeLessThanOrEqual(90);
  });
});

describe('toCandidate prefers the publisher box over one of ours', () => {
  it('takes an upstream box verbatim and says so', () => {
    const POLAND: [number, number, number, number] = [14.122929, 49.002046, 24.1458933, 54.8357841];
    const got = toCandidate('Poland', hit({ bbox: POLAND, bboxSource: 'upstream' }));

    expect(got?.bbox).toEqual(POLAND);
    expect(got?.bboxSource).toBe('upstream');
    expect(got?.note).toMatch(/nominatim/i);
  });

  /**
   * A derived box is a guess with a stated radius, and a consumer drawing
   * conclusions from "all power plants in Poland" is entitled to know it got
   * one. The field says which; the note says how big and why.
   */
  it('derives a box by kind when the publisher sent none, and says THAT', () => {
    const got = toCandidate('Poland', hit({ kind: 'city', bbox: undefined }));

    expect(got?.bboxSource).toBe('derived');
    expect(got?.note).toMatch(/no box/i);
    expect(got?.note).toContain(String(RADIUS_KM_BY_KIND.city));
  });

  it('falls back to a stated default radius for a kind with no rule', () => {
    const got = toCandidate('Somewhere', hit({ kind: 'not_a_kind', bbox: undefined }));
    expect(got?.note).toContain(String(DEFAULT_RADIUS_KM));
  });

  it('keys the candidate by the name that was ASKED, not the name that came back', () => {
    // The caller will later query with the words it used; keying by the
    // upstream's own label would store "Polska" and refuse "Poland" forever.
    const got = toCandidate('  Poland  ', hit({ name: 'Polska' }));
    expect(got?.key).toBe('poland');
    expect(got?.label).toBe('Polska');
  });

  it('carries the context that tells two places of one name apart', () => {
    const texas = toCandidate('Paris', hit({ name: 'Paris', context: 'Texas, United States', kind: 'city' }));
    expect(texas?.context).toBe('Texas, United States');
  });

  it('refuses a hit whose coordinates are not real', () => {
    expect(toCandidate('x', hit({ lat: NaN }))).toBeNull();
    expect(toCandidate('x', hit({ lng: 999 }))).toBeNull();
  });

  it('refuses an upstream box that does not survive checking, rather than passing it on', () => {
    const bad = toCandidate('x', hit({
      bbox: [10, 60, 20, 50] as [number, number, number, number], // south above north
      bboxSource: 'upstream',
    }));
    // The point is still good, so it falls back to a derived box rather than
    // failing the whole candidate.
    expect(bad?.bboxSource).toBe('derived');
  });
});

describe('toCandidates ranks and bounds the list', () => {
  it('drops the hits it cannot use and keeps the rest in order', () => {
    const got = toCandidates('Paris', [
      hit({ name: 'Paris', context: 'Île-de-France, France' }),
      hit({ lat: NaN }),
      hit({ name: 'Paris', context: 'Texas, United States' }),
    ]);

    expect(got).toHaveLength(2);
    expect(got[0].context).toMatch(/France/);
    expect(got[1].context).toMatch(/Texas/);
  });

  it('never offers more than the cap, however many came back', () => {
    const many = Array.from({ length: 50 }, (_, i) => hit({ context: `place ${i}` }));
    expect(toCandidates('x', many).length).toBeLessThanOrEqual(8);
  });

  it('answers an empty list with an empty list, not a guess', () => {
    expect(toCandidates('nowhere at all', [])).toEqual([]);
  });
});
