# 段差価格エンジン 価格モデル仕様(統合版)

対象コード: `packages/engine/src/{types.ts, pricing.ts, rates.ts, vehicle.ts, adjacency.ts, normalize.ts}`
対象文書: `final/01-足場の割り勘.md` §2(本文)・§5(監査結果)
状態: 3 案の独立設計を審査・統合した最終仕様。`rates.ts` の `DEFAULT_RATE_TABLE` は本書 §2 の JSON に差し替える。

---

## 0. 3案の審査と統合方針

| 案 | (a) アンカー再現 | (b) 単一モデルで都市/郊外を導出 | (c) 正直な階段 | (d) types.ts への実装性 | (e) 全数値の出所 | 合計 | 一言 |
|---|---|---|---|---|---|---|---|
| 案1 コスト物理ファースト | 8 | 9 | 9 | 8 | 9 | **43** | 割引を「固定費の割り勘」からしか出さない設計が最も筋がよい。13軒目の戻りの解析分解と郊外導出の感度が秀逸。13軒目 −7.3% が惜しい |
| 案2 最小パラメトリック(代数) | 8 | 9 | 8 | 7 | 8 | **40** | どのアンカーがどの係数を決め、どこで衝突するかを最も明快に露出。ただし搬入費 0・班 4軒/日 は代数の都合で物理から離れ、JSONC も型完全一致ではない |
| 案3 班の1週間(事業者視点) | 7 | 8 | 9 | 8 | 10 | **42** | 出所表(ラベル+出所+範囲)が最良。「損益分岐は12軒ではなく4軒」「13だけを正直と呼ぶのは不正直」という製品洞察が重要。13軒目 −11.9% と単独 −1.2% が弱い |

**統合方針:** 案1 を土台に、案3 の出所表形式・「1山=16枚 / 2t=4山 / 班=2軒/日」の物理単位・最低額を係数の前に適用する規則・製品洞察を、案2 の「アンカー→係数」対応表と過剰決定の指摘を移植した。単価は 3 案のいずれとも一致せず、**12軒 −3.4% と 13軒目 +5,718(−4.7%)を同時に ±5% に収める点**(3案とも片方が外れていた)で再較正した。

---

## 1. モデルの式(費目ごと)と記号表

### 1.1 記号表

| 記号 | 意味 | RateTable / 入力の対応 |
|---|---|---|
| B | 束(同じ週の共同撤去枠に入る軒の集合)、n = \|B\| | `BundleMember[]` |
| p_i | 軒 i のパネル枚数 = max(1, ⌈kW_i / kwPerPanel⌉) | `kwPerPanel`, `defaultCapacityKw`, `PanelInstallation.capacityKw` |
| P | 束の総枚数 = Σ p_i | `BundleQuote.totalPanels` |
| A_i | 外壁面積 [m²] = 外周 × 高さ(measuredHeight があればそれ、無ければ 階数 × storeyHeightMeters、階数未知なら 2) | `Building.perimeter`, `storeysAboveGround`, `measuredHeight`, `scaffold.storeyHeightMeters` |
| E_i | 足場の架払い基本額 = max(minimumPerHouse, perWallSqm × A_i) | `scaffold.perWallSqm`, `scaffold.minimumPerHouse` |
| reloc_i | 連棟移設が効くか = n ≥ 2 かつ ∃ j ∈ B, j ≠ i: gap(i, j) ≤ relocationMaxGapMeters | `AdjacencyGraph`, `scaffold.relocationMaxGapMeters` |
| f | 連棟移設が効く軒の架払い掛け率 | `scaffold.relocationFactor` |
| M | 足場材の搬入・搬出(現場=束あたり 1 回) | `scaffold.mobilizationPerSite` |
| c_max | 街区に入れる最大車格(幅員・斜面から) | `SiteContext.vehicleClass` |
| cap_c, D_c | 車格 c の積載枚数、1台1日費用 | `vehicle.panelCapacity`, `vehicle.dayCost` |
| R | 処分場への運搬 1 トリップ(=1台) | `disposal.transportPerTrip` |
| T_c | 1台日の総額 = D_c + R | — |
| c*, t | 実配車の車格と台数(§1.4) | `BundleQuote.vehicleClass`, `BundleQuote.trucks` |
| h, C | 1班1日の処理軒数、班の出動費/日 | `labor.housesPerCrewDay`, `labor.crewMobilizationPerDay` |
| d | 班日数 = max(1, ⌈n / h⌉) | `BundleQuote.crewDays` |
| V_i | 軒ごとの変動費 = electricalPerHouse + roofRepairPerHouse + p_i × (removalPerPanel + disposal.perPanel) | `labor.*`, `disposal.perPanel` |

### 1.2 費目ごとの式(軒 i、束 B)

```
足場     scaffold_i   = E_i × (reloc_i ? f : 1) + M / n
車両     vehicle_i    = t × D_c* × (p_i / P)
処分     disposal_i   = p_i × perPanel + t × R × (p_i / P)
電気     electrical_i = electricalPerHouse
取外し   removal_i    = p_i × removalPerPanel
防水     roofRepair_i = roofRepairPerHouse
班       crew_i       = d × C / n
合計     total_i      = scaffold_i + vehicle_i + disposal_i + electrical_i + removal_i + roofRepair_i + crew_i
束       bundleTotal  = Σ total_i ,  perHouseAverage = bundleTotal / n ,  leadValue = bundleTotal × leadFeeRate
```

- `minimumPerHouse` は移設係数 f を掛ける**前**に適用する(小さな家の下限を移設で割らない。既存 `pricing.ts` と同じ)。
- 割引率という係数はどこにも無い。束の安さは「同じ足場搬入・同じトラック・同じ班出動を n 軒で割る」計算結果としてだけ現れる。
- 都市部と郊外は同じ式・同じ単価表の 2 入力である。違いは `gapMeters`(reloc の可否)と `Road.width`(c_max)だけ。

### 1.3 配賦則(束レベル固定費をどう軒に割るか)— **hybrid を既定とする**

| 固定費 | 発生の原因 | 配賦 |
|---|---|---|
| 車両 t × D_c*、運搬 t × R | 台数は**枚数**のビンパッキングで決まる | 枚数比 p_i / P |
| 足場搬入 M | 現場(束)あたり 1 回、家の大小に無関係 | 均等 1 / n |
| 班出動 d × C | 班日は**軒数**で決まる(h 軒/日) | 均等 1 / n |

理由: (1) 費目を生んだ物理量で割るのが最も説明しやすい(8kW の家はトラックの場所を 2 倍使うが、班の段取りは 1 軒分)。(2) `bundleTotal` と `perHouseAverage` は配賦則に依らず同一なので、招待状の「1軒 ○万円」(平均)は変わらない。変わるのは `perHouse[i]`(「自分の内訳」と発注仕様)だけ。(3) 標準街区(全軒 4kW)では equal / panels / hybrid の 3 則がすべて同じ値を返すため、§4・§5 の期待値は配賦則に依存しない。
既存 `QuoteOptions.sharedCostAllocation` は `'equal' | 'panels' | 'hybrid'` とし、既定を `'hybrid'` に変更する(`'equal'` は「全員同額」を明示したい画面向けに残す)。

