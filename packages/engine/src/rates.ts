import type { RateProvenance, RateTable } from './types.js';

/**
 * 既定単価表 `public-2026-estimate`(docs/pricing-model.md §2 と完全一致)。
 * 金額は円・税抜。4kW = 16 枚 = 1 山、2t 車 = 4 山(64 枚)= 1 台、班 = 2 軒/日。
 * 各値の出所は provenance(§2 の出所表)。事業者値に差し替えるときは JSON を丸ごと交換する。
 */
export const DEFAULT_RATE_PROVENANCE: Record<string, RateProvenance> = {
  'scaffold.mobilizationPerSite': { label: '公表相場', source: '足場業者・外装塗装見積サイトの「足場運搬費」。束(街区)あたり 1 回として割り勘', range: [15_000, 40_000] },
  'scaffold.perWallSqm': { label: '報告書アンカーから逆算', source: '単独足場 12 万 − 搬入 2 万 = 10 万 ÷ 標準壁面積 192 m²(外周 32 m × 2 階 × 3.0 m)。公表相場 700〜1,000 円/m²(架面積)を壁面積換算した 540〜770 の下端', range: [540, 770] },
  'scaffold.minimumPerHouse': { label: '仮定', source: '平屋・小規模でも屋根足場+昇降設備の最低請負額。移設係数を掛ける前に適用', range: [50_000, 80_000] },
  'scaffold.relocationMaxGapMeters': { label: '仮定', source: '民法 234 条の離隔 50 cm × 2 + 足場幅 0.9 m ≒ 1.9 m。隙間 ≤ 2 m なら間隙の 1 列足場が両家の対向壁を兼ねる。要ヒアリング', range: [1.5, 3.0] },
  'scaffold.relocationFactor': { label: '報告書アンカーから逆算', source: '12 軒の足場 6 万(50% 減): (60,000 − 20,000/12) / 99,840 = 0.584。物理分解 共有面 ×0.75 × 直移設 ×0.80 = 0.60 と整合。要ヒアリング', range: [0.55, 0.7] },
  'scaffold.storeyHeightMeters': { label: '公表相場', source: '木造戸建ての標準階高(住宅メーカー公開仕様)。measuredHeight があれば優先', range: [2.8, 3.0] },
  'vehicle.dayCost.kei': { label: '公表相場', source: '産廃収集運搬 軽トラック(運転手込)日極。1 台 = 1 トリップ', range: [25_000, 35_000] },
  'vehicle.dayCost.2t': { label: '公表相場', source: '産廃収集運搬許可業者の 2t 平ボディ 日極(運転手込)。+ 運搬 2 万 = 1 台日 8 万 ≒ 報告書の 7.8 万', range: [50_000, 70_000] },
  'vehicle.dayCost.4t': { label: '公表相場', source: '4t 平ボディ 日極(2t の約 1.4 倍)', range: [75_000, 100_000] },
  'vehicle.panelCapacity.kei': { label: '仮定', source: '最大積載 350 kg ÷ 27 kg/枚(パネル 19 kg + 架台按分 8 kg)≒ 13 → 12' },
  'vehicle.panelCapacity.2t': { label: '報告書アンカーから逆算', source: '12 軒 192 枚 = 3 台・13 軒 208 枚 = 4 台 ⇒ 64 ≤ cap < 69.3。重量 64 × 27 kg ≒ 1.73 t < 2 t' },
  'vehicle.panelCapacity.4t': { label: '仮定', source: '荷台 6.2 × 2.1 m に 8 山、約 3.5 t < 4 t。2t の 2 倍' },
  'vehicle.minRoadWidth.kei': { label: '仮定', source: '軽トラ幅 1.48 m + 余裕(下限の記録)' },
  'vehicle.minRoadWidth.2t': { label: '公表相場', source: '建築基準法 42 条の接道 4 m。2t 幅 1.9 m で停車 + 片側通行が残る実用下限' },
  'vehicle.minRoadWidth.4t': { label: '仮定', source: '4t 幅 2.3〜2.5 m + 荷役・対向。PLATEAU widthType の区分境界(5.5 m)に揃えた' },
  'vehicle.slopePercentDowngrade': { label: '仮定', source: '勾配 10%(約 5.7°)以上は積載車の停車・荷役が危険。道路構造令の最急縦断勾配 9〜12% を参照' },
  'disposal.perPanel': { label: '公表相場', source: '太陽光パネル中間処理・リサイクル受入(処理業者の公表価格帯)。架台のアルミは有価で相殺', range: [1_000, 2_000] },
  'disposal.transportPerTrip': { label: '公表相場', source: '処分場往復の燃料・通行料 + 受入手数料 + マニフェスト事務', range: [15_000, 25_000] },
  'labor.electricalPerHouse': { label: '公表相場', source: '系統切離し・パワコン撤去の下端寄り。移動・拘束分は crewMobilizationPerDay 側に分離', range: [20_000, 40_000] },
  'labor.removalPerPanel': { label: '公表相場', source: 'パネル・架台取外し(足場・班出動を別計上した純作業分)', range: [1_000, 2_500] },
  'labor.roofRepairPerHouse': { label: '公表相場', source: '架台跡のビス穴コーキング・板金補修', range: [10_000, 30_000] },
  'labor.crewMobilizationPerDay': { label: '報告書アンカーから逆算', source: '12 軒 19 万と 13 軒目 +0.6 万の妥協点 3T/4 + C/2 = 76,000 から C = 32,000。検算 3 人 × 3.5 h × 3,000 円/h + 車両' },
  'labor.housesPerCrewDay': { label: '仮定', source: '足場先行なら 4kW 1 軒 ≒ 3.5 h → 3 人班で午前・午後 2 軒。要ヒアリング', range: [1.5, 3] },
  kwPerPanel: { label: '公表相場', source: '2012〜15 年設置の住宅用結晶シリコン 200〜250 W/枚(メーカーカタログ)' },
  defaultCapacityKw: { label: '公表相場', source: '住宅用の平均 4〜5 kW(JPEA 統計)。報告書の主人公と一致' },
  leadFeeRate: { label: '仮定', source: '報告書記載の成約手数料 5%。監査第 3 層「検証不能・要ヒアリング」' },
};

