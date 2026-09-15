/**
 * OSIRIS — a CSV reader that obeys the format.
 *
 * Written because a publisher's CSV is not a file you may split on commas. The
 * WRI power plant database carries owner names like "Acme Power, Inc."; a naive
 * split shifts every later column one to the left, so latitude gets read out of
 * the longitude field and the plant lands somewhere plausible and entirely
 * wrong. Nothing fails, nothing logs, and the map looks fine.
 *
 * So: quoted fields, doubled quotes as the single escape, embedded commas and
 * newlines, and either line ending. That is the whole of RFC 4180 that matters
 * here. aoi-export.ts already WRITES this format (csvCell, :54-58); this reads
 * it, and the two are pinned against the same rules from opposite directions.
 */

/**
 * Parse a whole CSV document into rows of fields.
 *
 * A single pass with an explicit in-quotes state, rather than a regex. A regex
 * that handles quoted newlines is unreadable and its failure mode is a silently
 * mis-split row, which is the exact thing this module exists to prevent.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = '';
    started = true;
  };
  const endRow = () => {
    if (started || row.length) {
      row.push(field);
      rows.push(row);
    }
    row = [];
    field = '';
    started = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote is an escaped quote; a lone one closes the field.
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; started = true; continue; }
    if (char === ',') { endField(); continue; }
    if (char === '\r') { continue; } // CRLF: the \n does the work
    if (char === '\n') { endRow(); continue; }

    field += char;
    started = true;
  }

  // A final row with no trailing newline still counts.
  if (started || field !== '' || row.length) endRow();

  return rows;
}

/**
 * Map a header row to field indices, by NAME.
 *
 * Column order is not part of any publisher's promise. Reading latitude from
 * index 5 works right up until a column is inserted before it, at which point
 * every row moves and nothing fails — so nothing here reads by position.
 *
 * A column that is absent is `undefined` rather than -1 or 0, both of which
 * would go on to read a real but wrong field.
 */
export function csvColumns(header: readonly string[]): Record<string, number | undefined> {
  const index: Record<string, number | undefined> = Object.create(null);
  header.forEach((name, i) => {
    index[name.trim().toLowerCase()] = i;
  });
  return index;
}