### 1.4 車格と台数(積み合わせ)

```
c_max   = classifyVehicle(幅員, 勾配)                         … 街区の上限(§3.1)
trucks_c = max(1, ⌈P / cap_c⌉)                                 for c ≤ c_max
c*      = argmin_{c ≤ c_max} trucks_c × (D_c + R)              … 同額なら大きい車格(台数が少ない)
t       = trucks_c*
```

1台 = 1日 = 1積載 = 処分場 1 トリップ。産廃収集運搬車は「1杯たまった日に来て処分場へ運ぶ」ので台数・日数・トリップは一致する。同一束は同一車格で揃える(混成便は配車の実態に合わない)。

### 1.5 標準街区(全軒同型)の閉じた形と、階段が正直である理由

全軒が同じ家(p 枚、架払い E)なら

```
P(n) = V + E(n) + [ M + ⌈p·n / cap⌉ × T + ⌈n / h⌉ × C ] / n
       E(n) = E × f   (n ≥ 2 かつ全軒が移設可)  /  E   (それ以外)
```

- 1/n の割り勘は前倒しで効く: 1→4軒で固定費の 3/4 が消え、4→12軒で消えるのは残り 1/12 だけ。
- ⌈·⌉ が 1 増える n(トラック 1 台増・班 1 日増)では分子が跳ね、分母 n が 1 しか増えないので**単価が戻る**。標準街区(cap=64, p=16, h=2)では n = 5, 9, 13, 17, 21 でトラックが増え、その段は必ず上がる。班だけが増える奇数段(3, 7, 11, …)は上がらず「降り方が鈍る」段になる(後述 §4.1)。
- 単価表の既定値(§2)では: V = 88,000、E = 99,840、M = 20,000、T_2t = 80,000、C = 32,000、cap_2t = 64、h = 2。

### 1.6 アンカー → 係数の対応(どの数字がどの係数を決めるか)

| # | 報告書のアンカー | 式 | 決まるもの / 判定 |
|---|---|---|---|
| A1 | 単独 32 万 | V + E + M + T + C = 320,000 | 総和 |
| A2 | 単独の足場 12 万 | E + M = 120,000; M = 20,000 は公表相場 → E = 100,000 | **perWallSqm = 100,000 / 192 ≒ 520** |
| A3 | 12軒の足場 6 万(50%減) | E·f + M/12 = 60,000 | **f = (60,000 − 1,667)/99,840 = 0.58** |
| A5 | 12軒=3台・13軒=4台 | ⌈192/cap⌉=3 ∧ ⌈208/cap⌉=4 | **64 ≤ cap_2t < 69.3 → 64** |
| A4 | 12軒 19 万 | P(12) = 259,574 − X, X ≡ 3T/4 + C/2 | X = 69,574 |
| A6 | 13軒目 +0.6 万 | Δ13 = X/13 − M/156 | X = 79,664 |
| A4∧A6 | 両立不能(X が 14% 食い違う) | 妥協点 **X = 76,000(T = 80,000, C = 32,000)** | P(12) = 183,574(−3.4%)、Δ13 = +5,718(−4.7%) |
| A7 | 削減率 50%→40〜60% で ±1.2 万 | dP(12)/d(削減率) = −(E + M) = −120,000 → ±10pt で ±12,000 | **A2 と同じ情報(過剰決定・自動的に成立)** |
| A8 | 6軒 23 万 | P(6) − P(12) ≤ (M + T + C)/12 ≤ 200,000/12 ≒ 16,700 < 40,000 | **どの単価表でも再現不能**(§7) |
| A9 | 郊外 −15% | 同一モデルの導出値 | **−30%**(§4.2) |

---

## 2. 既定単価表 `public-2026-estimate`

`RateTable`(`types.ts`)と完全一致。`rates.ts` の `DEFAULT_RATE_TABLE` にそのまま載せる。金額は円・税抜。

```json
{
  "id": "public-2026-estimate",
  "label": "公表相場ベースの概算(2026)— 報告書アンカー整合版",
  "note": "税抜・円。4kW=16枚=1山、2t車=4山(64枚)=1台、班=2軒/日。事業者の実勢値に差し替え可能。各値の出所は docs/pricing-model.md §2 の出所表。",
  "scaffold": {
    "mobilizationPerSite": 20000,
    "perWallSqm": 520,
    "minimumPerHouse": 60000,
    "relocationMaxGapMeters": 2.0,
    "relocationFactor": 0.58,
    "storeyHeightMeters": 3.0
  },
  "vehicle": {
    "dayCost": { "kei": 30000, "2t": 60000, "4t": 85000 },
    "panelCapacity": { "kei": 12, "2t": 64, "4t": 128 },
    "minRoadWidth": { "kei": 2.0, "2t": 4.0, "4t": 5.5 },
    "slopePercentDowngrade": 10
  },
  "disposal": {
    "perPanel": 1500,
    "transportPerTrip": 20000
  },
  "labor": {
    "electricalPerHouse": 25000,
    "removalPerPanel": 1500,
    "roofRepairPerHouse": 15000,
    "crewMobilizationPerDay": 32000,
    "housesPerCrewDay": 2
  },
  "kwPerPanel": 0.25,
  "defaultCapacityKw": 4,
  "leadFeeRate": 0.05
}
```

### 出所表(field → 値 → 出典ラベル → 注記)

ラベルの意味: **[公表相場]** = 業界見積サイト・処理業者・運送業者の公開料金帯(一次統計ではない)/ **[仮定]** = 物理量からの設計値(要ヒアリング)/ **[報告書アンカーから逆算]** = `final/01` の数字に合わせて決めた値。

