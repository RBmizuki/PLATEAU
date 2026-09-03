import type { RateTable } from './types.js';

/**
 * 既定単価表(暫定値)。
 * docs/pricing-model.md の統合仕様で確定した値に差し替える。金額は円(税抜)。
 * 出典ラベル: [公表相場] 業界サイト等の概算 / [仮定] / [報告書アンカーから逆算]
 */
export const DEFAULT_RATE_TABLE: RateTable = {
  id: 'public-2026-estimate',
  label: '公表相場ベースの概算(2026)',
  note: '事業者の実勢値に差し替え可能。数字はすべて概算。',
  scaffold: {
    mobilizationPerSite: 23_000, // [報告書アンカーから逆算]
    perWallSqm: 420, // [報告書アンカーから逆算](単独の足場 12 万円 ÷ 外壁 ≈ 230 m²)
    minimumPerHouse: 60_000, // [仮定]
    relocationMaxGapMeters: 1.5, // [仮定] 手渡しで足場材を移せる隣棟間隔
    relocationFactor: 0.6, // [仮定] 連棟移設で組立・解体の 4 割が浮く
    storeyHeightMeters: 3.0, // [仮定]
  },
  vehicle: {
    dayCost: { kei: 25_000, '2t': 45_000, '4t': 65_000 }, // [公表相場] チャーター相場の概算
    panelCapacity: { kei: 24, '2t': 64, '4t': 128 }, // [仮定] 架台込みの実効積載
    minRoadWidth: { kei: 0, '2t': 2.7, '4t': 4.0 }, // [仮定] 接道 4m 規定と車幅から
    slopePercentDowngrade: 10, // [仮定]
  },
  disposal: {
    perPanel: 1_500, // [公表相場] パネル処分費の概算
    transportPerTrip: 35_000, // [公表相場] 処分場往復・マニフェストの概算
  },
  labor: {
    electricalPerHouse: 30_000, // [公表相場]
    removalPerPanel: 2_000, // [公表相場]
    roofRepairPerHouse: 25_000, // [公表相場]
    crewMobilizationPerDay: 20_000, // [仮定]
    housesPerCrewDay: 2, // [仮定]
  },
  kwPerPanel: 0.25, // [公表相場] 2013 年前後の住宅用パネル
  defaultCapacityKw: 4, // [公表相場] 住宅用の平均的な容量
  leadFeeRate: 0.05, // [報告書アンカー]
};
