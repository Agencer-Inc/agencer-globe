import { describe, it, expect } from 'vitest';
import {
  rowsToFeatures, rowsToFeatureCollection, colorExpression, circlePaint,
  labelLayout, labelPaint, paintIds, paintLayerIds, type PaintSpec,
} from './layer-paint';

const spec = (over: Partial<PaintSpec> = {}): PaintSpec => ({
  dataKey: 'power_plants',
  rowsKey: 'plants',
  color: '#00E5FF',
  radius: [[1, 2], [10, 7]],
  ...over,
});

describe('rowsToFeatures', () => {
  it('turns rows into points, keeping every other field as a property', () => {
    const [feature] = rowsToFeatures([{ lat: 51.2, lng: 19.3, name: 'Belchatow', fuel: 'coal' }]);

    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [19.3, 51.2] });
    expect(feature.properties).toMatchObject({ name: 'Belchatow', fuel: 'coal' });
  });

  /* [0,0] is a real place in the Gulf of Guinea. A defaulted row puts a power
     station in it, and the map looks fine. */
  it('skips a row with no real position rather than defaulting it', () => {
    const rows = [
      { lat: 51.2, lng: 19.3, id: 'ok' },
      { lat: null, lng: 19.3, id: 'null' },
      { lat: NaN, lng: 19.3, id: 'nan' },
      { lng: 19.3, id: 'missing' },
      null,
      'not a row',
    ];
    expect(rowsToFeatures(rows).map(f => f.properties!.id)).toEqual(['ok']);
  });

  it('reads anything that is not an array as nothing', () => {
    for (const bad of [null, undefined, 42, {}, 'x']) {
      expect(rowsToFeatures(bad), String(bad)).toEqual([]);
    }
    expect(rowsToFeatureCollection(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

describe('the ids a generic layer owns', () => {
  it('derives every id from the layer id, so none is typed twice', () => {
    expect(paintIds('power_plants')).toEqual({
      source: 'gen-power_plants',
      circle: 'gen-power_plants-circle',
      label: 'gen-power_plants-label',
    });
  });

  it('lists the label layer only when there is a label', () => {
    expect(paintLayerIds('x', spec())).toEqual(['gen-x-circle']);
    expect(paintLayerIds('x', spec({ label: { field: 'name', minZoom: 7 } })))
      .toEqual(['gen-x-circle', 'gen-x-label']);
  });
});

describe('colorExpression', () => {
  it('leaves a plain colour alone', () => {
    expect(colorExpression('#00E5FF')).toBe('#00E5FF');
  });

  it('builds a match on the field, lowercasing what the publisher wrote', () => {
    const expression = colorExpression({
      field: 'fuel',
      match: { coal: '#D32F2F', wind: '#00E676' },
      fallback: '#9E9E9E',
    }) as unknown[];

    expect(expression[0]).toBe('match');
    // 'Coal' and 'coal' must reach the same colour without every spec guessing
    // the upstream's capitalisation.
    expect(expression[1]).toEqual(['downcase', ['to-string', ['get', 'fuel']]]);
    expect(expression).toContain('coal');
    expect(expression).toContain('#D32F2F');
  });

  /* A match expression with no fallback drops the features it does not
     recognise, which on a map reads as missing data rather than as an unstyled
     category. The fallback is required by the type for that reason. */
  it('always ends in the fallback', () => {
    const expression = colorExpression({ field: 'f', match: { a: '#111' }, fallback: '#999' }) as unknown[];
    expect(expression[expression.length - 1]).toBe('#999');
  });
});

describe('circlePaint', () => {
  it('interpolates radius on zoom by default', () => {
    const paint = circlePaint(spec());
    expect(paint['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 1, 2, 10, 7]);
  });

  it('interpolates radius on a property when one is named', () => {
    const paint = circlePaint(spec({ sizeBy: { field: 'capacityMw', stops: [[0, 2], [5000, 12]] } }));
    const radius = paint['circle-radius'] as unknown[];

    expect(radius[0]).toBe('interpolate');
    // coalesced to 0, because a station that never reported a capacity must
    // still be drawn — at the smallest size, not dropped.
    expect(JSON.stringify(radius)).toContain('coalesce');
    expect(JSON.stringify(radius)).toContain('capacityMw');
  });

  it('draws no stroke unless a stroke colour was asked for', () => {
    expect(circlePaint(spec())['circle-stroke-width']).toBe(0);
    expect(circlePaint(spec({ strokeColor: '#000' }))['circle-stroke-width']).toBe(1);
  });
});

describe('the label layer', () => {
  it('reads the named field', () => {
    const withLabel = spec({ label: { field: 'name', minZoom: 7 } });
    expect(labelLayout(withLabel)['text-field']).toEqual(['get', 'name']);
    expect(labelPaint(withLabel)['text-color']).toBe('#00E5FF');
  });

  it('takes the fallback colour when the circles are coloured by field', () => {
    const byField = spec({
      color: { field: 'fuel', match: { coal: '#D32F2F' }, fallback: '#9E9E9E' },
      label: { field: 'name', minZoom: 7 },
    });
    // One label colour for a layer whose dots are many colours: the alternative
    // is a match expression repeated in two places that can disagree.
    expect(labelPaint(byField)['text-color']).toBe('#9E9E9E');
  });
});