| field | 値 | 出典ラベル | 注記(出所の種類・範囲・検算) |
|---|---|---|---|
| scaffold.mobilizationPerSite | 20,000 | [公表相場] | 足場業者・外装塗装見積サイトの「足場運搬費」1.5〜4 万円/現場。束(街区)あたり 1 回として割り勘 |
| scaffold.perWallSqm | 520 | [報告書アンカーから逆算] | 単独足場 12 万 − 搬入 2 万 = 10 万 ÷ 標準壁面積 192 m²(外周 32 m × 2 階 × 3.0 m)= 520.8。整合確認: 公表相場の足場 700〜1,000 円/m²(架面積・運搬諸経費込)を壁面積換算(架面積 ≒ 壁面積 × 1.3、運搬控除)すると 540〜770 円/m²。撤去は屋根側・昇降の部分架けで済むので下端 |
| scaffold.minimumPerHouse | 60,000 | [仮定] | 平屋・小規模でも屋根足場+昇降設備の最低請負額 5〜8 万。移設係数を掛ける前に適用 |
| scaffold.relocationMaxGapMeters | 2.0 | [仮定] | 民法 234 条の離隔 50 cm × 2 + 足場幅 0.9 m ≒ 1.9 m。隙間 ≤ 2 m なら間隙の 1 列足場が両家の対向壁を兼ね、資材を手渡しで移せる。範囲 1.5〜3.0、要ヒアリング |
| scaffold.relocationFactor | 0.58 | [報告書アンカーから逆算] | A3: (60,000 − 20,000/12) / 99,840 = 0.584。物理分解: 共有面(対向壁 ≒ 壁面積の 1/4 を 2 軒で折半 → ×0.75)× 直移設(積込・積下ろし・再検品が消え労務 −20% → ×0.80)= 0.60 と整合。ヒアリング想定範囲 0.55〜0.70 |
| scaffold.storeyHeightMeters | 3.0 | [公表相場] | 木造戸建ての標準階高 2.8〜3.0 m(住宅メーカー公開仕様)。`measuredHeight` があればそちらを優先 |
| vehicle.dayCost.kei | 30,000 | [公表相場] | 産廃収集運搬 軽トラック(運転手込)日極 2.5〜3.5 万。1 台 = 1 トリップとして計上 |
| vehicle.dayCost.2t | 60,000 | [公表相場] | 産廃収集運搬許可業者の 2t 平ボディ 日極(運転手込)5〜7 万。+ transportPerTrip 2 万 = 1 台日 8 万 ≒ 報告書の「1 台 ≈ 7.8 万」 |
| vehicle.dayCost.4t | 85,000 | [公表相場] | 4t 平ボディ 日極 7.5〜10 万(2t の約 1.4 倍)。1 台日 10.5 万 |
| vehicle.panelCapacity.kei | 12 | [仮定] | 最大積載 350 kg ÷ 27 kg/枚(パネル 19 kg + 架台按分 8 kg)≒ 13 → 12。4kW(16 枚)は 2 トリップ、3kW(12 枚)は 1 トリップ |
| vehicle.panelCapacity.2t | 64 | [報告書アンカーから逆算] | A5: 12 軒 192 枚 = 3 台・13 軒 208 枚 = 4 台 ⇒ 64 ≤ cap < 69.3 → 64(= 4 軒分)。重量検算 64 × 27 kg ≒ 1.73 t < 積載 2 t、荷台 3.1 × 1.6 m に 1.65 × 1.0 m の山 4 つ |
| vehicle.panelCapacity.4t | 128 | [仮定] | 荷台 6.2 × 2.1 m に 8 山、約 3.5 t < 積載 4 t。2t の 2 倍 |
| vehicle.minRoadWidth.kei | 2.0 | [仮定] | 軽トラ幅 1.48 m + 余裕。エンジンは幅員既知なら最低でも kei を返すので、実質は下限の記録 |
| vehicle.minRoadWidth.2t | 4.0 | [公表相場] | 建築基準法 42 条の接道 4 m。2t 幅 1.9 m で停車 + 片側通行が残る実用下限(業界慣行) |
| vehicle.minRoadWidth.4t | 5.5 | [仮定] | 4t 幅 2.3〜2.5 m + 荷役・対向。PLATEAU `widthType` の区分境界(3.0 / 5.5 / 13.0 m)に揃え、`uro:width` 欠損時の `widthType` 退避(代表値 4.0 / 8.0 m)と判定が一致するようにした |
| vehicle.slopePercentDowngrade | 10 | [仮定] | 勾配 10%(約 5.7°)以上は積載車の停車・荷役が危険。道路構造令の最急縦断勾配 9〜12% を参照 |
| disposal.perPanel | 1,500 | [公表相場] | 太陽光パネル中間処理・リサイクル受入 1,000〜2,000 円/枚(処理業者の公表価格帯)。架台のアルミは有価で相殺 |
| disposal.transportPerTrip | 20,000 | [公表相場] | 処分場往復の燃料・通行料 + 受入手数料 + マニフェスト事務 1.5〜2.5 万/回 |
| labor.electricalPerHouse | 25,000 | [公表相場] | 系統切離し・パワコン撤去 2〜4 万/軒 の下端寄り。見積の「3〜5 万」に含まれる移動・拘束分は crewMobilizationPerDay 側に分離 |
| labor.removalPerPanel | 1,500 | [公表相場] | パネル・架台取外し 1,000〜2,500 円/枚(足場・班出動を別計上した純作業分) |
| labor.roofRepairPerHouse | 15,000 | [公表相場] | 架台跡のビス穴コーキング・板金補修 1〜3 万/軒 |
| labor.crewMobilizationPerDay | 32,000 | [報告書アンカーから逆算] | A4∧A6 の妥協点 3T/4 + C/2 = 76,000(T = 80,000)から C = 32,000。検算: 3 人 × (往復移動 2 h + 段取り・養生 1.5 h) × 3,000 円/h = 31,500 + 車両・燃料 |
| labor.housesPerCrewDay | 2 | [仮定] | 足場が先行して架かっていれば 4kW 1 軒 ≒ 3.5 h(取外し・切離し・補修)→ 3 人班で午前・午後 2 軒。範囲 1.5〜3、要ヒアリング |
| kwPerPanel | 0.25 | [公表相場] | 2012〜15 年設置の住宅用結晶シリコン 200〜250 W/枚(メーカーカタログ)。4kW = 16 枚 |
| defaultCapacityKw | 4 | [公表相場] | 住宅用の平均 4〜5 kW(JPEA 統計)。報告書の主人公(4kW)と一致 |
| leadFeeRate | 0.05 | [仮定] | 報告書記載の成約手数料 5%。監査第 3 層「検証不能・要ヒアリング」 |
| id / label / note | — | — | 文字列。数値ではない |

標準家屋(較正用): 底面 8 m × 8 m(外周 32 m、底面積 64 m²)、2 階建て、`measuredHeight` 無し → 高さ 6.0 m、外壁 192 m²、4kW = 16 枚。
単独見積の内訳: 足場 119,840(架払い 99,840 + 搬入 20,000)/ 車両 60,000 / 処分 44,000(枚 24,000 + 運搬 20,000)/ 電気 25,000 / 取外し 24,000 / 防水 15,000 / 班 32,000 = **319,840**。

---

## 3. アルゴリズム(疑似コード)

既存の関数名に合わせる(`vehicle.ts`, `adjacency.ts`, `normalize.ts`, `pricing.ts`)。

### 3.1 車格上限: 道路幅員と斜面から(`vehicle.ts`)

