/**
 * PLATEAU dem(dem:ReliefFeature / dem:TINRelief)から地盤高と勾配を求める。
 *
 * dem:TINRelief/dem:tin/gml:TriangulatedSurface/gml:trianglePatches/gml:Triangle/gml:exterior/gml:LinearRing/gml:posList
 * posList は「緯度 経度 標高」×4(閉じた三角形)。
 *
 * 建物の重心を含む三角形を探し、重心座標で標高を、三角形の平面の勾配で斜度 [%] を返す。
 */
import { XMLParser } from 'fast-xml-parser';
import { localProjector, type Building, type LngLat } from '@ashiba/engine';

export interface Triangle {
  /** [lon, lat, h] × 3 */
  p: [number, number, number][];
}

export interface DemSample {
  elevation: number;
  slopePercent: number;
}

function findAll(node: unknown, localName: string, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 40 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, localName, out, depth + 1);
    return out;
  }
  const n = node as Record<string, unknown>;
  for (const key of Object.keys(n)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const v = n[key];
    if (key === localName) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    } else findAll(v, localName, out, depth + 1);
  }
  return out;
}

function textOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    if (typeof t === 'string') return t;
  }
  return undefined;
}

/** dem の CityGML から三角形を取り出す。 */
export function parseDemTriangles(xml: string): Triangle[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (n) => n === 'Triangle' || n === 'cityObjectMember' });
  const doc = parser.parse(xml);
  const out: Triangle[] = [];
  for (const tri of findAll(doc, 'Triangle')) {
    const text = textOf(findAll(tri, 'posList')[0]);
    if (!text) continue;
    const nums = text.split(/\s+/).filter(Boolean).map(Number);
    if (nums.length < 9) continue;
    const p: [number, number, number][] = [];
    for (let i = 0; i + 2 < nums.length && p.length < 3; i += 3) p.push([nums[i + 1]!, nums[i]!, nums[i + 2]!]);
    if (p.length === 3) out.push({ p });
  }
  return out;
}

/** 三角形集合をグリッド索引つきのサンプラにする。 */
export class DemSampler {
  private readonly toXY: (p: LngLat) => [number, number];
  private readonly tris: Array<{ xy: [number, number][]; z: number[]; minX: number; minY: number; maxX: number; maxY: number }>;
  private readonly grid = new Map<string, number[]>();
  private readonly cell = 50;

  constructor(triangles: readonly Triangle[], origin?: LngLat) {
    const o: LngLat = origin ?? (triangles[0] ? [triangles[0].p[0]![0], triangles[0].p[0]![1]] : [0, 0]);
    this.toXY = localProjector(o).toXY;
    this.tris = triangles.map((t) => {
      const xy = t.p.map((q) => this.toXY([q[0], q[1]]));
      const xs = xy.map((q) => q[0]);
      const ys = xy.map((q) => q[1]);
      return { xy, z: t.p.map((q) => q[2]), minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    });
    this.tris.forEach((t, i) => {
      for (let gx = Math.floor(t.minX / this.cell); gx <= Math.floor(t.maxX / this.cell); gx++) {
        for (let gy = Math.floor(t.minY / this.cell); gy <= Math.floor(t.maxY / this.cell); gy++) {
          const k = `${gx}:${gy}`;
          const list = this.grid.get(k);
          if (list) list.push(i);
          else this.grid.set(k, [i]);
        }
      }
    });
  }

  sample(point: LngLat): DemSample | undefined {
    const [x, y] = this.toXY(point);
    const k = `${Math.floor(x / this.cell)}:${Math.floor(y / this.cell)}`;
    for (const i of this.grid.get(k) ?? []) {
      const t = this.tris[i]!;
      if (x < t.minX || x > t.maxX || y < t.minY || y > t.maxY) continue;
      const [a, b, c] = t.xy as [[number, number], [number, number], [number, number]];
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const elevation = l1 * t.z[0]! + l2 * t.z[1]! + l3 * t.z[2]!;
      // 平面 z = px·x + py·y + q の勾配
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = t.z[1]! - t.z[0]!;
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = t.z[2]! - t.z[0]!;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const slope = Math.abs(nz) < 1e-9 ? 0 : Math.hypot(nx / nz, ny / nz);
      return { elevation: Math.round(elevation * 100) / 100, slopePercent: Math.round(slope * 1000) / 10 };
    }
    return undefined;
  }
}

/** 建物に地盤高・勾配を書き込む(見つからない建物はそのまま)。書き込めた件数を返す。 */
export function applyDem(buildings: Building[], sampler: DemSampler): number {
  let n = 0;
  for (const b of buildings) {
    const s = sampler.sample(b.centroid);
    if (!s) continue;
    b.groundElevation = s.elevation;
    b.groundSlopePercent = s.slopePercent;
    n++;
  }
  return n;
}
