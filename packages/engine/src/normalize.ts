import type { Building, LngLat } from './types.js';
import { closeRing, localProjector, ringArea, ringCentroid, ringPerimeter } from './geometry.js';

export type BuildingInput = Omit<Building, 'centroid' | 'footprintArea' | 'perimeter'> &
  Partial<Pick<Building, 'centroid' | 'footprintArea' | 'perimeter'>>;

/**
 * 底面リングから重心・面積・外周長を算出して Building を完成させる。
 * footprint は WGS84 (lon, lat)。閉じていなければ閉じる。
 */
export function normalizeBuilding(input: BuildingInput): Building {
  const footprint = closeRing(input.footprint);
  if (footprint.length < 4) {
    throw new Error(`building ${input.id}: footprint needs at least 3 distinct vertices`);
  }
  const origin: LngLat = footprint[0]!;
  const { toXY, toLngLat } = localProjector(origin);
  const xy = footprint.map(toXY);
  const centroid = toLngLat(ringCentroid(xy));
  return {
    ...input,
    footprint,
    centroid,
    footprintArea: ringArea(xy),
    perimeter: ringPerimeter(xy),
  };
}

/** 建物の外壁面積 [m^2] = 外周 × 高さ(階数×階高 or 実測高)。 */
export function wallAreaSqm(b: Building, storeyHeightMeters: number): number {
  const height = buildingHeightMeters(b, storeyHeightMeters);
  return b.perimeter * height;
}

export function buildingHeightMeters(b: Building, storeyHeightMeters: number): number {
  if (b.measuredHeight && b.measuredHeight > 0) return b.measuredHeight;
  const storeys = b.storeysAboveGround && b.storeysAboveGround > 0 ? b.storeysAboveGround : 2;
  return storeys * storeyHeightMeters;
}
