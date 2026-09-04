import type { Building, LngLat, RateTable, Road, VehicleClass } from './types.js';
import { localProjector, pointInRing, pointRingDistance, ringArea, ringPerimeter, type XY } from './geometry.js';

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

export type WidthSource = 'uro:width' | 'uro:widthType' | 'lod1-geometry' | 'tran:function' | 'building-gap' | 'unknown';

/** tran:function(Road_function.xml)からの最後の退避。6 = 市区町村道は 4m 級と仮置き。[仮定] */
export const FUNCTION_FALLBACK_METERS: Record<string, number> = { '6': 4.0 };

/** 道路の実効幅員 [m] と、その根拠。 */
export function effectiveRoadWidth(road: Road): { width: number | undefined; source: WidthSource } {
  if (road.width !== undefined && road.width > 0) return { width: road.width, source: 'uro:width' };
  if (road.widthType !== undefined) {
    const w = road.widthTypeMeters ?? WIDTH_TYPE_REPRESENTATIVE_METERS[road.widthType];
    if (w !== undefined) return { width: w, source: 'uro:widthType' };
  }
  const geom = estimateWidthFromPolygons(road.polygons);
  if (geom !== undefined) return { width: geom, source: 'lod1-geometry' };
  if (road.function !== undefined && FUNCTION_FALLBACK_METERS[road.function] !== undefined) {
    return { width: FUNCTION_FALLBACK_METERS[road.function], source: 'tran:function' };
  }
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
  let reason = `接道幅員 ${roadWidth.toFixed(1)}m(${widthSource}${widthSource === 'lod1-geometry' || widthSource === 'tran:function' ? '・幅員未確認' : ''})→ ${label(cls)}`;
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
  /** 道路データが無いときの退避に使う周辺建物(向かい合う外壁間から幅を推定)。 */
  neighborhood?: readonly Building[],
): VehicleDecision & { narrowestRoadId?: string; roadWidth?: number; widthSource?: WidthSource } {
  let narrowest: NearestRoad | undefined;
  let maxSlope: number | undefined;
  if (roads.length === 0 && neighborhood && neighborhood.length > 0) {
    // 家ごとの推定はばらつくので、束では下位 1/4 の値(保守側だが外れ値には引きずられない)を採る
    const widths: number[] = [];
    for (const b of buildings) {
      const e = estimateStreetWidthFromBuildings(b, neighborhood);
      if (e) widths.push(e.width);
      if (b.groundSlopePercent !== undefined && (maxSlope === undefined || b.groundSlopePercent > maxSlope)) maxSlope = b.groundSlopePercent;
    }
    widths.sort((a, b) => a - b);
    const est = widths.length > 0 ? widths[Math.floor((widths.length - 1) * 0.25)] : undefined;
    const d = classifyVehicle(est, maxSlope, rt, 'building-gap');
    return {
      ...d,
      reason: est !== undefined ? `${d.reason}(道路データなし。向かいの建物との間隔からの推定 ${widths.length} 軒の下位 1/4・幅員未確認)` : d.reason,
      roadWidth: est,
      widthSource: est !== undefined ? 'building-gap' : 'unknown',
    };
  }
  for (const b of buildings) {
    let nr = nearestRoad(b.centroid, roads);
    // 区間属性が無い道路では、家の前の弦長(局所幅員)で置き換える
    if (nr && (nr.widthSource === 'lod1-geometry' || nr.widthSource === 'tran:function' || nr.widthSource === 'unknown')) {
      const local = localRoadWidth(b, roads);
      if (local) nr = { ...nr, width: local.width, widthSource: 'lod1-geometry' };
    }
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
  return { ...decision, narrowestRoadId: narrowest?.road.id, roadWidth: narrowest?.width, widthSource: narrowest?.widthSource };
}

/**
 * 建物ごとの局所幅員(docs/plateau-data.md §2.4 推奨)。
 * 底面の各辺の中点から、辺に垂直で建物の外側へ向かう光線を飛ばし、道路面に入った点から出た点までの
 * 弦長を幅員とする。巨大な MultiSurface(町丁目単位)でも「家の前の幅」が測れる。
 * 弦が maxChord を超える(交差点・広場に当たった)場合は棄却する。
 */
export function localRoadWidth(
  building: Building,
  roads: readonly Road[],
  options: { maxReach?: number; maxChord?: number; step?: number } = {},
): { width: number; roadId: string; distance: number } | undefined {
  const maxReach = options.maxReach ?? 15;
  const maxChord = options.maxChord ?? 30;
  const step = options.step ?? 0.25;
  const { toXY } = localProjector(building.centroid);
  const ring = building.footprint.map(toXY);
  const c = toXY(building.centroid);
  const rings = roads.flatMap((r) => r.polygons.map((p) => ({ id: r.id, xy: p.map(toXY) })));
  if (rings.length === 0 || ring.length < 4) return undefined;
  let best: { width: number; roadId: string; distance: number } | undefined;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    // 辺の法線のうち、重心から遠ざかる向き
    let nx = -ey / len;
    let ny = ex / len;
    if ((mx - c[0]) * nx + (my - c[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (const road of rings) {
      let entered: number | undefined;
      let exited: number | undefined;
      for (let t = step; t <= maxReach + maxChord; t += step) {
        const p: XY = [mx + nx * t, my + ny * t];
        const inside = pointInRing(p, road.xy);
        if (entered === undefined) {
          if (inside) entered = t;
          else if (t > maxReach) break;
        } else if (!inside) {
          exited = t;
          break;
        }
      }
      if (entered === undefined) continue;
      if (exited === undefined) continue; // 抜けなかった = 広場や巨大面
      const width = exited - entered;
      if (width > maxChord) continue;
      const distance = entered;
      if (!best || distance < best.distance) best = { width: round(width, 2), roadId: road.id, distance: round(distance, 2) };
    }
  }
  return best;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}


/**
 * 道路データ(tran)が無い都市の退避: 向かい合う建物の外壁間の距離から街路の幅を推定する。
 * 各辺の中点から外向きに光線を飛ばし、最初にぶつかる他の建物までの距離(クリアランス)を測る。
 * 家は通常 1 面だけが街路に面し、残りは隣家・裏の家との狭い隙間なので、
 * **最も開けた面**を街路とみなす(角地は 2 面が開けるが最大値を採るので同じ)。
 * クリアランスが minCorridor 未満、または maxCorridor まで何にも当たらない(空地・データの端)面は使わない。
 * 幅員 ≈ クリアランス − 2 × 後退距離。[仮定] 後退 1.0 m(建築基準法の道路後退・敷際の余白の概算)。
 */
export function estimateStreetWidthFromBuildings(
  building: Building,
  others: readonly Building[],
  options: { minCorridor?: number; maxCorridor?: number; setbackMeters?: number; step?: number } = {},
): { width: number; corridor: number; facingId: string | null } | undefined {
  const minCorridor = options.minCorridor ?? 5.5;
  const maxCorridor = options.maxCorridor ?? 30;
  const setback = options.setbackMeters ?? 1.0;
  const step = options.step ?? 0.5;
  const { toXY } = localProjector(building.centroid);
  const ring = building.footprint.map(toXY);
  const c = toXY(building.centroid);
  const reach = maxCorridor + 30;
  const candidates: Array<{ id: string; xy: XY[] }> = [];
  for (const o of others) {
    if (o.id === building.id) continue;
    const k = Math.cos((building.centroid[1] * Math.PI) / 180) * 111_320;
    if (Math.abs((o.centroid[0] - building.centroid[0]) * k) > reach || Math.abs((o.centroid[1] - building.centroid[1]) * 111_320) > reach) continue;
    candidates.push({ id: o.id, xy: o.footprint.map(toXY) });
  }
  let best: { width: number; corridor: number; facingId: string | null } | undefined;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 3) continue; // 短い辺(出隅)は街路に面していないことが多い
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let nx = -(b[1] - a[1]) / len;
    let ny = (b[0] - a[0]) / len;
    if ((mx - c[0]) * nx + (my - c[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let corridor: number | undefined;
    let facing: string | null = null;
    for (let t = step; t <= maxCorridor; t += step) {
      const p: XY = [mx + nx * t, my + ny * t];
      const hit = candidates.find((o) => pointInRing(p, o.xy));
      if (hit) {
        corridor = t;
        facing = hit.id;
        break;
      }
    }
    // 何にも当たらない面(公園・空地・データの端)は街路とは言えないので使わない
    if (corridor === undefined || corridor < minCorridor) continue;
    if (!best || corridor > best.corridor) {
      const width = Math.max(1.5, corridor - 2 * setback);
      best = { width: Math.round(width * 10) / 10, corridor: Math.round(corridor * 10) / 10, facingId: facing };
    }
  }
  return best;
}
