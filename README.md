# 足場の割り勘 — 屋根の太陽光を、ご近所の束で安く降ろす

PLATEAU(3D都市モデル)の建物・道路データから「同時期に分譲された街区」を見つけ、隣家と束ねた撤去の**段差価格**を計算し、束が成立したら地場の撤去・電気工事事業者へ発注リードとして渡す Web サービス。

- 案の報告書: [final/01-足場の割り勘.md](final/01-足場の割り勘.md)(§6 に実装による監査回答)
- 単価モデルの仕様: [docs/pricing-model.md](docs/pricing-model.md)
- PLATEAU データの扱い: [docs/plateau-data.md](docs/plateau-data.md)

## 段差価格の要点

束の値段 = 軒ごとの変動費 + 束レベルの固定費(足場搬入・トラック日・班日)÷ 軒数。割引率という係数はどこにも無く、安さは「同じ足場搬入・同じトラック・同じ班出動を n 軒で割る」計算結果としてだけ現れる。台数・班日は整数なので、1 台・1 日増える軒数では 1 軒あたりが正直に戻る。

| 街区 | 1 軒 | 6 軒 | 12 軒 | 13 軒 | 削減率(12 軒) |
|---|---|---|---|---|---|
| 都市部(隣棟 1.2 m・幅員 4.5 m → 2t、連棟移設あり) | 31.98 万 | 19.19 万 | 18.36 万 | 18.93 万(+5,718 円) | −43% |
| 郊外(隣棟 6 m・幅員 6 m → 4t、移設なし) | 31.98 万 | 22.47 万 | 22.30 万 | — | −30% |

既定単価表 `public-2026-estimate` は公表相場の概算で、各値に出所ラベル([公表相場]/[仮定]/[報告書アンカーから逆算])が付く(`packages/engine/src/rates.ts`)。事業者値は JSON を丸ごと差し替える。

## 構成(pnpm モノレポ)

| パッケージ | 役割 |
|---|---|
| `packages/engine` | 段差価格エンジン(純 TypeScript)。幾何(LOD1 輪郭から隣棟間隔)、隣接グラフ、築年クラスタ検出(道路で区切った街区単位)、道路幅員→車格、車両のビンパッキング、段差価格、発注仕様。 |
| `packages/plateau` | PLATEAU CityGML パーサ(bldg LOD1 / tran + uro:RoadStructureAttribute / 浸水想定)、GeoJSON 出力、合成街区フィクスチャ、CLI。 |
| `apps/api` | Hono API。データセット読込、住所→建物、束候補、試算、登録、成立判定、事業者への引き渡し。 |
| `apps/web` | Vite + React + MapLibre。住民フロー(住所→3D→設置年→束候補→試算→登録→招待状印刷)と事業者ダッシュボード(束の密度マップ・巡回計画・発注仕様)。 |
| `data/sample` | オフラインで動く合成街区(112 軒・9 道路)。JSON と CityGML の両方を同梱。 |

## 動かす

```bash
pnpm install
pnpm test          # 全パッケージのユニットテスト
pnpm typecheck
pnpm dev           # API (http://localhost:8787) と Web (http://localhost:5173) を同時起動
```

Web は `/api` を API にプロキシする。地図の下地は既定では無地(外部タイル不要)。`VITE_BASEMAP=gsi-photo` で地理院の全国最新写真、`gsi-pale` で淡色地図を敷く(API の `/api/tiles/...` が地理院タイルを中継・キャッシュする。`VITE_GSI_DIRECT=1` なら直接取得)。`VITE_BASEMAP_STYLE` に style.json の URL を渡せば任意の下地に差し替えられる。

## 実 PLATEAU データを使う

1. G空間情報センターから対象都市の CityGML を取得し展開する(`udx/bldg/*.gml`, `udx/tran/*.gml`, `codelists/`)。
2. 取り込む(`codelists/` は入力の親ディレクトリから自動で探す。`--codelists <dir>` で明示も可):
   ```bash
   pnpm --filter @ashiba/plateau cli ingest /path/to/udx/bldg /path/to/udx/tran -o /abs/path/city.json --usage 411,412,413,414
   ```
   stderr に **築年充足率**(住宅棟のうち `bldg:yearOfConstruction` を持つ割合)と **幅員の根拠の内訳**(`uro:width` / `uro:widthType` / LOD1 幾何 / `tran:function`)が出る。同じ値が JSON の `meta.coverage` に残る。
