/**
 * オフラインデモ用の合成街区ジェネレータ。
 *
 * PLATEAU の実データが手元に無くても、同じ型(Building / Road)で
 * 「2012〜2015 年分譲の築年クラスタ」「密集街区と疎な街区」「幅員 3m/4.5m/6m の道路」
 * 「斜面地」「浸水想定区域」を持つ街区を決定的に生成する。
 *
 * 座標は千葉市美浜区付近を例示的に用いる(実在の建物とは無関係)。
 */
import { localProjector, normalizeBuilding, type Building, type LngLat, type Road } from '@ashiba/engine';

export interface FixtureOptions {
  /** 街区の南西隅 (lon, lat)。 */
  origin?: LngLat;
  /** 乱数シード(決定的)。 */
  seed?: number;
}

export interface FixtureBlockSpec {
  key: string;
  /** ブロック南西隅の局所座標 [m]。 */
  x: number;
  y: number;
  /** 1 列あたりの軒数。 */
  housesPerRow: number;
  /** 宅地の間口 [m]。家の幅 = 間口 − 隣棟間隔。 */
  lotWidth: number;
  /** 隣棟間隔 [m]。 */
  gap: number;
  /** 分譲年の範囲。 */
  yearRange: [number, number];
  /** 3 階建ての割合。 */
  threeStoreyRatio: number;
  /** 斜面地なら勾配 [%]。 */
  slopePercent?: number;
  /** 浸水想定深 [m]。 */
  floodDepth?: number;
  /** 町名(住所生成用)。 */
  town: string;
}

export interface FixtureRoadSpec {
  id: string;
  /** 局所座標での矩形 [x, y, 長さ, 幅]。 */
  rect: [number, number, number, number];
  width: number;
  numberOfLanes: number;
  widthType: string;
}

export interface Fixture {
  buildings: Building[];
  roads: Road[];
  meta: {
    origin: LngLat;
    seed: number;
    blocks: FixtureBlockSpec[];
    note: string;
  };
}

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOT_DEPTH = 18; // 宅地の奥行 [m]
const HOUSE_DEPTH = 9; // 家の奥行 [m]
const SETBACK = 2.5; // 道路からの後退 [m]
const ROW_PITCH = LOT_DEPTH * 2; // 背中合わせ 2 列 = 1 ブロックの奥行

export const DEFAULT_BLOCKS: FixtureBlockSpec[] = [
  // 密集した 2012〜2015 年分譲(連棟移設が効く)
  { key: 'A', x: 8, y: 8, housesPerRow: 8, lotWidth: 8.8, gap: 1.2, yearRange: [2012, 2013], threeStoreyRatio: 0.15, town: '真砂三丁目' },
  { key: 'B', x: 88, y: 8, housesPerRow: 8, lotWidth: 8.8, gap: 1.2, yearRange: [2013, 2014], threeStoreyRatio: 0.15, town: '真砂三丁目' },
  { key: 'C', x: 8, y: 52, housesPerRow: 8, lotWidth: 9.0, gap: 1.4, yearRange: [2014, 2015], threeStoreyRatio: 0.2, town: '真砂四丁目' },
  // 幅員 3m の路地に面した密集街区(軽トラのみ)
  { key: 'D', x: 88, y: 52, housesPerRow: 7, lotWidth: 8.4, gap: 0.9, yearRange: [2013, 2014], threeStoreyRatio: 0.35, town: '真砂四丁目' },
  // 疎な郊外型(隣棟 6m: 連棟移設は効かない)
  { key: 'E', x: 176, y: 8, housesPerRow: 5, lotWidth: 14, gap: 6, yearRange: [2013, 2014], threeStoreyRatio: 0, town: '磯辺二丁目' },
  // 斜面地 + 浸水想定
  { key: 'F', x: 176, y: 52, housesPerRow: 5, lotWidth: 12, gap: 4, yearRange: [2012, 2015], threeStoreyRatio: 0.1, slopePercent: 12, floodDepth: 1.5, town: '磯辺二丁目' },
  // 旧い街区(候補から外れることを示す)
  { key: 'G', x: 8, y: 96, housesPerRow: 8, lotWidth: 9.5, gap: 1.6, yearRange: [1992, 1998], threeStoreyRatio: 0.05, town: '真砂五丁目' },
  { key: 'H', x: 88, y: 96, housesPerRow: 7, lotWidth: 9.5, gap: 1.6, yearRange: [2003, 2006], threeStoreyRatio: 0.1, town: '真砂五丁目' },
];

