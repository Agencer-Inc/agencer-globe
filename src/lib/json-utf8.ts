import { NextResponse } from 'next/server';

/**
 * OSIRIS — a JSON answer that SAYS it is UTF-8.
 *
 * NextResponse.json sends `content-type: application/json` with no charset.
 * That is legal — RFC 8259 fixes JSON as UTF-8 and browsers assume it — but
 * "legal" and "every client agrees" are different things, and a door that
 * serves non-ASCII owes its callers the parameter rather than the assumption.
 *
 * MEASURED, NOT THEORETICAL. Querying Polish power stations from PowerShell 5.1
 * returned `BeÅchatÃ³w`, `PoÅaniec`, `TurÃ³w`. The bytes on the wire were
 * correct — the parser produces Bełchatów with code points 322 and 243, pinned
 * in power-plants.test.ts — but Invoke-RestMethod falls back to ISO-8859-1 when
 * no charset is stated, so it decoded UTF-8 as Latin-1 and the damage was done
 * before anything could be printed. No console setting recovers it afterwards.
 *
 * A caller reading a place name it cannot trust is the same class of problem as
 * a wrong number: it looks like our data is broken when our data is fine.
 *
 * Every other header the caller passed is preserved; only the content type is
 * restated.
 */
export function jsonUtf8(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set('content-type', 'application/json; charset=utf-8');
  return res;
}