```ts
const ORDER: VehicleClass[] = ['kei', '2t', '4t'];

// 幅員の実効値と根拠。uro:width → uro:widthType(代表値 '1':2.5 '2':4.0 '3':8.0 '4':16 '5':22)→ LOD1 面の 2A/P → 不明
function effectiveRoadWidth(road: Road): { width: number | undefined; source: WidthSource }

function classifyVehicle(width: number | undefined, slope: number | undefined, rt: RateTable, source): VehicleDecision {
  if (width === undefined) return { vehicleClass: 'kei', reason: '接道の幅員が不明のため軽トラ想定' };   // 保守側
  let cls: VehicleClass = 'kei';
  for (const c of ORDER) if (width >= rt.vehicle.minRoadWidth[c]) cls = c;                          // kei が下限
  let reason = `接道幅員 ${width}m(${source})→ ${cls}`;
  if (slope !== undefined && slope >= rt.vehicle.slopePercentDowngrade && cls !== 'kei') {
    cls = ORDER[ORDER.indexOf(cls) - 1]; reason += `、勾配 ${slope}% の斜面地のため 1 段落として ${cls}`;
  }
  return { vehicleClass: cls, reason };
}

// 街区: 各建物の最寄り道路のうち「最も狭い幅員」と「最大勾配」で判定(束の全戸に同じ車が入れることが条件)
function decideBundleVehicle(buildings, roads, rt): VehicleDecision & { narrowestRoadId?, roadWidth? }
//   → SiteContext.vehicleClass(街区の上限)/ SiteContext.vehicleReason
```

### 3.2 隣接 → 束内の移設判定(`adjacency.ts`)

```ts
graph = buildAdjacencyGraph(buildings, { maxGapMeters: 12 })   // LOD1 輪郭同士の最短距離 [m]、近い順

function relocationEligible(bundleIds: Set<string>, graph, maxGap = rt.scaffold.relocationMaxGapMeters): Set<string> {
  eligible = {}
  for id in bundleIds:
    if ∃ nb ∈ graph.neighbors[id]: nb.gapMeters <= maxGap && bundleIds.has(nb.buildingId): eligible.add(id)
  return eligible
}
// 束の外にいる隣家は数えない。n = 1 は必ず空集合。孤立した軒は束の中でも移設なし(非交渉事項 3)。
```

### 3.3 kW → 枚数、外壁面積

```ts
panelsFor(kw) = max(1, ceil((kw > 0 ? kw : rt.defaultCapacityKw) / rt.kwPerPanel))        // 4kW → 16、3.9kW → 16、4.1kW → 17
wallAreaSqm(b) = b.perimeter × (b.measuredHeight > 0 ? b.measuredHeight : (b.storeysAboveGround ?? 2) × rt.scaffold.storeyHeightMeters)
```

### 3.4 ビンパッキング → 台数と車格(`pricing.ts planVehicles`)

```ts
function planVehicles(totalPanels, maxClass, rt): { vehicleClass, trucks, cost } {
  best = undefined
  for c in ORDER[0 .. indexOf(maxClass)]:
    trucks = max(1, ceil(totalPanels / rt.vehicle.panelCapacity[c]))
    cost   = trucks × (rt.vehicle.dayCost[c] + rt.disposal.transportPerTrip)
    if (!best || cost <= best.cost) best = { vehicleClass: c, trucks, cost }     // 同額なら大きい車格
  return best
}
```

### 3.5 班日

```ts
crewDaysFor(n) = max(1, ceil(n / rt.labor.housesPerCrewDay))
```

### 3.6 束の見積(`quoteBundle`)— hybrid 配賦

```ts
function quoteBundle(members, site, rt, { sharedCostAllocation = 'hybrid' } = {}): BundleQuote {
  n = members.length; ids = Set(members.map(m => m.building.id))
  relocated = relocationEligible(ids, site.adjacency, rt.scaffold.relocationMaxGapMeters)
  panels[i] = panelsFor(members[i].installation.capacityKw); P = Σ panels
  v = planVehicles(P, site.vehicleClass, rt); d = crewDaysFor(n)

  sharedScaffold   = rt.scaffold.mobilizationPerSite
  sharedVehicle    = v.trucks × rt.vehicle.dayCost[v.vehicleClass]
  sharedTransport  = v.trucks × rt.disposal.transportPerTrip
  sharedCrew       = d × rt.labor.crewMobilizationPerDay

  byPanels(i) = panels[i] / P ; equal(i) = 1 / n
  shareV = allocation == 'equal'  ? equal : byPanels      // 車両・運搬
  shareS = allocation == 'panels' ? byPanels : equal      // 搬入・班

  for each member i:
    wall   = wallAreaSqm(building)
    setup  = max(rt.scaffold.minimumPerHouse, wall × rt.scaffold.perWallSqm) × (relocated.has(id) ? rt.scaffold.relocationFactor : 1)
    scaffold   = setup + sharedScaffold × shareS(i)
    vehicle    = sharedVehicle × shareV(i)
    disposal   = panels[i] × rt.disposal.perPanel + sharedTransport × shareV(i)
    electrical = rt.labor.electricalPerHouse
    removal    = panels[i] × rt.labor.removalPerPanel
    roofRepair = rt.labor.roofRepairPerHouse
    crew       = sharedCrew × shareS(i)
    total      = 上 7 項の和(各項は円に丸めて保持)
  byCategory = 費目ごとの束合計; bundleTotal = Σ total; perHouseAverage = round(bundleTotal / n)
  return { size: n, vehicleClass: v.vehicleClass, trucks: v.trucks, crewDays: d, relocatedHouses: relocated.size, totalPanels: P, bundleTotal, perHouseAverage, perHouse, byCategory }
}
```

### 3.7 段差の生成(`buildStaircase`)

```ts
function buildStaircase(candidates, site, rt, { maxSize, order, ...quoteOptions } = {}): Staircase {
  // 並び順: 先頭は必ず自分の家。既定は重心距離の近い順(nearestFirstOrder)。
  // API(quote.ts)は 自分 → 登録済み(近い順)→ 未登録候補(近い順) を order で渡す。
  ordered = (order ?? nearestFirstOrder(candidates)).map(id → candidate)
  steps = []; prev = undefined
  for n in 1 .. min(maxSize, ordered.length):
    q = quoteBundle(ordered[0 .. n), site, rt, quoteOptions)
    if n == 1: single = q.perHouseAverage
    steps.push({
      size: n, perHouseAverage: q.perHouseAverage, trucks: q.trucks, crewDays: q.crewDays,
      deltaFromPrevious: prev ? q.perHouseAverage − prev.perHouseAverage : 0,
      truckAdded:   prev ? q.trucks   > prev.trucks   : false,    // 「正直に戻る段」の主因
      crewDayAdded: prev ? q.crewDays > prev.crewDays : false,    // §6 追加提案(任意)
      vehicleClass: q.vehicleClass,                               // §6 追加提案(任意): 段ごとの実配車
      savingsRate: round((single − q.perHouseAverage) / single, 4),
    })
    prev = q
  best = argmin perHouseAverage(同額なら小さい n)
  return { rateTableId: rt.id, vehicleClass: site.vehicleClass /* 街区の上限 */, singlePrice: single, steps, best }
}
```

`singlePrice` は「先頭の軒を単独で出したときの価格」(n = 1 では reloc = false、車格は上限以下で最安)。計算量は O(N²) だが N は高々数十。

### 3.8 標準街区での閉じた形(検算用)

```
P(n) = 88,000 + E(n) + [ 20,000 + 80,000 × ⌈16n/64⌉ + 32,000 × ⌈n/2⌉ ] / n ,  E(1) = 99,840 , E(n≥2) = 57,907
```

