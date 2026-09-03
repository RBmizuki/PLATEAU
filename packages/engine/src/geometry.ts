/**
 * 幾何ユーティリティ。WGS84 (lon, lat) を局所平面(メートル)に投影して計算する。
 * 街区スケール(数 km 以内)では正距円筒近似で十分。
 */
import type { LngLat } from './types.js';

export type XY = [x: number, y: number];

const EARTH_RADIUS_M = 6_378_137;

/** 原点 origin を基準にした局所メートル座標への投影。 */
export function localProjector(origin: LngLat): {
  toXY: (p: LngLat) => XY;
  toLngLat: (p: XY) => LngLat;
} {
  const [lon0, lat0] = origin;
  const lat0Rad = (lat0 * Math.PI) / 180;
  const cosLat = Math.cos(lat0Rad);
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLon = mPerDegLat * cosLat;
  return {
    toXY: ([lon, lat]) => [(lon - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat],
    toLngLat: ([x, y]) => [lon0 + x / mPerDegLon, lat0 + y / mPerDegLat],
  };
}

/** 2 点間の距離 [m](haversine)。 */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s));
}

/** リングが閉じているか(先頭=末尾)。 */
export function isClosed(ring: readonly XY[] | readonly LngLat[]): boolean {
  if (ring.length < 2) return false;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  return a[0] === b[0] && a[1] === b[1];
}

/** 閉じていなければ閉じる。 */
export function closeRing<T extends XY | LngLat>(ring: readonly T[]): T[] {
  if (ring.length === 0) return [];
  return isClosed(ring) ? [...ring] : [...ring, ring[0]!];
}

/** 符号付き面積(shoelace)。反時計回りが正。 */
export function signedArea(ring: readonly XY[]): number {
  const r = closeRing(ring);
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[i + 1]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function ringArea(ring: readonly XY[]): number {
  return Math.abs(signedArea(ring));
}

export function ringPerimeter(ring: readonly XY[]): number {
  const r = closeRing(ring);
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[i + 1]!;
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

/** 面積重心。退化(面積 0)なら頂点平均。 */
export function ringCentroid(ring: readonly XY[]): XY {
  const r = closeRing(ring);
  const a = signedArea(r);
  if (Math.abs(a) < 1e-9) {
    const n = r.length - 1 || 1;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += r[i]![0];
      sy += r[i]![1];
    }
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const [x1, y1] = r[i]!;
    const [x2, y2] = r[i + 1]!;
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(points: readonly XY[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** bbox 同士の最短距離(重なれば 0)。 */
export function bboxDistance(a: BBox, b: BBox): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(dx, dy);
}

/** 点と線分の最短距離。 */
export function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function orientation(a: XY, b: XY, c: XY): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : -1;
}

function onSegment(a: XY, b: XY, p: XY): boolean {
  return (
    Math.min(a[0], b[0]) - 1e-12 <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    Math.min(a[1], b[1]) - 1e-12 <= p[1] &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12
  );
}

/** 線分同士が交差するか。 */
export function segmentsIntersect(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, a2, b1)) return true;
  if (o2 === 0 && onSegment(a1, a2, b2)) return true;
  if (o3 === 0 && onSegment(b1, b2, a1)) return true;
  if (o4 === 0 && onSegment(b1, b2, a2)) return true;
  return false;
}

/** 線分同士の最短距離。 */
export function segmentSegmentDistance(a1: XY, a2: XY, b1: XY, b2: XY): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/** 点がリング内部にあるか(ray casting)。 */
export function pointInRing(p: XY, ring: readonly XY[]): boolean {
  const r = closeRing(ring);
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length - 1; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    const intersect =
      yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 2 つのリング(外壁面)の最短距離 [m]。重なる・内包する場合は 0。
 * 隣棟間隔 = 足場の連棟移設が効くかの判定に使う。
 */
export function ringRingDistance(a: readonly XY[], b: readonly XY[]): number {
  const ra = closeRing(a);
  const rb = closeRing(b);
  if (ra.length < 2 || rb.length < 2) return Infinity;
  if (pointInRing(ra[0]!, rb) || pointInRing(rb[0]!, ra)) return 0;
  let best = Infinity;
  for (let i = 0; i < ra.length - 1; i++) {
    for (let j = 0; j < rb.length - 1; j++) {
      const d = segmentSegmentDistance(ra[i]!, ra[i + 1]!, rb[j]!, rb[j + 1]!);
      if (d < best) {
        best = d;
        if (best === 0) return 0;
      }
    }
  }
  return best;
}

/** 点からリング(の辺)への最短距離。内部なら 0。 */
export function pointRingDistance(p: XY, ring: readonly XY[]): number {
  if (pointInRing(p, ring)) return 0;
  const r = closeRing(ring);
  let best = Infinity;
  for (let i = 0; i < r.length - 1; i++) {
    best = Math.min(best, pointSegmentDistance(p, r[i]!, r[i + 1]!));
  }
  return best;
}
