# 足場の割り勘 — 屋根の太陽光を、ご近所の束で安く降ろす

PLATEAU(3D都市モデル)の建物・道路データから「同時期に分譲された街区」を見つけ、隣家と束ねた撤去の**段差価格**を計算し、束が成立したら地場の撤去・電気工事事業者へ発注リードとして渡す Web サービス。

- 案の報告書: [final/01-足場の割り勘.md](final/01-足場の割り勘.md)
- 単価モデルの仕様: [docs/pricing-model.md](docs/pricing-model.md)
- PLATEAU データの扱い: [docs/plateau-data.md](docs/plateau-data.md)

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

Web は `/api` を API にプロキシする。地図の下地は外部タイルに依存しない(`VITE_BASEMAP_STYLE` に地理院ベクトルタイル等の style.json を渡せば差し替え可)。

## 実 PLATEAU データを使う

1. G空間情報センターから対象都市の CityGML(`udx/bldg/*.gml`, `udx/tran/*.gml`)を取得する。
2. 取り込む:
   ```bash
   pnpm --filter @ashiba/plateau cli ingest /path/to/udx/bldg /path/to/udx/tran -o /abs/path/city.json --usage 411,412,413,414
   ```
3. API をそのデータで起動する:
   ```bash
   DATA_FILE=/abs/path/city.json pnpm --filter @ashiba/api dev
   ```

詳細(属性の定義、幅員が無い都市での退避、築年の充足率)は [docs/plateau-data.md](docs/plateau-data.md)。

## 環境変数(API)

| 変数 | 既定 | 意味 |
|---|---|---|
| `DATA_FILE` | `data/sample/masago.json` | 建物・道路データ(`cli ingest` / `cli fixture` の出力) |
| `STORE_FILE` | `apps/api/data/bundles.json` | 束の登録状態 |
| `BUNDLE_THRESHOLD` | `12` | 束の成立閾値(軒) |
| `GSI_GEOCODER` | 無効 | `1` で国土地理院の住所検索 API を使う(データ内の住所に一致しないとき) |
| `DEMO` | 有効 | `0` で `/api/demo/*`(登録済み軒のシード)を無効化 |