---

## 4. 期待値テーブル

### 4.1 標準都市街区(全軒 2 階建て・4kW・隣棟間隔 1.2 m・道路幅員 4.5 m → c_max = 2t)

太字の n が非交渉事項 4 の必須点。5・9 は「戻る段」の参考行。

| n | 車格 | 台数 | 班日 | 移設軒 | 足場/軒 | 車両/軒 | 処分/軒 | 班/軒 | 固定/軒 | **単価/軒** | Δ前段 | truckAdded | 削減率 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **1** | 2t | 1 | 1 | 0 | 119,840 | 60,000 | 44,000 | 32,000 | 64,000 | **319,840** | — | — | 0.0% |
| **2** | 2t | 1 | 1 | 2 | 67,907 | 30,000 | 34,000 | 16,000 | 64,000 | **211,907** | −107,933 | | 33.8% |
| **3** | 2t | 1 | 2 | 3 | 64,574 | 20,000 | 30,667 | 21,333 | 64,000 | **200,574** | −11,333 | (班日+1) | 37.3% |
| **4** | 2t | 1 | 2 | 4 | 62,907 | 15,000 | 29,000 | 16,000 | 64,000 | **186,907** | −13,667 | | 41.6% |
| 5 | 2t | **2** | **3** | 5 | 61,907 | 24,000 | 32,000 | 19,200 | 64,000 | 201,107 | **+14,200** | ✔ | 37.1% |
| **6** | 2t | 2 | 3 | 6 | 61,241 | 20,000 | 30,667 | 16,000 | 64,000 | **191,907** | −9,200 | | 40.0% |
| **8** | 2t | 2 | 4 | 8 | 60,407 | 15,000 | 29,000 | 16,000 | 64,000 | **184,407** | −5,500 | | 42.3% |
| 9 | 2t | **3** | **5** | 9 | 60,129 | 20,000 | 30,667 | 17,778 | 64,000 | 192,574 | **+8,167** | ✔ | 39.8% |
| **12** | 2t | 3 | 6 | 12 | 59,574 | 15,000 | 29,000 | 16,000 | 64,000 | **183,574** | −3,424 | | 42.6% |
| **13** | 2t | **4** | **7** | 13 | 59,446 | 18,462 | 30,154 | 17,231 | 64,000 | **189,292** | **+5,718** | ✔ | 40.8% |
| **16** | 2t | 4 | 8 | 16 | 59,157 | 15,000 | 29,000 | 16,000 | 64,000 | **183,157** | −2,484 | | 42.7% |
| **24** | 2t | 6 | 12 | 24 | 58,741 | 15,000 | 29,000 | 16,000 | 64,000 | **182,741** | −1,601 | | 42.9% |

固定/軒 = 電気 25,000 + 取外し 24,000 + 防水 15,000。処分/軒 = 枚 24,000 + 運搬の按分。
`best` は 12 軒までなら 12、24 軒までなら 24(4 の倍数で局所最小、以後は M/n 分だけ僅かに下がる。12 → 24 で −833 円しか動かない)。

**なぜ 13 軒は 12 軒より高いか。** 12 軒 = 192 枚は 2t 車ちょうど 3 台(64 × 3)に収まり、班も 6 日で終わる。13 軒目の 16 枚は 4 台目のトラック(1 台日 80,000)と 7 日目の班(32,000)を丸ごと呼ぶが、それを分担する軒は 1 軒しか増えない。1 軒あたりの内訳:

| 要因 | 計算 | Δ/軒 |
|---|---|---|
| 4 台目の 2t 車(日額) | 4 × 60,000 / 13 − 3 × 60,000 / 12 | +3,462 |
| 4 台目の運搬トリップ | 4 × 20,000 / 13 − 3 × 20,000 / 12 | +1,154 |
| 7 日目の班出動 | 7 × 32,000 / 13 − 6 × 32,000 / 12 | +1,231 |
| 足場搬入の薄まり | 20,000 / 13 − 20,000 / 12 | −128 |
| **合計** | | **+5,718** |

4 台目の総額 80,000 ≒ 報告書の「1 台 ≈ 7.8 万」だが、既存 3 台の 240,000 も 13 軒に薄まる(−1,538)ので 80,000 / 13 = 6,154 にはならない。同じ理屈で 5 軒目(2 台目 + 3 班日目)は +14,200、9 軒目は +8,167 戻る。**2t 街区では 4 の倍数で束を閉じるのが最安**。班だけが増える奇数段(3, 7, 11, 15, …)は上がらない(班 1 日 32,000 の追加が、他の固定費が 1 軒分薄まる効果を下回る: 例 n = 3 で班 +5,333 に対し車両・運搬・搬入 −16,667)。

### 4.2 標準郊外街区(隣棟間隔 6 m・道路幅員 6 m → c_max = 4t、移設なし)

| n | 車格(実配車) | 台数 | 班日 | 移設軒 | 足場/軒 | 車両/軒 | 処分/軒 | 班/軒 | **単価/軒** | Δ前段 | 削減率 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **1** | 2t(4t は 105,000 > 80,000) | 1 | 1 | 0 | 119,840 | 60,000 | 44,000 | 32,000 | **319,840** | — | 0.0% |
| 4 | 2t | 1 | 2 | 0 | 104,840 | 15,000 | 29,000 | 16,000 | 228,840 | −13,667 | 28.4% |
| 5 | **4t**(1 台 105,000 < 2t 2 台 160,000) | 1 | 3 | 0 | 103,840 | 17,000 | 28,000 | 19,200 | 232,040 | +3,200 | 27.5% |
| **6** | 4t | 1 | 3 | 0 | 103,173 | 14,167 | 27,333 | 16,000 | **224,673** | −7,367 | 29.8% |
| 8 | 4t | 1 | 4 | 0 | 102,340 | 10,625 | 26,500 | 16,000 | 219,465 | −4,518 | 31.4% |
| 9 | 4t | **2** | 5 | 0 | 102,062 | 18,889 | 28,444 | 17,778 | 231,173 | **+11,708** | 27.7% |
| **12** | 4t(2 台 210,000 < 2t 3 台 240,000) | 2 | 6 | 0 | 101,507 | 14,167 | 27,333 | 16,000 | **223,007** | −3,197 | **30.3%** |
| 16 | 4t | 2 | 8 | 0 | 101,090 | 10,625 | 26,500 | 16,000 | 218,215 | −2,025 | 31.8% |

(電気 25,000・取外し 24,000・防水 15,000 は全段共通。)
郊外で 4t が入らない(幅員 4.0〜5.5 m)街区は 2t 3 台で 12 軒 225,507(−29.5%)。5 軒目は台数据え置きで車格が 2t → 4t に切り替わる段(`truckAdded` = false、`crewDayAdded` = true)。郊外の戻る段は 5・9・17(4t の 128 枚 = 8 軒ごと)。

### 4.3 都市と郊外の削減の内訳(12 軒、1 軒あたり)

