/**
 * PLATEAU CityGML (i-UR 拡張) の最小パーサ。
 *
 * 対象:
 * - bldg:Building LOD1 (lod1Solid / lod0FootPrint / lod0RoofEdge)
 *   bldg:yearOfConstruction, bldg:storeysAboveGround, bldg:measuredHeight,
 *   bldg:usage, bldg:address(xAL), uro:BuildingRiverFloodingRiskAttribute
 * - tran:Road LOD1 (lod1MultiSurface) + uro:RoadStructureAttribute
 *
 * 座標参照系は EPSG:6697(JGD2011 緯度経度 + 標高)。posList は「緯度 経度 高さ」の
 * 3 つ組で並ぶため、(lon, lat) に並べ替えて返す。
 *
 * 名前空間接頭辞は PLATEAU の慣用(bldg, tran, uro, gml, xAL ...)に依存せず、
 * ローカル名で照合する。
 */
import { XMLParser } from 'fast-xml-parser';
import { normalizeBuilding, type Building, type LngLat, type Road } from '@ashiba/engine';

type Node = Record<string, unknown>;

export interface ParsedCityGML {
  buildings: Building[];
  roads: Road[];
  /** 解析で読み飛ばした要素の理由(デバッグ用)。 */
  warnings: string[];
}

export interface ParseOptions {
  /** 住宅用途コードだけを残す場合に指定(例: ['411', '412', '413', '414'])。 */
  usageFilter?: readonly string[];
  /** srsDimension(既定 3)。2 なら「緯度 経度」の 2 つ組として読む。 */
  srsDimension?: 2 | 3;
  /** widthType コード → 代表幅員 [m](同梱 codelist から。codelist.ts を参照)。 */
  widthTypeMeters?: Readonly<Record<string, number>>;
}

const ARRAY_TAGS = new Set([
  'cityObjectMember',
  'surfaceMember',
  'LocalityName',
  'DependentLocalityName',
  'ThoroughfareName',
  'PremiseName',
  'buildingDisasterRiskAttribute',
  'genericAttribute',
  'stringAttribute',
  'intAttribute',
  'doubleAttribute',
  'measureAttribute',
  'roadStructureAttribute',
  'polygonMember',
  'interior',
]);

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => ARRAY_TAGS.has(name),
  });
}

/** テキストノードを取り出す(属性付き要素は '#text')。 */
function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const t = (node as Node)['#text'];
    if (typeof t === 'string' || typeof t === 'number') return String(t);
  }
  return undefined;
}

