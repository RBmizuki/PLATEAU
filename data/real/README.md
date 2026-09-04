# data/real — 実 PLATEAU データ(建物のみ)

## niiza.json

- 出典: 3D都市モデル(Project PLATEAU)新座市(2020年度)・国土交通省。
  取得元は OpenStreetMap インポート検討用に公開されている変換サンプル(https://github.com/nyampire/plateau_samples4import)に同梱された **オリジナルの CityGML**(`11230_niiza-shi_2020/bldg/*.zip` 内の `*_bldg_6697_op.gml`)。PLATEAU の利用規約(政府標準利用規約 2.0 準拠・出典明記)に従う。
- 対象メッシュ: 53395414 / 53395424 / 53395425(3 次メッシュ 3 枚)。建物 10,110 棟。
- 取り込み: `pnpm --filter @ashiba/plateau cli ingest <gml dir> -o data/real/niiza.json`(6.7 秒)。
- 属性の充足(2020 年度版 = uro 1.4): `bldg:measuredHeight` 100%、`bldg:yearOfConstruction` 0%、`storeysAboveGround` 0%、`usage` 0%、住所なし、道路(tran)なし、DEM なし。
  → 築年が無いので API は **形状コホート**(同じ規模の家が等間隔に並ぶ列 = 同時期分譲の疑い)に退避し、幅員は **向かい合う建物の外壁間の距離** から推定する(どちらも画面に「推定」「幅員未確認」と表示)。
- 個人情報: 住所・所有者情報は含まれない。建物 ID は PLATEAU の gml:id(uuid)。

## 使い方

```bash
DATA_FILE=$PWD/data/real/niiza.json pnpm --filter @ashiba/api dev
```

住所検索は使えないので、地図の家をクリックするか、建物 ID(`uuid_...`)を入力して選ぶ。

## toda.json

- 出典: 3D都市モデル(Project PLATEAU)戸田市(2022年度)・国土交通省。G空間情報センターの `plateau-11224-toda-shi-2022` の CityGML(v4、`11224_toda-shi_city_2022_citygml_4_op.zip`、483MB)。
- 取り込み: `udx/bldg`(35 ファイル)+ `udx/tran`(24 ファイル)+ `codelists/`。DEM(`udx/dem`、1 ファイル 600MB × 17)はメモリに載らないため未適用(要ストリーミング実装)。所要 19 秒。
- 内容: 建物 28,871 棟、道路 9,293 本。住宅棟(411〜414)の築年充足率 74.6%(全棟では 63.7%。番兵値「0001」などは未知扱い)。2010〜2016 年築 1,158 棟。階数・用途 100%。道路は `tran:function` のみで `uro:width` / `widthType` は無い → 幅員は道路面の弦長から推定(「幅員未確認」表示)。
- 築年クラスタ: 1,840(用途 411/413 かつ底面 35〜220 m²・高さ 13 m 以下に限定)。2010〜2016 年の街区は 132、最大 32 軒(2012〜2013 年)。
- 住所は入っていない。地図の家をクリックするか建物 ID(`bldg_…`)で検索する。

```bash
DATA_FILE=$PWD/data/real/toda.json VITE_BASEMAP=gsi-photo pnpm dev
```
