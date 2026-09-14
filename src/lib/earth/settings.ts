/**
 * OSIRIS earth server — the switch.
 *
 * The whole server is dark until this is armed (Law 32). With it unset, no
 * timer is created, no upstream is called, and every route that existed before
 * this leg behaves byte-identically, because nothing in this module tree runs
 * at all.
 *
 * The name is the fork's own and carries the fork's prefix. No BRAIN or VITE
 * switch is involved in this app.
 *
 * MERGED AND DARK IS NOT DELIVERED. The arming line, what it is scoped to, the
 * restart it rides and the witness token that proves it took are all drafted in
 * this leg's PR body under GATE LINES. "We flagged it" is not a reason to leave
 * it unarmed.
 */

/** The env var that arms the earth server. Unset or anything but '1' = dark. */
export const EARTH_SERVER_FLAG = 'NEXT_PUBLIC_EARTH_SERVER';

/**
 * Printed once when the scheduler arms, so an armed server is witnessable from
 * outside instead of being inferred from the flag (Law 32: a capability that
 * cannot be witnessed in its armed state is unshippable).
 */
export const EARTH_ARMED_TOKEN = '[OSIRIS earth] ARMED';

/**
 * Exact match on '1', not truthiness.
 *
 * `NEXT_PUBLIC_EARTH_SERVER=0` and `=false` are things an operator types when
 * they mean OFF, and both are truthy strings. A flag whose off-switch arms it
 * is the failure this rules out.
 *
 * The env object is a parameter so a test can prove the OFF path without
 * mutating process.env for the whole worker.
 */
export function earthServerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EARTH_SERVER_FLAG] === '1';
}
