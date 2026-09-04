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