| 要因 | 郊外(移設なし・4t) | 都市(移設あり・2t) |
|---|---|---|
| 足場の連棟移設 (1 − f) × E | 0 | 41,933(13.1pt) |
| 足場搬入 M の割り勘 | 18,333(5.7pt) | 18,333(5.7pt) |
| 車両の積み合わせ(日額) | 45,833(14.3pt) | 45,000(14.1pt) |
| 処分運搬トリップの割り勘 | 16,667(5.2pt) | 15,000(4.7pt) |
| 班出動の割り勘 | 16,000(5.0pt) | 16,000(5.0pt) |
| **合計** | **96,833 = −30.3%** | **136,266 = −42.6%** |

- **導出される郊外の削減率: −30%(概算)**。4t が入らなくても −29.5%。班が割れない(h = 1)としても −25.3%、足場搬入も各戸別々(M を割らない)としても −24.5%、両方でも −19.5%。**どの読み方でも −15% には届かない**。
- 都市と郊外の差 39,433 円(12.3pt)= 連棟移設の価値 41,933 − 郊外が 4t を使える利点 2,500。報告書の「−15%」は郊外の削減率ではなく、**この差分(隙間 2 m 以内の値段 ≒ 12pt)** に近い数字として読み替えると整合する。
- 非足場だけの束効果は都市 12 軒で 76,000 / 319,840 = **23.8%**(監査の 21.9% は 19 万アンカー由来。同じ側の数字)。

**報告書が「郊外は−15%」の代わりに使うべき文:**

> 隣棟間隔が広く足場の連棟移設が効かない郊外の街区でも、車両の積み合わせ・処分運搬・班の出動・足場搬入を 12 軒で割るだけで、1 軒あたり約 3 割(概算 −30%: 32 万円 → 約 22 万円)下がる。隣棟間隔 2 m 以内で足場を隣家へ移せる都市部の街区では、さらに約 13 ポイント下がって約 4 割(概算 −43%: 約 18 万円)になる。

---

## 5. テストケース(vitest 想定)

### 5.0 共通フィクスチャ

```ts
import { localProjector } from './geometry.js';
import { normalizeBuilding } from './normalize.js';
import { buildAdjacencyGraph } from './adjacency.js';
import { classifyVehicle } from './vehicle.js';
import { buildStaircase, planVehicles, quoteBundle } from './pricing.js';
import { DEFAULT_RATE_TABLE as rt } from './rates.js';   // §2 の JSON

const { toLngLat } = localProjector([140.05, 35.65]);
/** 標準家屋: 8m × 8m の 2 階建て。measuredHeight は付けない(高さ 6.0m、外壁 192 m²)。 */
function house(id: string, x: number, storeys = 2, measuredHeight?: number): Building {
  const s = 8;
  return normalizeBuilding({ id, footprint: [toLngLat([x, 0]), toLngLat([x + s, 0]), toLngLat([x + s, s]), toLngLat([x, s])], storeysAboveGround: storeys, measuredHeight, yearOfConstruction: 2013 });
}
/** x 方向に gap [m] 間隔で n 軒並べる。 */
function row(n: number, gap: number, kw = 4): BundleMember[] {
  return Array.from({ length: n }, (_, i) => { const b = house(`h${i}`, i * (8 + gap)); return { building: b, installation: { buildingId: b.id, installYear: 2013, capacityKw: kw } }; });
}
const site = (members: BundleMember[], width: number, slope = 0) => {
  const v = classifyVehicle(width, slope, rt, 'uro:width');
  return { vehicleClass: v.vehicleClass, vehicleReason: v.reason, adjacency: buildAdjacencyGraph(members.map((m) => m.building), { maxGapMeters: 12 }) };
};
const urban = row(24, 1.2);    const urbanSite = site(urban, 4.5);      // → '2t'
const suburban = row(24, 6);   const suburbanSite = site(suburban, 6.0); // → '4t'
const within = (actual: number, expected: number, tol = 0.05) => expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(tol);
```

既存 `pricing.test.ts` の 7.6 × 9 m・measuredHeight 6.9 の家(外壁 229 m²)はこの標準家屋に置き換える。`perHouseAverage` は整数に丸められている。

### T1 都市街区の段差(`buildStaircase(urban, urbanSite, rt)`)— 単価は ±5%、それ以外は厳密一致

| n | perHouseAverage | 許容範囲(±5%) | vehicleClass | trucks | crewDays | relocatedHouses | truckAdded | Δ前段の符号 |
|---|---|---|---|---|---|---|---|---|
| 1 | 319,840 | 303,848〜335,832 | 2t | 1 | 1 | 0 | false | — |
| 2 | 211,907 | 201,312〜222,502 | 2t | 1 | 1 | 2 | false | − |
| 3 | 200,574 | 190,545〜210,603 | 2t | 1 | 2 | 3 | false | − |
| 4 | 186,907 | 177,562〜196,252 | 2t | 1 | 2 | 4 | false | − |
| 6 | 191,907 | 182,312〜201,502 | 2t | 2 | 3 | 6 | false | − |
| 8 | 184,407 | 175,187〜193,627 | 2t | 2 | 4 | 8 | false | − |
| 12 | 183,574 | 174,395〜192,753 | 2t | 3 | 6 | 12 | false | − |
| 13 | 189,292 | 179,827〜198,757 | 2t | 4 | 7 | 13 | **true** | **+** |
| 16 | 183,157 | 173,999〜192,315 | 2t | 4 | 8 | 16 | false | − |
| 24 | 182,741 | 173,604〜191,878 | 2t | 6 | 12 | 24 | false | − |

追加アサーション:
- `steps.filter(s => s.truckAdded).map(s => s.size)` = `[5, 9, 13, 17, 21]`、それらの段はすべて `deltaFromPrevious > 0`(5: +14,200、9: +8,167、13: +5,718、17: +4,397、21: +3,572 を ±5%)。
- `steps[12].deltaFromPrevious` ∈ [5,400, 6,050](13 軒目の戻り)。
- `steps[11].savingsRate` ∈ [0.40, 0.45]; `singlePrice` = `steps[0].perHouseAverage`。
- `best.size` = 12(maxSize 12)/ 24(24 軒まで)。
- 12 軒の `byCategory`: scaffold 714,888 / vehicle 180,000 / disposal 348,000 / electrical 300,000 / removal 288,000 / roofRepair 180,000 / crew 192,000、`bundleTotal` 2,202,888、`leadValue` = 110,144(いずれも ±5%)。
- 12 軒の `perHouse[0]`: scaffold 59,574 / vehicle 15,000 / disposal 29,000 / crew 16,000 / total 183,574(±5%)、`scaffoldRelocated` = true。
- 単独の `perHouse[0]`: scaffold 119,840 / vehicle 60,000 / disposal 44,000 / electrical 25,000 / removal 24,000 / roofRepair 15,000 / crew 32,000(±5%)。

### T2 郊外街区の段差(`buildStaircase(suburban, suburbanSite, rt)`)

