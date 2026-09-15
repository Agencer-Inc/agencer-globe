import { describe, it, expect } from 'vitest';
import { parseCsv, csvColumns } from './csv';

describe('parseCsv reads what RFC 4180 actually allows', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b,c\r\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('accepts either line ending, and a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  /**
   * The whole reason this exists rather than a split on commas. The WRI power
   * plant database carries owner names like "Acme Power, Inc." — a naive split
   * shifts every later column left, so latitude is read out of the longitude
   * field and the plant lands somewhere plausible and wrong. A wrong answer
   * that looks right is worse than a refusal.
   */
  it('keeps a comma that is inside quotes', () => {
    expect(parseCsv('name,lat\n"Acme Power, Inc.",51.5')).toEqual([
      ['name', 'lat'],
      ['Acme Power, Inc.', '51.5'],
    ]);
  });

  it('unescapes a doubled quote, the only escape the format has', () => {
    expect(parseCsv('a\n"She said ""hi"""')).toEqual([['a'], ['She said "hi"']]);
  });

  it('keeps a newline that is inside quotes', () => {
    expect(parseCsv('a,b\n"line one\nline two",x')).toEqual([
      ['a', 'b'],
      ['line one\nline two', 'x'],
    ]);
  });

  it('keeps empty fields, rather than dropping them and shifting the row', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
    expect(parseCsv('a,b,c\n,,')).toEqual([['a', 'b', 'c'], ['', '', '']]);
  });

  it('reads an empty input as no rows at all', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([]);
  });
});

describe('csvColumns finds fields by name, not by position', () => {
  /* Column ORDER is not part of any publisher's promise, and reading latitude
     from index 5 works right up until a column is inserted before it. Then
     every plant moves and nothing fails. */
  it('maps the header row to indices', () => {
    const index = csvColumns(['country', 'name', 'latitude', 'longitude']);
    expect(index.latitude).toBe(2);
    expect(index.country).toBe(0);
  });

  it('trims and lowercases, since publishers are inconsistent about both', () => {
    const index = csvColumns([' Country ', 'NAME', 'Latitude']);
    expect(index.country).toBe(0);
    expect(index.name).toBe(1);
    expect(index.latitude).toBe(2);
  });

  it('leaves a column it does not have undefined, rather than 0', () => {
    // -1 or 0 would both read the wrong field silently; undefined cannot.
    expect(csvColumns(['a', 'b']).missing).toBeUndefined();
  });
});