3. API をそのデータで起動する:
   ```bash
   DATA_FILE=/abs/path/city.json pnpm --filter @ashiba/api dev
   ```

幅員は `uro:width` → `uro:widthType`(同梱 codelist の区分から代表値)→ 家の前の道路面の弦長(LOD1 幾何)→ `tran:function`(市道 = 4m 級と仮置き)の順に退避し、根拠を見積画面に表示する。詳細は [docs/plateau-data.md](docs/plateau-data.md)。

## 撮影・録画

3 分動画の見せ場(住所 → 3D → 街区バッジ → 6 軒が灯る → 段差 → 登録 → 招待状 → 事業者がリードを受け取る)を Playwright で自動再生して webm に録画する:

```bash
pnpm dev                                  # 別ターミナル
node scripts/record-demo.mjs demo-recording   # playwright は npm i -g playwright か PLAYWRIGHT_MODULE で指定
```

MapLibre は `preserveDrawingBuffer: true` で初期化しているので、ヘッドレス撮影でも 3D キャンバスが写る。

## 実データで動かす

同梱の実データは 2 つ(出典と制約は [data/real/README.md](data/real/README.md))。

| データ | 年度 | 棟数 | 築年 | 道路 | 束の種 | 幅員 |
|---|---|---|---|---|---|---|
| `data/real/toda.json` 戸田市 | 2022(v4) | 28,871 | 住宅の 74.6% | 9,293 本(幅員属性なし) | **築年クラスタ**(2012〜13 年分譲の 32 軒など 132 街区) | 道路面の弦長から推定 |
| `data/real/niiza.json` 新座市 | 2020(v1) | 10,110 | なし | なし | 形状コホート | 向かいの建物との間隔から推定 |

```bash
DATA_FILE=$PWD/data/real/toda.json VITE_BASEMAP=gsi-photo pnpm dev
```

### 新座市 2020 年度(建物 10,110 棟)の退避

`data/real/niiza.json` は PLATEAU の実 CityGML(新座市の 3 次メッシュ 3 枚)を取り込んだもの(出典と制約は [data/real/README.md](data/real/README.md))。2020 年度版のため築年・道路が無く、API は次の退避で動く。

| 無いもの | 退避 | 画面の表示 |
|---|---|---|
| `bldg:yearOfConstruction` | **形状コホート**: 底面積と高さが揃った戸建てが 4 m 以内で連なる列を「同時期分譲の疑い」としてまとめる(`detectGeometryCohorts`) | 「同時期分譲の疑い(形状から推定)」 |
| `tran:Road` | **向かいの建物との間隔**: 各面から外向きに光線を飛ばし、最も開けた面のクリアランス − 後退 2 m を幅員とする。束では家ごとの推定の下位 1/4 を採る(`estimateStreetWidthFromBuildings`) | 「幅員未確認」付きの車格 |
| 住所 | 地図の家をクリック、または建物 ID(`uuid_…`)で検索 | — |

```bash
DATA_FILE=$PWD/data/real/niiza.json pnpm --filter @ashiba/api dev
```

築年充足率が 30% 以上の都市では自動的に築年クラスタに切り替わる。

## 環境変数(API)

| 変数 | 既定 | 意味 |
|---|---|---|
| `DATA_FILE` | `data/sample/masago.json` | 建物・道路データ(`cli ingest` / `cli fixture` の出力) |
| `STORE_FILE` | `apps/api/data/bundles.json` | 束の登録状態 |
| `BUNDLE_THRESHOLD` | `12` | 束の成立閾値(軒) |
| `GSI_GEOCODER` | 無効 | `1` で国土地理院の住所検索 API を使う(データ内の住所に一致しないとき) |
| `DEMO` | 有効 | `0` で `/api/demo/*`(登録済み軒のシード)を無効化 |