export const DEFAULT_ROADS: FixtureRoadSpec[] = [
  // 東西の幹線(幅 6m, 2 車線)
  { id: 'road-main-s', rect: [0, 0, 260, 6], width: 6, numberOfLanes: 2, widthType: '3' },
  { id: 'road-main-m', rect: [0, 44, 260, 6], width: 6, numberOfLanes: 2, widthType: '3' },
  { id: 'road-main-n', rect: [0, 88, 260, 6], width: 6, numberOfLanes: 2, widthType: '3' },
  { id: 'road-main-nn', rect: [0, 132, 260, 6], width: 6, numberOfLanes: 2, widthType: '3' },
  // 南北の区画道路(幅 4.5m)
  { id: 'road-x-0', rect: [0, 0, 6, 140], width: 4.5, numberOfLanes: 1, widthType: '2' },
  { id: 'road-x-1', rect: [80, 0, 6, 140], width: 4.5, numberOfLanes: 1, widthType: '2' },
  { id: 'road-x-2', rect: [168, 0, 6, 140], width: 4.5, numberOfLanes: 1, widthType: '2' },
  { id: 'road-x-3', rect: [254, 0, 6, 140], width: 4.5, numberOfLanes: 1, widthType: '2' },
  // ブロック D の前の路地(幅 3m: 軽トラのみ)
  { id: 'road-alley-d', rect: [86, 50, 82, 3], width: 3, numberOfLanes: 1, widthType: '2' },
];

export function generateFixture(options: FixtureOptions = {}): Fixture {
  const origin = options.origin ?? ([140.0455, 35.6395] as LngLat);
  const seed = options.seed ?? 20261119;
  const rand = rng(seed);
  const { toLngLat } = localProjector(origin);

  const buildings: Building[] = [];
  let serial = 1;
  for (const block of DEFAULT_BLOCKS) {
    const houseWidth = block.lotWidth - block.gap;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < block.housesPerRow; i++) {
        const x0 = block.x + i * block.lotWidth + block.gap / 2;
        // row 0 は南側の道路に面し、row 1 は北側の道路に面する(背中合わせ)
        const y0 = row === 0 ? block.y + SETBACK : block.y + ROW_PITCH - SETBACK - HOUSE_DEPTH;
        const jitter = (rand() - 0.5) * 0.4;
        const w = houseWidth + jitter;
        const d = HOUSE_DEPTH + (rand() - 0.5) * 1.0;
        const ring: LngLat[] = [
          toLngLat([x0, y0]),
          toLngLat([x0 + w, y0]),
          toLngLat([x0 + w, y0 + d]),
          toLngLat([x0, y0 + d]),
          toLngLat([x0, y0]),
        ];
        const [y1, y2] = block.yearRange;
        const year = y1 + Math.floor(rand() * (y2 - y1 + 1));
        const storeys = rand() < block.threeStoreyRatio ? 3 : 2;
        const id = `bldg-${block.key}-${String(serial).padStart(3, '0')}`;
        const lot = row * block.housesPerRow + i + 1;
        buildings.push(
          normalizeBuilding({
            id,
            footprint: ring,
            yearOfConstruction: year,
            storeysAboveGround: storeys,
            measuredHeight: storeys === 3 ? 9.6 + rand() * 0.6 : 6.6 + rand() * 0.6,
            usage: '411',
            address: `千葉県千葉市美浜区${block.town}${block.key}-${lot}`,
            groundElevation: 3 + (block.slopePercent ? ((x0 - block.x) * block.slopePercent) / 100 : 0),
            groundSlopePercent: block.slopePercent ?? 0.5,
            floodDepth: block.floodDepth,
          }),
        );
        serial++;
      }
    }
  }

  const roads: Road[] = DEFAULT_ROADS.map((r) => {
    const [x, y, len, wid] = r.rect;
    const horizontal = len >= wid;
    const ring: LngLat[] = horizontal
      ? [toLngLat([x, y]), toLngLat([x + len, y]), toLngLat([x + len, y + wid]), toLngLat([x, y + wid]), toLngLat([x, y])]
      : [toLngLat([x, y]), toLngLat([x + len, y]), toLngLat([x + len, y + wid]), toLngLat([x, y + wid]), toLngLat([x, y])];
    return { id: r.id, polygons: [ring], width: r.width, numberOfLanes: r.numberOfLanes, widthType: r.widthType };
  });

  return {
    buildings,
    roads,
    meta: {
      origin,
      seed,
      blocks: DEFAULT_BLOCKS,
      note: '合成データ。座標は千葉市美浜区付近を例示的に用いており実在の建物・世帯とは無関係。',
    },
  };
}
