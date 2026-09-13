<div align="center">

# ⬡ OSIRIS

### Open Source Intelligence & Reconnaissance Integrated System

[![Live Demo](https://img.shields.io/badge/osirisai.live-00E5FF?style=for-the-badge&logo=vercel&logoColor=white)](https://osirislive.app)
[![Support OSIRIS](https://img.shields.io/badge/Support_Project-Patreon-FF424D?style=for-the-badge&logo=patreon&logoColor=white)](https://www.patreon.com/posts/159077425)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-GPU_Rendered-396CB2?style=for-the-badge)](https://maplibre.org)
[![License](https://img.shields.io/badge/License-MIT-D4AF37?style=for-the-badge)](LICENSE)

**A real-time global intelligence dashboard that aggregates live flight tracking, CCTV networks, earthquake monitoring, conflict zone mapping, and 24/7 news feeds into a single GPU-accelerated interface.**

[Live Demo](https://osirisai.live) · [Report Bug](https://github.com/simplifaisoul/osiris/issues) · [Request Feature](https://github.com/simplifaisoul/osiris/issues) · [Join Discord](https://discord.gg/umBykEpb98)

</div>

---

## Overview

Osiris is a production-grade OSINT platform that provides situational awareness across multiple intelligence domains. Built with Next.js 16 and MapLibre GL, every data point is rendered via WebGL for 60fps performance even with thousands of concurrent entities on-screen.

### Key Capabilities

| Domain | Data Points | Sources |
|--------|------------|---------|
| **Aviation** | Commercial, Private, Military, Jets | OpenSky Network |
| **Maritime** | 39 Global Ports, 10 Chokepoints | Static Naval Intel |
| **CCTV** | 17,000+ Cameras | TfL, WSDOT, Caltrans, ODOT, MDOT, HK Transport Dept, Taiwan THB, NZTA + more |
| **Seismic** | Real-time M2.5+ | USGS Earthquake API |
| **Fires** | Active Hotspots | NASA FIRMS |
| **News** | 24/7 Live Streams | 25+ Global Broadcasters |
| **Weather** | Severe Events | NASA EONET |
| **Space** | Solar Weather, Satellites | NOAA SWPC, N2YO |
| **Cyber** | CVE Threats, Vulnerability Scanning | NVD, Custom Scanner |
| **Conflict** | 13 Active Zones | Static OSINT Intel |
| **Crypto** | BTC + ETH Wallet Tracing, OFAC SDN Match | blockstream.info, Blockscout, OpenSanctions |
| **Sanctions** | Person / Org / Vessel SDN Search | OpenSanctions (US OFAC SDN mirror) |
| **Telegram OSINT** | Geoparsed Posts from Public Channels | `t.me/s/<channel>` web preview |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  OSIRIS CLIENT                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ MapLibre  │  │  HUD     │  │  RECON Toolkit│ │
│  │  GL (GPU) │  │ Panels   │  │  Port Scan    │ │
│  │  WebGL    │  │ Layers   │  │  DNS / WHOIS  │ │
│  │  Render   │  │ Controls │  │  Vuln Scanner │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
├─────────────────────────────────────────────────┤
│               NEXT.JS API ROUTES                 │
│  /api/flights         /api/earthquakes          │
│  /api/cctv            /api/news                 │
│  /api/fires           /api/maritime             │
│  /api/gdelt           /api/satellites           │
│  /api/weather         /api/scanner              │
│  /api/sentinel        /api/telegram-feed        │
│  /api/osint/*  (whois, dns, ip, cve, sanctions, │
│                 crypto, sweep, threats, …)      │
├─────────────────────────────────────────────────┤
│              EXTERNAL DATA SOURCES               │
│  OpenSky · USGS · NASA · NOAA · TfL · NVD      │
│  GDACS · EONET · FIRMS · N2YO · RSS Feeds      │
│  blockstream.info · Blockscout · OpenSanctions  │
│  t.me public previews                            │
└─────────────────────────────────────────────────┘
```

---

## Features

### Intelligence Layers
- **16 toggleable data layers** with real-time entity counts
- **GPU-accelerated rendering** — all map data rendered via WebGL, not DOM
- **Progressive loading** — data fetched on-demand when layers are activated
- **Viewport-aware** — only loads relevant data for the visible region

### RECON Toolkit
- **Port Scanner** — TCP connect scan with service fingerprinting
- **DNS Lookup** — Full record resolution (A, AAAA, MX, NS, TXT, CNAME)
- **WHOIS** — Domain/IP registration data (auto-cross-checked against OFAC SDN)
- **SSL/TLS Inspector** — Certificate chain analysis
- **IP Intelligence** — Geolocation, ASN, threat reputation (auto-cross-checked against OFAC SDN)
- **Vulnerability Scanner** — CVE lookup against NVD database
- **Crypto Wallet Trace** — BTC + ETH lookup (balance, tx history, OFAC SDN sanctions flag)
- **OFAC Sanctions Search** — query persons, organizations, vessels and aircraft against the US OFAC SDN list

### Live Broadcast Network
- **25+ live 24/7 news streams** from global broadcasters
- Click any news dot on the map to open the live stream
- Feeds from NBC, CBS, ABC, Sky News, Al Jazeera, France 24, NHK, WION, and more

### Telegram OSINT Layer
- **Public-channel feed** scraped from the unauthenticated `t.me/s/<channel>` web preview — no Bot API token, no MTProto
- Default curated set of 5 channels (EN + RU/UA war reporting), overridable via `OSIRIS_TELEGRAM_CHANNELS`
- Posts are geoparsed against a multilingual place dictionary (EN + Cyrillic + Arabic) and plotted on the map
- Click any cyan dot to read the post and jump to the original on Telegram

### Crypto Wallet Intelligence
- **BTC** lookups via [blockstream.info](https://blockstream.info) (Esplora API, keyless)
- **ETH** lookups via [Blockscout](https://github.com/blockscout/blockscout)'s public ETH instance (`eth.blockscout.com`, keyless)
- Every lookup is cross-checked against the OFAC SDN sanctioned-address list (mirrored from [`0xB10C/ofac-sanctioned-digital-currency-addresses`](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses))
- Sanctioned wallets surface a red **SANCTIONED — OFAC SDN** badge in the RECON panel

### OFAC SDN Cross-Check
- Standalone `SANCTIONS` tab in the RECON toolkit — full-text search across persons, organisations, vessels and aircraft
- WHOIS and IP-intel routes auto-cross-check registrant / ASN-owner names against the SDN list and surface an inline alert
- Data sourced from [OpenSanctions](https://www.opensanctions.org) (CC-BY 4.0) — keyless, ~7 MB cached in-memory for 24h

### Conflict Zone Monitoring
- **13 active conflict/tension zones** with severity-coded warning markers
- Active Wars: Ukraine, Gaza, Sudan, Myanmar, DRC, Yemen
- High Tension: Syria, Lebanon, Sahel, Somalia, Red Sea
- Elevated: Taiwan Strait, Korean DMZ

### Performance Optimized
- **75% reduction in edge requests** vs initial release
- Aggressive polling relaxation (15-30 min intervals for stable data)
- Static data served from memory (zero external API calls for news feeds)
- `layerFetchedRef` prevents duplicate API requests

---

## Quick Start

```bash
git clone https://github.com/simplifaisoul/osiris.git
cd osiris
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Docker / Self-Hosting

```bash
git clone https://github.com/simplifaisoul/osiris.git
cd osiris
cp .env.template .env     # optional — configure keys / port
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The image is a multi-stage
`node:22-alpine` standalone build (~220 MB, non-root). The compose file also
carries CasaOS app metadata (`x-casaos:`) for one-click install on
[CasaOS](https://casaos.io). See **[DOCKER.md](DOCKER.md)** for the full Docker,
CasaOS and API-key guide.

**Prebuilt image (GHCR)** — skip the build and pull it directly:

```bash
docker pull ghcr.io/simplifaisoul/osiris:latest
docker run -d -p 3000:3000 --env-file .env ghcr.io/simplifaisoul/osiris:latest
```

**Custom port** — the container always listens on `3000`; set `OSIRIS_PORT` in
`.env` to change the published host port (e.g. `OSIRIS_PORT=3005`) without
editing the compose file.

### Environment Variables

OSIRIS works **partially without any API keys** — all core feeds use public,
keyless sources. Copy [`.env.template`](.env.template) to `.env` and set only
what you need:

```env
# Published host port (container always listens on 3000). Default: 3000
OSIRIS_PORT=3000

# RECON scanner backend (the only vars the current code reads).
# SCANNER_KEY must match the backend's OSIRIS_KEY — generate with: openssl rand -hex 32
SCANNER_URL=
SCANNER_KEY=

# Optional, for higher rate limits / future sources (see DOCKER.md for signup links)
FIRMS_API_KEY=                # NASA FIRMS  — firms.modaps.eosdis.nasa.gov/api/map_key/
OPENSKY_CLIENT_ID=            # OpenSky OAuth2 (since Mar 2025) — opensky-network.org
OPENSKY_CLIENT_SECRET=
N2YO_API_KEY=                 # N2YO satellites — n2yo.com (Profile → API key)
AIS_API_KEY=                 # aisstream.io maritime
```

> Without `SCANNER_URL`/`SCANNER_KEY` the RECON toolkit returns `503`; every
> other layer works out of the box. `.env` is gitignored — only the template is committed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map Engine | MapLibre GL JS (WebGL) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Styling | Custom CSS Design System |
| Deployment | Vercel Edge Network |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle flight layers |
| `E` | Toggle earthquakes |
| `S` | Toggle satellites |
| `D` | Toggle day/night cycle |
| `Escape` | Close panels |

---

## Remote-control door

A parent web app can drive this globe live, without a reload, by posting
messages at the window. Off by default.

### Arming it

Two things must both be true, or nothing is installed and nothing is answered:

1. the page is opened with the flag: `https://your-globe/?control=1`
2. the sender's origin is on the allowlist:
   `NEXT_PUBLIC_CONTROL_ORIGINS="https://app.example.com,https://staging.example.com"`

With no allowlist configured the default is `http://localhost:3000` and
`http://127.0.0.1:3000`, which is the Mac rig and nothing else.

**The allowlist is read at build time, not at run time.** `NEXT_PUBLIC_*` is
inlined by Next during `next build`, and `next.config.ts` reads the same value
to build the CSP. Setting it only in `docker-compose.yml` env is too late — the
image will already have been built with the default. Pass it as a build arg or
build the image with it exported. Say it out loud because the failure is quiet:
the door simply never opens.

### The four verbs

Post `{ v: 1, id, verb, ... }`. Every field below is required unless marked.

| Verb | Payload | Does |
|---|---|---|
| `set_layers` | `on: string[]`, `off: string[]` (either may be omitted) | Toggles layers by id |
| `fly_to` | `lat`, `lng`, `zoom` (optional, 0-24) | Moves the camera |
| `set_projection` | `projection: "globe" \| "mercator"` | Switches the surface; mercator also clears the terrain layers, as every other route to it does |
| `open_camera` | `cameraId: string` | Opens that CCTV feed and flies to it at zoom 13 |

`fly_to` takes **coordinates only**. The door does not geocode: resolving a
place name is a 20-second worst case against an external service, and the
caller already knows where it is pointing. Resolve `place` to `lat`/`lng`
before you send.

Layer ids are the keys of the app's own layer state (34 of them, including
`terrain_3d` and `terrain_elevation` — there is no plain `terrain`). The door
validates against the live set rather than a frozen copy, so adding a layer to
the app adds it to the door.

### The ack

Every message from an allowlisted origin that **carries a `verb` string** is
answered, posted back to the sender and targeted at its origin, never `*`.
Anything without a `verb` is ignored in silence, because that is what the
third-party camera iframes and the analytics script on this page look like.

```jsonc
// accepted
{ "v": 1, "ok": true,  "id": "r1", "verb": "fly_to", "changed": { "lat": 51.5, "lng": -0.12, "zoom": 9 } }
// refused, always by name
{ "v": 1, "ok": false, "id": "r1", "verb": "open_camera",
  "refused": "camera_catalogue_not_ready",
  "detail": "the camera catalogue has not loaded yet, so nl-a10-west cannot be resolved; retry, or turn the cctv layer on first" }
```

Refusal names: `origin_not_allowed`, `bad_protocol`, `malformed`,
`unknown_verb`, `unknown_layer`, `layer_unavailable`, `invalid_coordinates`,
`invalid_projection`, `unknown_camera`, `camera_catalogue_not_ready`,
`queue_overflow`.

`camera_catalogue_not_ready` is deliberately not `unknown_camera`. The camera
catalogue loads progressively with backoff and only once the `cctv` layer is on,
so for the first stretch of a session a perfectly real camera is not yet known.
Reporting that as "no such camera" would be a false answer.

An ack means the verb was **accepted and queued this tick**, not that the
picture has settled. `changed` echoes what was asked for; it is not a
measurement of the resulting map. `fly_to` starts a 2000ms animation and the
ack returns long before it finishes, and a `fly_to` superseded by a newer one in
the same tick is coalesced away after its ack was already sent. If you need to
know where the map ended up, the ack is not that evidence.

### What it will not do

- **Answer a stranger.** A message from an origin not on the allowlist changes
  nothing and gets **no reply at all**. This page hosts third-party camera
  iframes that post at it; replying would turn the door into a reflector.
- **Take a verb from its own page.** The sender must be a different window, so
  a script running on the globe itself cannot drive it.
- **Let a flood starve the map.** Verbs queue to a bound of 32 and are refused
  by name past it. Repeated `fly_to` coalesces to the newest target rather than
  queueing a run of 2000ms animations.
- **Evaluate anything.** There is no code path from a message to `eval`.

### Framing

`?control=1` loads drop `X-Frame-Options` and send
`Content-Security-Policy: ... frame-ancestors 'self' <allowlist>` instead.
Every other route keeps `X-Frame-Options: SAMEORIGIN` exactly as before. The two
header rules are mutually exclusive, so no request ever gets both. An origin
that is not on the list is refused by the browser before the door's own check
even runs.

### Not included

The non-embedded transport (the same verbs over a stream, for a window that is
not in an iframe) is **not** in this door. It needs an authenticated inbound
POST, a per-session registry and a single-instance constraint; shipped
carelessly it is an unauthenticated route that lets anyone reroute every
connected viewer's map. It is tracked separately as row 313-20b.

### Proving it works

Four things were checked, and two were not. Both lists are here on purpose: a
proof list without its gaps is not a proof list.

**Proven, on a live `next dev` on port 3000:**

1. `GET /api/health` returns 200 on **port 3000**.
2. `GET /` still sends `X-Frame-Options: SAMEORIGIN` and no `frame-ancestors`.
   The *response headers* for unflagged traffic are byte-identical to before.
   Two behaviours do change for everyone, flag or no flag: the layer URL writer
   now amends the query instead of rebuilding it (so `?layers=` no longer eats
   every other parameter), and `?control` is read as presence, so `?control=0`
   arms the door rather than disarming it.
3. `GET /?control=1` sends **no** `X-Frame-Options`, and
   `Content-Security-Policy: ... frame-ancestors 'self' http://localhost:3000
   http://127.0.0.1:3000`.
4. The door reaches the browser on a flagged load: every refusal name in
   `control-door.ts` is present in the client bundle served for `/?control=1`,
   so it is neither tree-shaken nor left server-only.

Reproduce 1-4:

```bash
npm run dev
node - <<'EOF'
const B = 'http://127.0.0.1:3000';
for (const p of ['/', '/?control=1']) {
  const r = await fetch(B + p);
  console.log(p, r.headers.get('x-frame-options'),
              (r.headers.get('content-security-policy') || '').match(/frame-ancestors[^;]*/)?.[0]);
}
EOF
```

The verb table itself is covered by 26 tests in `src/lib/control-door.test.ts`,
which run under happy-dom against a real `window`, a real
`addEventListener('message')` and a real dispatched `MessageEvent` — including
the case where the flag is absent and no listener is installed at all.

**NOT RUN, named rather than glossed:**

- **The container proof.** `docker compose version` is unavailable in the
  environment this was built in, so the app was never brought up under its own
  compose here. The compose file is unchanged by this work and still publishes
  `${OSIRIS_PORT:-3000}:3000`; nothing in this change touches it. Anyone with
  Docker should run `docker compose up -d` and repeat checks 1-3 against the
  container.
- **HEADED ROUND TRIP NOT RUN in this sandbox** — open the fork inside a parent
  page on the allowlist with `?control=1` and post one verb; the ack is the
  witness. No browser could be launched where this was built, so the end-to-end
  path "real parent frame posts a verb, React's binding applies it, an ack comes
  back" is proven at the unit level and at the header level but has not been
  watched happen in a real browser. The one link still unwitnessed is React
  mounting the binding.

---

## The layer catalogue

Two files say what every layer on this globe is and where it comes from. They
are the contract the canvas producer (313-21) picks layers from and the earth
server (313-23) fetches by, so the ids are stable and the door key is carried
verbatim wherever one exists.

| File | Holds | What a green test proves |
|---|---|---|
| `src/lib/layers-catalog.ts` | the 34 layers the globe has | the rows are set-equal to the vocabulary the app boots from |
| `src/lib/source-catalog.ts` | 2 power and 5 World-Monitor sources not on the globe yet | the rows are well formed and point somewhere that parses |

### Why two files and not one

`layers-catalog.ts` can prove itself. `page.tsx` seeds its layer state from
`DEFAULT_ACTIVE_LAYERS` in that file, and the remote-control door validates
`set_layers` against `Object.keys(activeLayers)`. So the catalogue's vocabulary
IS the door's vocabulary at runtime, not a copy of it, and a both-ways pin
fails by name the moment a layer gains a row or loses one.

`source-catalog.ts` has nothing to be set-equal to. Its rows are prose about
the outside world. Welding the two together would have put both under one green
light, earned by the half that can prove itself and spent on the half that
cannot.

### What the rows say, and what they refuse to say

Every row carries one plain sentence (`words`), a `source`, a `cadence`, a
`licence`, a `status` and a `sourceUrl`. No field is ever the word "unknown":
"unknown" is non-empty, so it passes a not-empty check while proving nobody
looked. The test bans the bare word, and `status` carries the real answer:

| status | means |
|---|---|
| `live` | wired to a named upstream, with no evidence in the code that it fails |
| `dead` | wired into the app and provably broken: the route is missing, or nothing reads the id |
| `render_only` | a drawing toggle with no data behind it by design |
| `unsourced` | real data ships, hardcoded here, with no upstream |
| `catalogued` | a real upstream is named and nothing here fetches it yet |

**`status` is a reading of the code, not a health check.** No feed was called
when these rows were written. `live` does not mean anyone watched it answer,
and a consumer that needs real availability must measure it rather than read it
off this field. `dead` is the one status backed by hard evidence, because a
missing route and an unread id are both visible in the source.

### What cataloguing the layers turned up

Three of the 34 layers the control door accepts do not work, and nothing in the
app said so before these rows did:

- **`balloons`** and **`radiation`** are fetched every five minutes against
  `/api/balloons` and `/api/radiation`, and neither route exists.
- **`war_alerts`** is read by nothing at all. No component, effect or route
  references it; its only appearances in `src/` are its own boot default and
  its catalogue row. The door accepts it and acks a change that cannot happen.

All three are also among the six layer ids with no toggle in the layer panel
(`balloons`, `radiation`, `war_alerts`, `cables`, `sdk_air`, `sdk_naval`), so
the door can switch on layers an operator has no visible way to switch off.

Three more layers draw real data from a constant committed to this repo rather
than from any upstream: the **ports** on the maritime layer, the **nuclear
sites** on the infrastructure layer, and the **news channels** on the live news
layer. None of those constants records where its contents came from.

And **GDACS is fetched twice**, from the same URL, into two different layers:
`api/gdelt/route.ts` serves it as `global_incidents` despite the route name,
and `api/weather/route.ts` fetches it again for `weather`, deliberately
dropping the earthquake and wildfire types because other layers carry them.

### Licences are recorded, not resolved

Most rows say the licence is **not recorded in this repo**, because it is not.
That is the true statement, and it is deliberately not dressed up as one. No
data licence is resolved on this leg, including the Global Energy Monitor terms
that must be read before any GEM data lands. That reading is 313-24 and it has
not happened.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

**🛠️ SUPPORT THE OSIRIS PROJECT**
The OSIRIS Global Intelligence Grid is entirely open-source, but running the backend scanners and data firehoses isn't cheap.

If you want to help keep the servers alive, and support us to get access to better tools  unlock the **Special OSIRIS Console**, Currently Just a Cool UI. a you can officially support the project here : 

🔗 [Support OSIRIS on Patreon](https://www.patreon.com/posts/159077425)

*Supporters receive the `🔴 RedTeam Console` role and access to encrypted developer comms.*


**Built by [simplifaisoul](https://github.com/simplifaisoul)**

[Join our Discord to be a part of this movement!](https://discord.gg/umBykEpb98)

</div>
