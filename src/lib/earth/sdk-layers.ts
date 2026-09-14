/**
 * OSIRIS earth server — our own trove, as sdk_ layers.
 *
 * Iris places and Total Recall entities do not get a new door. They come in
 * through the SDK ingest endpoint that already exists (api/sdk/ingest/route.ts),
 * which already key-gates, validates and normalises them, and already parks
 * them in a process-global store shared with the SSE stream (:17-29). This file
 * only reads that store and groups it into query-shaped layers.
 *
 *   POST /api/sdk/ingest  {source:'iris', entities:[...]}   (key-gated, :50-65)
 *          |  normalised to ext-<source>-<id>, source.provider = <source>  (:81, :95)
 *          v
 *   globalThis.sdkEntityStore : Map<string, entity>
 *          |  read-only from here. This module NEVER writes it (Law 19).
 *          v
 *   sdk_<provider>  ── an earth layer with no fetcher and no cache of its own:
 *                      the store IS the cache, in memory, and dies with the
 *                      server exactly as the ingest door already documents.
 *
 * No scheduler row, because there is nothing to poll: entities arrive by push.
 * That is why an sdk_ layer is never `cold` — if the store has it, it is warm
 * by definition, and if it does not, the layer does not exist yet.
 */

import { osirisLayer } from '@/lib/layers-catalog';
import type { EarthItem } from './registry';

/** The shape ingest normalises every entity into (api/sdk/ingest/route.ts:80-109). */
interface SdkEntity {
  id: string;
  name?: string;
  domain?: string;
  entityType?: string;
  position?: { lat?: number; lng?: number; alt?: number; heading?: number; speed?: number };
  threat?: string;
  classification?: string;
  source?: { provider?: string; feed?: string; originalId?: string; confidence?: number };
  timestamp?: string;
}

function store(): Map<string, SdkEntity> {
  const g = globalThis as unknown as { sdkEntityStore?: Map<string, SdkEntity> };
  return g.sdkEntityStore ?? new Map();
}

/** `Total Recall` -> `total_recall`. Stable, lowercase, no punctuation. */
export function sdkLayerId(provider: string): string {
  return 'sdk_' + provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * A provider may NOT claim an id the catalogue already owns.
 *
 * `sdk_sea`, `sdk_air` and `sdk_naval` are real catalogue rows
 * (layers-catalog.ts:405-427, all render_only). Without this rule an ingest
 * whose `source` was "sea" would shadow a real layer id and the door would
 * start answering a drawing mode with somebody's uploaded entities. Ingest is
 * key-gated, so this is not the last line of defence — it is the one that means
 * the door's answer for a catalogue id is always the catalogue's.
 */
export function sdkIdIsClaimable(layerId: string): boolean {
  return layerId.startsWith('sdk_') && osirisLayer(layerId) === undefined;
}

/** Every sdk_ layer the store currently backs, sorted for a stable answer. */
export function sdkLayerIds(): string[] {
  const ids = new Set<string>();
  for (const entity of store().values()) {
    const provider = entity.source?.provider;
    if (!provider) continue;
    const id = sdkLayerId(provider);
    if (sdkIdIsClaimable(id)) ids.add(id);
  }
  return [...ids].sort();
}

/**
 * The entities behind one sdk_ layer, or undefined if no provider backs it.
 *
 * undefined and [] mean different things here and the door depends on the
 * difference: undefined is "no such layer", [] is "that provider ingested and
 * every one of its entities was unusable".
 */
export function sdkLayerItems(layerId: string): EarthItem[] | undefined {
  if (!sdkIdIsClaimable(layerId)) return undefined;

  let matched = false;
  const items: EarthItem[] = [];
  for (const entity of store().values()) {
    const provider = entity.source?.provider;
    if (!provider || sdkLayerId(provider) !== layerId) continue;
    matched = true;

    const lat = entity.position?.lat;
    const lng = entity.position?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    items.push({
      id: entity.id,
      lat,
      lng,
      label: entity.name || entity.id,
      kind: (entity.domain || entity.entityType || 'entity').toLowerCase(),
      props: {
        entityType: entity.entityType,
        threat: entity.threat,
        classification: entity.classification,
        provider,
        confidence: entity.source?.confidence,
        timestamp: entity.timestamp,
        altitude: entity.position?.alt,
        heading: entity.position?.heading,
        speed: entity.position?.speed,
      },
    });
  }

  return matched ? items : undefined;
}
