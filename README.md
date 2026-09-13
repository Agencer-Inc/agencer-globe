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
| `open_camera` | `cameraId: string` | Opens that CCTV feed and flies to it |

`fly_to` takes **coordinates only**. The door does not geocode: resolving a
place name is a 20-second worst case against an external service, and the
caller already knows where it is pointing. Resolve `place` to `lat`/`lng`
before you send.

Layer ids are the keys of the app's own layer state (34 of them, including
`terrain_3d` and `terrain_elevation` — there is no plain `terrain`). The door
validates against the live set rather than a frozen copy, so adding a layer to
the app adds it to the door.

### The ack

Every message from an allowlisted origin is answered, posted back to the sender
and targeted at its origin, never `*`:

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

An ack means the verb was accepted and dispatched this tick, not that the
picture has settled: `fly_to` starts a 2000ms animation and returns before it
finishes.

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
