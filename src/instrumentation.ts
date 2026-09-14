/**
 * OSIRIS — server start-up.
 *
 * Next calls register() once per server process. This is the only place the
 * earth server is armed, and it arms at the same restart that absorbs its code
 * rather than in a later conversation (Law 32).
 *
 * With NEXT_PUBLIC_EARTH_SERVER unset, startEarthServer creates no timer, no
 * record and no cache entry and returns immediately, so this hook existing
 * changes nothing observable about a server that has not armed it.
 *
 * The import is dynamic and runtime-gated because this file is also evaluated
 * in the edge runtime, which has no timers of the kind the scheduler uses.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // A throw in register() fails the whole server start. Dark, that cannot
  // happen (startEarthServer returns before doing anything), but armed it
  // would mean one optional capability takes the entire app down with it. A
  // flagged capability degrades with a loud warning; it does not get a vote on
  // whether the server boots (Law 32).
  try {
    const { startEarthServer } = await import('@/lib/earth/scheduler');
    const handle = startEarthServer();

    // Pre-warm in the background. A start-up hook that awaits two upstreams is
    // a start-up hook that delays every first request behind them.
    if (handle.armed) {
      void handle.warmed.catch((e: unknown) => {
        console.warn('[OSIRIS earth] pre-warm failed:', e);
      });
    }
  } catch (e) {
    console.error('[OSIRIS earth] failed to arm; the rest of the app is unaffected:', e);
  }
}