| n | perHouseAverage | 許容範囲(±5%) | vehicleClass(BundleQuote) | trucks | crewDays | relocatedHouses |
|---|---|---|---|---|---|---|
| 1 | 319,840 | 303,848〜335,832 | 2t | 1 | 1 | 0 |
| 6 | 224,673 | 213,439〜235,907 | 4t | 1 | 3 | 0 |
| 12 | 223,007 | 211,857〜234,157 | 4t | 2 | 6 | 0 |

追加アサーション: 全段 `relocatedHouses` = 0、`perHouse[*].scaffoldRelocated` = false; `steps[11].savingsRate` ∈ [0.28, 0.33]; `Staircase.vehicleClass` = '4t'(街区の上限)だが `quoteBundle(suburban.slice(0,1), …).vehicleClass` = '2t'; 都市 12 軒 − 郊外 12 軒 = 39,433 ± 5%; `steps[8]`(9 軒)は `truckAdded` = true かつ Δ > 0(+11,708)。
参考: 郊外街区を幅員 4.5 m(2t 止まり)にすると 12 軒 225,507(±5%)、削減率 ∈ [0.27, 0.32]。

### T3 移設は「束の中に 2 m 以内の隣家がいる軒」だけ(非交渉事項 3)

フィクスチャ: `a`(x=0)・`b`(x=9.2)は隙間 1.2 m、`d` は `b` から 6 m(x=23.2)。street は 2t。
- `quoteBundle([a, b, d])`: `relocatedHouses` = 2; a・b の `scaffold` = 64,574、`total` = 200,574; d の `scaffoldRelocated` = false、`scaffold` = 106,507(= 99,840 + 20,000/3)、`total` = 242,507; `perHouseAverage` = 214,552; trucks 1、crewDays 2(単価 ±5%)。
- 4 軒 `[a, b, c, d]`(c は b の隣 1.2 m、d は孤立): `relocatedHouses` = 3; 孤立軒 total 228,840、他 186,907、平均 197,390(±5%)。
- `quoteBundle([a])`: 街区に 1.2 m の隣家 b がいても束に入っていないので `relocatedHouses` = 0、scaffold 119,840。
- `quoteBundle([a, c])`(a と c は隣接しない、b は束外): `relocatedHouses` = 0。
- `quoteBundle(suburban.slice(0, 2))`: `relocatedHouses` = 0。

### T4 感度(報告書「削減率 50% → 40〜60% で ±1.2 万」)

都市 12 軒で `relocationFactor` を振る(足場 12 万の削減率 r ↔ f = ((1 − r) × 120,000 − 20,000/12) / 99,840):

| r(足場削減率) | f | perHouseAverage | 中央値との差 |
|---|---|---|---|
| 40% | 0.70 | 195,555 | +11,981 |
| 50% | 0.58 | 183,574 | 0 |
| 60% | 0.46 | 171,593 | −11,981 |

アサーション: `|Δ| ∈ [11,400, 12,600]`。参考: f = 0.5 → 175,587、f = 0.6 → 185,571(f を直接 ±0.1 振ると ±約 1 万)。

### T5 車格判定(`classifyVehicle(width, slope, rt)`)

| width | slope | 期待 | 備考 |
|---|---|---|---|
| 4.5 | 0 | 2t | 標準都市 |
| 6.0 | 0 | 4t | 標準郊外 |
| 5.5 | 0 | 4t | 境界(以上) |
| 5.4 | 0 | 2t | |
| 4.0 | 0 | 2t | 接道 4 m 境界 |
| 3.9 | 0 | kei | |
| 3.0 | 0 | kei | |
| 6.0 | 12 | 2t | 斜面で 1 段落とす |
| 3.0 | 12 | kei | 下限 |
| undefined | 0 | kei | 幅員不明、reason に「不明」 |

`effectiveRoadWidth`: `uro:width` 6 → 6(source 'uro:width'); width 無し・widthType '2' → 4.0('uro:widthType') → 2t; widthType '3' → 8.0 → 4t; どちらも無しは LOD1 面の 2A/P('lod1-geometry')。

### T6 車両計画(`planVehicles(totalPanels, maxClass, rt)`)

| totalPanels | maxClass | 期待 vehicleClass / trucks / cost | 理由 |
|---|---|---|---|
| 16 | 2t | 2t / 1 / 80,000 | kei は 2 トリップ 100,000 で不利(既存テストの「16 枚 → kei」は本表に置き換える) |
| 16 | 4t | 2t / 1 / 80,000 | 4t 105,000 は不利 |
| 12 | 4t | kei / 1 / 50,000 | 3kW は軽トラ 1 トリップ |
| 64 | 4t | 2t / 1 / 80,000 | |
| 80 | 4t | 4t / 1 / 105,000 | 2t 2 台 160,000 より安い(車格切替) |
| 192 | 4t | 4t / 2 / 210,000 | 2t 3 台 240,000 より安い |
| 192 | 2t | 2t / 3 / 240,000 | 12 軒 = 3 台 |
| 208 | 2t | 2t / 4 / 320,000 | 13 軒 = 4 台 |
| 192 | kei | kei / 16 / 800,000 | 軽トラ街区は高い(正直) |

### T7 正直さの性質テスト(全街区・全 n で成立)

- `deltaFromPrevious > 0` ⇒ `truckAdded || crewDayAdded`(戻るのは車両か班日が増えた段だけ)。都市・郊外・軽トラ街区・混成束すべてで検証。
- 都市街区(2t)では `truckAdded` ⇒ `deltaFromPrevious > 0`。**この逆向きは軽トラ街区では成り立たない**(1 軒ごとに 2 トリップ増えるため毎段 `truckAdded` だが単価は下がる)ので、UI の「正直に戻る段」は `deltaFromPrevious > 0` で判定し、`truckAdded` / `crewDayAdded` / `vehicleClass` は理由の表示に使う。
- `perHouseAverage(n)` は 4 の倍数で局所最小(都市)。`best.size % 4 === 0`。
- 任意の n で `Σ perHouse[i].total` = `bundleTotal`(±1 円)、`Σ byCategory` = `bundleTotal`。

### T8 最低額と実測高

- 6 m × 6 m の平屋(外周 24 m、壁 72 m² → 37,440 < 60,000)、3kW: scaffold = 60,000 + 20,000 = 80,000、panels 12、vehicle 30,000(kei 1 トリップ)、total 238,000(±5%)。移設可なら setup = 60,000 × 0.58 = 34,800(最低額の後に係数)。
- 標準家屋に `measuredHeight` 9.8(3 階): wall 313.6、scaffold 183,072、total 383,072(±5%)。

### T9 配賦則(4 軒・先頭だけ 8kW = 32 枚、都市)

| 配賦 | h0(8kW) total | h1〜h3 total | bundleTotal |
|---|---|---|---|
| hybrid(既定) | 278,907 | 198,907 | 875,628 |
| equal | 254,907 | 206,907 | 875,628 |
| panels | 291,507 | 194,707 | 875,628 |

