import type { Building, LngLat, RateTable, Road, VehicleClass } from './types.js';
import { localProjector, pointRingDistance, ringArea, ringPerimeter } from './geometry.js';

/**
 * uro:RoadStructureAttribute/widthType のコード → 代表幅員 [m]。
 * PLATEAU の codelist(RoadStructureAttribute_widthType)は幅員区分を表す。
 * 区分の境界は都市計画基礎調査の慣用(3m / 5.5m / 13m / 19.5m)に合わせた代表値。
 * uro:width が無い都市での退避用。事業者値・都市ごとに差し替え可能。
 * [仮定] 境界値は公式 codelist で要確認。
 */
export const WIDTH_TYPE_REPRESENTATIVE_METERS: Record<string, number> = {
  '1': 2.5, // 3.0m 未満
  '2': 4.0, // 3.0m 以上 5.5m 未満
  '3': 8.0, // 5.5m 以上 13.0m 未満
  '4': 16.0, // 13.0m 以上 19.5m 未満
  '5': 22.0, // 19.5m 以上
};

export type WidthSource = 'uro:width' | 'uro:widthType' | 'lod1-geometry' | 'unknown';

/** 道路の実効幅員 [m] と、その根拠。 */
export function effectiveRoadWidth(road: Road): { width: number | undefined; source: WidthSource } {
  if (road.width !== undefined && road.width > 0) return { width: road.width, source: 'uro:width' };
  if (road.widthType !== undefined) {
    const w = WIDTH_TYPE_REPRESENTATIVE_METERS[road.widthType];
    if (w !== undefined) return { width: w, source: 'uro:widthType' };
  }
  const geom = estimateWidthFromPolygons(road.polygons);
  if (geom !== undefined) return { width: geom, source: 'lod1-geometry' };
  return { width: undefined, source: 'unknown' };
}

/**
 * LOD1 面から幅員を推定する。細長い多角形では 幅 ≈ 2A / P(A: 面積, P: 周長)。
 * 交差点などの塊状の面では過大になるため、最小値を採る。
 */
export function estimateWidthFromPolygons(polygons: readonly LngLat[][]): number | undefined {
  let best: number | undefined;
  for (const ring of polygons) {
    if (ring.length < 4) continue;
    const { toXY } = localProjector(ring[0]!);
    const xy = ring.map(toXY);
    const a = ringArea(xy);
    const p = ringPerimeter(xy);
    if (p <= 0) continue;
    const w = (2 * a) / p;
    if (best === undefined || w < best) best = w;
  }
  return best;
}

export interface NearestRoad {
  road: Road;
  distanceMeters: number;
  width: number | undefined;
  widthSource: WidthSource;
}

/** 点に最も近い道路(LOD1 面の辺までの距離)。 */
export function nearestRoad(point: LngLat, roads: readonly Road[]): NearestRoad | undefined {
  if (roads.length === 0) return undefined;
  const { toXY } = localProjector(point);
  const p = toXY(point);
  let best: NearestRoad | undefined;
  for (const road of roads) {
    let d = Infinity;
    for (const ring of road.polygons) {
      const xy = ring.map(toXY);
      d = Math.min(d, pointRingDistance(p, xy));
    }
    if (!best || d < best.distanceMeters) {
      const w = effectiveRoadWidth(road);
      best = { road, distanceMeters: d, width: w.width, widthSource: w.source };
    }
  }
  return best;
}

export interface VehicleDecision {
  vehicleClass: VehicleClass;
  reason: string;
}

const ORDER: VehicleClass[] = ['kei', '2t', '4t'];

/** 道路幅員と斜面から車格を決める。幅員が不明なら最も保守的な車格。 */
export function classifyVehicle(
  roadWidth: number | undefined,
  slopePercent: number | undefined,
  rt: RateTable,
  widthSource: WidthSource = 'unknown',
): VehicleDecision {
  if (roadWidth === undefined) {
    return { vehicleClass: 'kei', reason: '接道の幅員が不明のため軽トラ想定' };
  }
  let cls: VehicleClass = 'kei';
  for (const c of ORDER) {
    if (roadWidth >= rt.vehicle.minRoadWidth[c]) cls = c;
  }
  let reason = `接道幅員 ${roadWidth.toFixed(1)}m(${widthSource})→ ${label(cls)}`;
  if (slopePercent !== undefined && slopePercent >= rt.vehicle.slopePercentDowngrade) {
    const idx = ORDER.indexOf(cls);
    if (idx > 0) {
      cls = ORDER[idx - 1]!;
      reason += `、勾配 ${slopePercent.toFixed(0)}% の斜面地のため 1 段落として ${label(cls)}`;
    }
  }
  return { vehicleClass: cls, reason };
}

export function label(c: VehicleClass): string {
  return c === '4t' ? '4t車' : c === '2t' ? '2t車' : '軽トラック';
}

/**
 * 街区(建物群)の車格を決める。各建物の最寄り道路のうち「最も狭い接道」で判定する
 * (束の全戸に同じ車両が入れることが条件)。
 */
export function decideBundleVehicle(
  buildings: readonly Building[],
  roads: readonly Road[],
  rt: RateTable,
): VehicleDecision & { narrowestRoadId?: string; roadWidth?: number } {
  let narrowest: NearestRoad | undefined;
  let maxSlope: number | undefined;
  for (const b of buildings) {
    const nr = nearestRoad(b.centroid, roads);
    if (nr && nr.width !== undefined && (!narrowest || narrowest.width === undefined || nr.width < narrowest.width)) {
      narrowest = nr;
    } else if (nr && !narrowest) {
      narrowest = nr;
    }
    if (b.groundSlopePercent !== undefined && (maxSlope === undefined || b.groundSlopePercent > maxSlope)) {
      maxSlope = b.groundSlopePercent;
    }
  }
  const decision = classifyVehicle(narrowest?.width, maxSlope, rt, narrowest?.widthSource);
  return { ...decision, narrowestRoadId: narrowest?.road.id, roadWidth: narrowest?.width };
}