function numOf(node: unknown): number | undefined {
  const t = textOf(node);
  if (t === undefined || t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 深さ優先で最初に見つかったローカル名の要素を返す。 */
function findFirst(node: unknown, localName: string, depth = 0): unknown {
  if (depth > 40 || node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findFirst(item, localName, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const n = node as Node;
  if (localName in n) return n[localName];
  for (const key of Object.keys(n)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const r = findFirst(n[key], localName, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** 深さ優先で全てのローカル名一致要素を集める。 */
function findAll(node: unknown, localName: string, out: unknown[] = [], depth = 0): unknown[] {
  if (depth > 40 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, localName, out, depth + 1);
    return out;
  }
  const n = node as Node;
  for (const key of Object.keys(n)) {
    if (key.startsWith('@_') || key === '#text') continue;
    if (key === localName) {
      for (const v of asArray(n[key])) out.push(v);
    } else {
      findAll(n[key], localName, out, depth + 1);
    }
  }
  return out;
}

interface Ring3D {
  /** [lon, lat, h] */
  points: [number, number, number][];
}

function parsePosList(text: string, dim: 2 | 3): Ring3D {
  const nums = text
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map(Number);
  const points: [number, number, number][] = [];
  for (let i = 0; i + dim - 1 < nums.length; i += dim) {
    const lat = nums[i]!;
    const lon = nums[i + 1]!;
    const h = dim === 3 ? nums[i + 2]! : 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push([lon, lat, h]);
  }
  return { points };
}

/** Polygon ノードから外周リングを読む。 */
function polygonExteriorRing(polygon: unknown, dim: 2 | 3): Ring3D | undefined {
  const exterior = findFirst(polygon, 'exterior');
  const posList = findFirst(exterior ?? polygon, 'posList');
  const text = textOf(posList);
  if (!text) {
    // gml:pos の列で書かれている場合
    const pos = findAll(exterior ?? polygon, 'pos');
    if (pos.length === 0) return undefined;
    const joined = pos.map((p) => textOf(p) ?? '').join(' ');
    return parsePosList(joined, dim);
  }
  const srs = (posList as Node | undefined)?.['@_srsDimension'];
  const d = srs === '2' ? 2 : srs === '3' ? 3 : dim;
  return parsePosList(text, d);
}

function meanHeight(ring: Ring3D): number {
  if (ring.points.length === 0) return 0;
  return ring.points.reduce((s, p) => s + p[2], 0) / ring.points.length;
}

function toLngLatRing(ring: Ring3D): LngLat[] {
  return ring.points.map((p) => [p[0], p[1]] as LngLat);
}

/** LOD1 立体から底面(最も低い面)の外周を取り出す。 */
function buildingFootprint(b: Node, dim: 2 | 3): { ring: LngLat[]; groundHeight: number } | undefined {
  const candidates: unknown[] = [];
  for (const key of ['lod0FootPrint', 'lod1Solid', 'lod0RoofEdge', 'lod1MultiSurface']) {
    const g = b[key];
    if (g !== undefined) candidates.push(g);
  }
  let best: { ring: Ring3D; h: number } | undefined;
  for (const geom of candidates) {
    const polygons = findAll(geom, 'Polygon');
    for (const poly of polygons) {
      const ring = polygonExteriorRing(poly, dim);
      if (!ring || ring.points.length < 4) continue;
      const h = meanHeight(ring);
      // 面が水平か(高さのばらつきが小さいか)
      const zs = ring.points.map((p) => p[2]);
      const flat = Math.max(...zs) - Math.min(...zs) < 0.5;
      if (!flat) continue;
      if (!best || h < best.h) best = { ring, h };
    }
    if (best) break; // 優先順位の高い幾何で見つかれば終了
  }
  if (!best) return undefined;
  return { ring: toLngLatRing(best.ring), groundHeight: best.h };
}

function parseAddress(b: Node): string | undefined {
  const addr = b['address'];
  if (!addr) return undefined;
  const parts: string[] = [];
  for (const tag of ['CountryName', 'LocalityName', 'DependentLocalityName', 'ThoroughfareName', 'PremiseName']) {
    for (const n of findAll(addr, tag)) {
      const t = textOf(n);
      if (t && t !== '日本') parts.push(t);
    }
  }
  if (parts.length === 0) {
    const t = textOf(findFirst(addr, 'LocalityName')) ?? textOf(findFirst(addr, 'AddressDetails'));
    return t;
  }
  return parts.join('');
}

function parseFloodDepth(b: Node): number | undefined {
  const risks = findAll(b, 'BuildingRiverFloodingRiskAttribute');
  let depth: number | undefined;
  for (const r of risks) {
    const d = numOf(findFirst(r, 'depth'));
    if (d !== undefined && (depth === undefined || d > depth)) depth = d;
  }
  return depth;
}

function parseBuilding(node: Node, opts: ParseOptions, warnings: string[]): Building | undefined {
  const id = (node['@_id'] as string | undefined) ?? (node['@_gml:id'] as string | undefined) ?? '';
  const dim = opts.srsDimension ?? 3;
  const fp = buildingFootprint(node, dim);
  if (!fp) {
    warnings.push(`building ${id || '(no id)'}: no LOD0/LOD1 footprint`);
    return undefined;
  }
  if (fp.ring.length < 4) {
    warnings.push(`building ${id}: degenerate footprint`);
    return undefined;
  }
  const usage = textOf(node['usage']);
  if (opts.usageFilter && usage !== undefined && !opts.usageFilter.includes(usage)) return undefined;
  const year = numOf(node['yearOfConstruction']);
  const storeys = numOf(node['storeysAboveGround']);
  const height = numOf(node['measuredHeight']);
  try {
    return normalizeBuilding({
      id,
      footprint: fp.ring,
      yearOfConstruction: year !== undefined && year > 0 ? year : undefined,
      storeysAboveGround: storeys,
      measuredHeight: height,
      usage,
      address: parseAddress(node),
      groundElevation: fp.groundHeight,
      floodDepth: parseFloodDepth(node),
    });
  } catch (e) {
    warnings.push(`building ${id}: ${(e as Error).message}`);
    return undefined;
  }
}

function parseRoad(node: Node, opts: ParseOptions, warnings: string[]): Road | undefined {
  const id = (node['@_id'] as string | undefined) ?? '';
  const dim = opts.srsDimension ?? 3;
  const polygons: LngLat[][] = [];
  for (const key of ['lod1MultiSurface', 'lod0Network', 'lod2MultiSurface']) {
    const g = node[key];
    if (g === undefined) continue;
    for (const poly of findAll(g, 'Polygon')) {
      const ring = polygonExteriorRing(poly, dim);
      if (ring && ring.points.length >= 4) polygons.push(toLngLatRing(ring));
    }
    if (polygons.length > 0) break;
  }
  if (polygons.length === 0) {
    warnings.push(`road ${id || '(no id)'}: no LOD1 surface`);
    return undefined;
  }
  const attrs = findAll(node, 'RoadStructureAttribute');
  let width: number | undefined;
  let lanes: number | undefined;
  let widthType: string | undefined;
  for (const a of attrs) {
    const w = numOf(findFirst(a, 'width'));
    if (w !== undefined && (width === undefined || w > width)) width = w;
    const l = numOf(findFirst(a, 'numberOfLanes'));
    if (l !== undefined && (lanes === undefined || l > lanes)) lanes = l;
    widthType ??= textOf(findFirst(a, 'widthType'));
  }
  const fn = textOf(node['function']);
  const widthTypeMeters = widthType !== undefined ? opts.widthTypeMeters?.[widthType] : undefined;
  return { id, polygons, width, numberOfLanes: lanes, widthType, widthTypeMeters, function: fn };
}

export interface CoverageStats {
  buildings: number;
  residential: number;
  withYear: number;
  /** 2010〜2016 年築(FIT ブームの窓)。 */
  fitWindow: number;
  yearCoverage: number;
  roads: number;
  roadWidthSource: { 'uro:width': number; 'uro:widthType': number; 'lod1-geometry': number; 'tran:function': number; unknown: number };
}

/** 都市ごとの築年・幅員の充足率(docs/plateau-data.md §2.4 / §4.4)。 */
export function coverageStats(buildings: readonly Building[], roads: readonly Road[], residentialCodes: readonly string[] = ['411', '412', '413', '414']): CoverageStats {
  const resid = buildings.filter((b) => !b.usage || residentialCodes.includes(b.usage));
  const withYear = resid.filter((b) => b.yearOfConstruction !== undefined && b.yearOfConstruction > 1);
  const fit = withYear.filter((b) => b.yearOfConstruction! >= 2010 && b.yearOfConstruction! <= 2016);
  const src: CoverageStats['roadWidthSource'] = { 'uro:width': 0, 'uro:widthType': 0, 'lod1-geometry': 0, 'tran:function': 0, unknown: 0 };
  for (const r of roads) {
    if (r.width !== undefined && r.width > 0) src['uro:width']++;
    else if (r.widthType !== undefined) src['uro:widthType']++;
    else if (r.polygons.some((p) => p.length >= 4)) src['lod1-geometry']++;
    else if (r.function !== undefined) src['tran:function']++;
    else src.unknown++;
  }
  return {
    buildings: buildings.length,
    residential: resid.length,
    withYear: withYear.length,
    fitWindow: fit.length,
    yearCoverage: resid.length > 0 ? Math.round((withYear.length / resid.length) * 1000) / 1000 : 0,
    roads: roads.length,
    roadWidthSource: src,
  };
}

/** CityGML 文字列を解析する。1 ファイル(3 次メッシュ 1 枚)を想定。 */
export function parseCityGML(xml: string, opts: ParseOptions = {}): ParsedCityGML {
  const parser = createParser();
  const doc = parser.parse(xml) as Node;
  const model = (doc['CityModel'] ?? doc) as Node;
  const members = asArray(model['cityObjectMember'] as Node | Node[] | undefined);
  const buildings: Building[] = [];
  const roads: Road[] = [];
  const warnings: string[] = [];
  for (const m of members) {
    for (const b of asArray(m['Building'] as Node | Node[] | undefined)) {
      const parsed = parseBuilding(b, opts, warnings);
      if (parsed) buildings.push(parsed);
    }
    for (const r of asArray(m['Road'] as Node | Node[] | undefined)) {
      const parsed = parseRoad(r, opts, warnings);
      if (parsed) roads.push(parsed);
    }
  }
  return { buildings, roads, warnings };
}