アサーション: 3 則で `bundleTotal` 一致(±2 円); hybrid では h0 の `vehicle` = 48,000(= 2 台 × 60,000 × 32/80)、`crew` = 16,000(均等); `panels` では h0 の crew = 25,600。

### T10 6 軒の値(報告書の 23 万は出ない)

`steps[5].perHouseAverage` = 191,907(±5%)、`steps[5] − steps[11]` = 8,333 ∈ [5,000, 12,000]。

---

## 6. 型の変更提案(すべて additive・optional。既存フィールドのシグネチャは変えない)

1. `StaircaseStep.crewDayAdded?: boolean` — `truckAdded` と対になる「班の出動日が増えた段」。T7 の性質テストと UI の説明(「班がもう 1 日要るので降り方が鈍る」)に使う。
2. `StaircaseStep.vehicleClass?: VehicleClass` — 段ごとの実配車。郊外では n = 1〜4 が 2t、5 軒目から 4t に切り替わる(台数は据え置き)。`Staircase.vehicleClass` は「街区の上限」のまま(JSDoc で明記)。
3. `RateTable.provenance?: Record<string, RateProvenance>`、`interface RateProvenance { label: '公表相場' | '仮定' | '報告書アンカーから逆算'; source: string; range?: [number, number] }` — キーは `"vehicle.dayCost.2t"` のようなドット区切り。§2 の出所表をデータとして持ち、「なぜ束だと安いか」の 1 枚に出所を印字する。事業者値に差し替えたときは label を `'事業者値'` に拡張(将来の additive 変更)。
4. `HouseBreakdown.relocationNeighborId?: string` — 移設判定の根拠になった束内の隣家(最も近い 1 軒)。招待状・発注仕様の説明用。任意。
5. `pricing.ts` の `QuoteOptions.sharedCostAllocation` を `'equal' | 'panels' | 'hybrid'` に拡張し、既定を `'hybrid'` にする(types.ts 外)。
6. JSDoc のみの明確化(型変更なし): `SiteContext.vehicleClass` = 街区に入れる最大車格、`BundleQuote.vehicleClass` = その上限以下で最安の実配車; `scaffold.minimumPerHouse` は `relocationFactor` を掛ける前に適用; `disposal.transportPerTrip` は台数ごとに計上し `HouseBreakdown.disposal` に枚数比で含める; `vehicle.dayCost.kei` は 1 トリップ = 1 台として数える(1 日 2 往復の最適化は未実装)。

任意の将来拡張(現契約でも ±3% 以内で動くため必須ではない): `scaffold.intraSiteShuttlePerHouse?`(郊外の非移設軒に加算する街区内資材シャトル)、`scaffold.relocationFactorPerSharedSide?`(両隣ありの軒を厚くする)、`scaffold.mobilizationHousesPerTrip?`(n ≥ 20 で搬入 2 回目を出す)。

---

## 7. 監査への回答(第 1 層)

| 監査項目 | 本モデルでの扱い | 報告書に書くべき数字・文 |
|---|---|---|
| **[数字破綻] 郊外「−15%」と都市部の内訳(非足場由来 21.9%)が合わない** | **解消。** 都市も郊外も同一の単価表・同一の式で、入力(隣棟間隔・幅員)だけが違う。郊外 12 軒は −30.3%(4t 不可なら −29.5%)、都市 12 軒は −42.6%、非足場だけの束効果は 23.8%(監査の 21.9% と同じ側)。−15% は「班も足場搬入も割れない」最悪の読み方(−19.5%)でも出ない。都市と郊外の差 12.3pt が連棟移設そのものの価値で、報告書の −15% はこの差分に近い | §4.2 の文。「郊外は約 −30%、都市部はさらに約 13pt 下がって約 −43%」。−15% は削除 |
| **[内部の齟齬] 相場「15〜30 万」と主人公の「32 万」** | モデルの単独 319,840 は「2 階建て・4kW・2t 街区・足場を全面架け」の内訳(足場 12.0 万 / 車両 6.0 / 処分 4.4 / 電気 2.5 / 取外し 2.4 / 防水 1.5 / 班 3.2)として説明できる。同じ単価表で平屋 3kW は 23.8 万、3 階建て(9.8 m)は 38.3 万 | レンジを外部相場に合わせ「15〜40 万円」に直し、32 万を「2 階建て・4kW で足場を全面に架ける場合の上限側」と注記 |
| **「13 軒目で +0.6 万/軒」= 車両 1 台 7.8 万の根拠** | **単価表として示した。** 2t 1 台日 = 日額 60,000 + 運搬 20,000 = 80,000 ≒ 7.8 万。ただし 1 軒あたりの戻りは 80,000 / 13 = 6,154 ではなく **+5,718**: 4 台目 +6,154、既存 3 台の薄まり −1,538、7 班日目 +1,231、搬入の薄まり −128。監査の「0.6 万 × 13 = 7.8 万/台」は薄まりの無視と班日の無視が偶然相殺した式 | 「13 軒目で 2t 車 4 台目と班の 7 日目が要り、1 軒あたり約 5,700 円戻る(2t 車 1 台日 約 8 万円)」 |
| 「6 軒で 23 万」(絵コンテ) | **どの単価表でも再現不能**: P(6) − P(12) ≤ (M + T + C)/12 ≤ 200,000/12 ≒ 16,700 円 < 40,000 円(6 → 12 軒で薄まる固定費は、6 軒の束が既に払っているものの 1/12 が上限)。モデルの 6 軒は 191,907、12 軒との差は 8,333 | 「登録済みの 6 軒が灯るとバーは約 19 万 2 千円(概算)。12 軒の線 約 18 万 4 千円が下に見えている。13 軒目を試すとトラックが 4 台目に増え、約 5,700 円だけ正直に戻る」。割り勘の階段は 4 軒(2t 1 台満載)で −42% に達し以後は 4 の倍数で閉じるのが最安なので、閾値 12 は「3 台満載・6 班日 = 1 週間の枠」という事業者側の最小ロットとして説明する(価格の崖としては説明しない) |
| 「削減率 50% が ±20%(40〜60%)に振れても ±1.2 万」 | 成立(±11,981)。ただし 40〜60% は ±10pt。dP(12)/d(削減率) = −単独足場 12 万 なので、単独足場 12 万を置いた時点で自動的に決まる(過剰決定) | 「足場の削減率が 40〜60%(±10 ポイント)に振れても、12 軒の単価は ±1.2 万円」と表記を直す |
| 「12 軒 × 19 万 = 228 万、5% = 11.4 万」 | 12 軒 bundleTotal 2,202,888、leadValue 110,144 | 「12 軒で約 220 万円、リード価値 約 11 万円」 |

残る要ヒアリング項目(第 3 層)は単価表の [仮定] 行そのもの: `relocationMaxGapMeters`、`relocationFactor` の範囲 0.55〜0.70、`housesPerCrewDay`、`leadFeeRate`。事業者値に差し替えるときは §2 の JSON を丸ごと交換し、§5 の期待値を再生成する。
