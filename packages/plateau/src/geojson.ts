import type { Building, Road } from '@ashiba/engine';

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id?: string;
    geometry: { type: 'Polygon'; coordinates: [number, number][][] };
    properties: Record<string, unknown>;
  }>;
}

/** MapLibre の fill-extrusion 用に建物を GeoJSON 化する。高さ [m] を properties.height に入れる。 */
export function buildingsToGeoJSON(buildings: readonly Building[], storeyHeight = 3.0): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: buildings.map((b) => ({
      type: 'Feature',
      id: b.id,
      geometry: { type: 'Polygon', coordinates: [b.footprint] },
      properties: {
        id: b.id,
        height: b.measuredHeight ?? (b.storeysAboveGround ?? 2) * storeyHeight,
        base: 0,
        yearOfConstruction: b.yearOfConstruction ?? null,
        storeysAboveGround: b.storeysAboveGround ?? null,
        usage: b.usage ?? null,
        address: b.address ?? null,
        floodDepth: b.floodDepth ?? null,
        groundSlopePercent: b.groundSlopePercent ?? null,
        footprintArea: Math.round(b.footprintArea * 10) / 10,
      },
    })),
  };
}

export function roadsToGeoJSON(roads: readonly Road[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.flatMap((r) =>
      r.polygons.map((p, i) => ({
        type: 'Feature' as const,
        id: r.polygons.length > 1 ? `${r.id}#${i}` : r.id,
        geometry: { type: 'Polygon' as const, coordinates: [p] },
        properties: {
          id: r.id,
          width: r.width ?? null,
          numberOfLanes: r.numberOfLanes ?? null,
          widthType: r.widthType ?? null,
        },
      })),
    ),
  };
}
