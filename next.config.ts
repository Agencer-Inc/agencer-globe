import type { NextConfig } from "next";
import { CONTROL_FLAG, parseAllowedOrigins } from "./src/lib/control-door";

/* The remote-control door needs the page to render inside the parent app's
   iframe. X-Frame-Options: SAMEORIGIN forbids that outright and has no
   multi-origin form (ALLOW-FROM is dead in current browsers), so the flagged
   path drops it and states the same allowlist as CSP frame-ancestors instead.
   Reading the list through control-door.ts is deliberate: the browser's framing
   policy and the door's own origin check are then provably the same list, and
   cannot drift apart. Every other route keeps SAMEORIGIN. */
const CONTROL_ORIGINS = parseAllowedOrigins(process.env.NEXT_PUBLIC_CONTROL_ORIGINS);

const BASE_CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: wss: data: blob:;";

const SHARED_SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
];

const nextConfig: NextConfig = {
  /* DEV ONLY, and it is the difference between a live globe and a dead one.
     Next's dev server blocks any /_next/* request whose Origin header names a
     host outside ['**.localhost', 'localhost', ...this list] — see
     server/lib/router-utils/block-cross-site-dev.js. A blocked request is
     answered `403 Unauthorized`, and a 403 answering the /_next/hmr WEBSOCKET
     UPGRADE reaches the browser as ERR_INVALID_HTTP_RESPONSE. That throw
     happens inside hydrate(), so Turbopack's bootstrap never finishes, React
     never mounts, and the page freezes on its server-rendered first frame.
     Chunk GETs send no Origin and are never blocked, which is why the freeze
     looks like a rendering bug rather than a network one.

     127.0.0.1 is NOT a default: only the word `localhost` is. So the numeric
     loopback — which EARTH_SELF_ORIGIN uses, and which the agencer pane framed
     this app by — was dead while the identical page on `localhost` was fine.
     Hostnames, not origins: the blocker compares parseUrl(origin).hostname. */
  allowedDevOrigins: ['127.0.0.1'],
  turbopack: {
    rules: {
      'maplibre-gl.mjs': {
        loaders: [`${__dirname}/tools/maplibre-url-loader.cjs`],
        as: '*.js',
      },
    },
  },
  /* Standalone output exists for the Docker image — the Dockerfile copies
     .next/standalone. Vercel builds its own artifacts and does not want it:
     since the 16.2.6 -> 16.3.4 bump its adapter fails packaging with
     `ENOENT .next/next-server.js.nft.json` in onBuildComplete when a
     Turbopack build also emits standalone. The build itself compiles fine,
     which is why this only ever shows up on a deploy. Keep standalone
     everywhere except Vercel, so Docker and the platform both get what they
     expect. */
  output: process.env.VERCEL ? undefined : 'standalone',
  serverExternalPackages: ['ws'],
  transpilePackages: ['react-map-gl', 'mapbox-gl', 'maplibre-gl'],
  // Type errors block the build again. They were suppressed while 17 stood
  // unfixed; those are cleared, so the gate can do its job — the AstraPanel
  // crash (createPortal used without an import) shipped precisely because
  // nothing stopped it.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async headers() {
    return [
      /* The worker path carries the MapLibre version, so a given URL never
         changes contents — a version bump moves it. Next serves public/ with
         max-age=0, which made every page load refetch half a megabyte before
         the map could start. Immutable is safe here precisely because the
         version is in the path. */
      {
        source: '/vendor/maplibre/:version/:file*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      /* Control-flagged loads only. `has` and `missing` make these two rules
         mutually exclusive, so no request ever collects both a frame-ancestors
         CSP and an X-Frame-Options that contradicts it. An origin absent from
         the allowlist is still refused here by the browser itself, before any
         of the door's own checks run. */
      {
        source: '/:path*',
        has: [{ type: 'query', key: CONTROL_FLAG }],
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `${BASE_CSP} frame-ancestors 'self' ${CONTROL_ORIGINS.join(' ')};`,
          },
          ...SHARED_SECURITY_HEADERS,
        ],
      },
      {
        source: '/:path*',
        missing: [{ type: 'query', key: CONTROL_FLAG }],
        headers: [
          { key: 'Content-Security-Policy', value: BASE_CSP },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          ...SHARED_SECURITY_HEADERS,
        ],
      },
    ];
  },
};

export default nextConfig;