export const DEFAULT_RATE_TABLE: RateTable = {
  id: 'public-2026-estimate',
  label: '公表相場ベースの概算(2026)— 報告書アンカー整合版',
  note: '税抜・円。4kW=16枚=1山、2t車=4山(64枚)=1台、班=2軒/日。事業者の実勢値に差し替え可能。各値の出所は docs/pricing-model.md §2 の出所表。',
  scaffold: {
    mobilizationPerSite: 20_000,
    perWallSqm: 520,
    minimumPerHouse: 60_000,
    relocationMaxGapMeters: 2.0,
    relocationFactor: 0.58,
    storeyHeightMeters: 3.0,
  },
  vehicle: {
    dayCost: { kei: 30_000, '2t': 60_000, '4t': 85_000 },
    panelCapacity: { kei: 12, '2t': 64, '4t': 128 },
    minRoadWidth: { kei: 2.0, '2t': 4.0, '4t': 5.5 },
    slopePercentDowngrade: 10,
  },
  disposal: {
    perPanel: 1_500,
    transportPerTrip: 20_000,
  },
  labor: {
    electricalPerHouse: 25_000,
    removalPerPanel: 1_500,
    roofRepairPerHouse: 15_000,
    crewMobilizationPerDay: 32_000,
    housesPerCrewDay: 2,
  },
  kwPerPanel: 0.25,
  defaultCapacityKw: 4,
  leadFeeRate: 0.05,
  provenance: DEFAULT_RATE_PROVENANCE,
};
