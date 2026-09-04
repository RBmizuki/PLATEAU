# PLATEAU データの扱い — 足場の割り勘

このサービスが PLATEAU(国土交通省 3D 都市モデル)の CityGML から何を読み、何が無いときにどう退避するかをまとめる。対象は `packages/plateau`(パーサ・フィクスチャ)と `packages/engine`(幅員→車格、隣棟間隔、斜面・浸水)の実装者。

> **確度の表記**: 本書は 3D都市モデル標準製品仕様書 v1〜v4(2020〜2023 年度整備分)と i-UR(uro)拡張スキーマの記憶に基づいて書いている。執筆環境から mlit.go.jp / geospatial.jp へは到達できず、原本照合はしていない。各項目に **[確度: 高/中/低]** を付け、低いものは「実データの `codelists/*.xml` と `schemas/iur/` を読んで確定する」手順を併記する。パーサはこの不確かさを前提に **ローカル名照合・コードリスト実読・多段退避** で組む。

---

## 1. bldg:Building LOD1 — パーサが扱う構造

### 1.1 名前空間 [確度: 高(core/bldg/gml/gen/xAL)、中(uro の版)]

| 接頭辞 | URI | 備考 |
|---|---|---|
| `core` | `http://www.opengis.net/citygml/2.0` | `core:CityModel`, `core:cityObjectMember`, `core:Address`, `core:creationDate` |
| `bldg` | `http://www.opengis.net/citygml/building/2.0` | 建物 |
| `tran` | `http://www.opengis.net/citygml/transportation/2.0` | 道路 |
| `dem` | `http://www.opengis.net/citygml/relief/2.0` | 地形 |
| `gen` | `http://www.opengis.net/citygml/generics/2.0` | 汎用属性 |
| `gml` | `http://www.opengis.net/gml` | GML 3.1.1(CityGML 2.0 は 3.1.1 を使う。`gml/3.2` ではない) |
| `xAL` | `urn:oasis:names:tc:ciq:xsdschema:xAL:2.0` | 住所 |
| `uro` | 整備年度で異なる(下表) | i-UR 都市オブジェクト拡張 |
| `urf` | `https://www.geospatial.jp/iur/urf/3.0` 等 | 都市計画決定情報(本サービスは未使用) |

`uro` の URI は整備年度(=製品仕様書の版)で変わる。

| 整備年度 / 仕様書 | uro URI | 確度 |
|---|---|---|
| 2020 年度 / v1 | `http://www.kantei.go.jp/jp/singi/tiiki/toshisaisei/itoshisaisei/iur/uro/1.4`(1.4 または 1.5) | 中 |
| 2021 年度 / v2 | `https://www.geospatial.jp/iur/uro/2.0` | 中〜高 |
| 2022 年度 / v3 | `https://www.geospatial.jp/iur/uro/3.0` | 高 |
| 2023 年度 / v4 | `https://www.geospatial.jp/iur/uro/3.1` | 中 |
| 2024 年度以降 | `https://www.geospatial.jp/iur/uro/3.2` 以降 | 低 |

**設計上の結論**: 名前空間 URI で分岐しない。`fast-xml-parser` の `removeNSPrefix: true` でローカル名(`Building`, `yearOfConstruction`, `RoadStructureAttribute` …)だけで照合する(現行 `citygml.ts` の方針)。uro 1.x と 2.x/3.x で要素名が変わっているもの(§1.6)は両方のローカル名を候補に入れる。

### 1.2 建物の骨格と要素パス [確度: 高]

```
core:CityModel
  gml:boundedBy/gml:Envelope[@srsName="http://www.opengis.net/def/crs/EPSG/0/6697"][@srsDimension="3"]
  core:cityObjectMember
    bldg:Building[@gml:id]
      core:creationDate                         (任意)
      gen:stringAttribute[@name] / gen:value    (0..*、v1 で多用)
      bldg:class / bldg:function                (任意)
      bldg:usage[@codeSpace]                    (0..*、コード)
      bldg:yearOfConstruction                   (0..1、xs:gYear)
      bldg:yearOfDemolition                     (0..1)
      bldg:roofType[@codeSpace]                 (0..1)
      bldg:measuredHeight[@uom="m"]             (0..1)
      bldg:storeysAboveGround                   (0..1、非負整数)
      bldg:storeysBelowGround                   (0..1)
      bldg:lod0FootPrint / gml:MultiSurface     (0..1、v2 以降でほぼ全建物に付く)
      bldg:lod0RoofEdge  / gml:MultiSurface     (0..1)
      bldg:lod1Solid     / gml:Solid            (0..1、本サービスの中核)
      bldg:lod2Solid / bldg:lod2MultiSurface / bldg:boundedBy  (LOD2 整備区域のみ)
      bldg:address / core:Address / core:xalAddress / xAL:AddressDetails  (0..*)
      uro:*  (_GenericApplicationPropertyOfBuilding: buildingIDAttribute, buildingDetailAttribute,
              buildingDisasterRiskAttribute, buildingDataQualityAttribute, keyValuePairAttribute …)
```

要素の**出現順序は XSD で固定**されている(CityGML の `bldg:` 属性 → 幾何 → `bldg:address` → `uro:` 拡張)。読むだけなら順序に依存しないこと。書く側(`citygml-writer.ts`)は上の順序を守る。

#### 属性ごとの読み方

| 属性 | パス | 型・注意 | 用途 |
|---|---|---|---|
| 築年 | `bldg:yearOfConstruction` | `xs:gYear`。実データは `2013` の 4 桁がほぼ全て。**不明を `0001`・`0`・`9999` で埋めている都市がある**(v1 由来。確度: 中)。1850 未満・当年超は「不明」として捨てる。 | 築年クラスタの種 |
| 階数 | `bldg:storeysAboveGround` | 整数。都市計画基礎調査(建物利用現況)由来。 | 足場面積 |
| 高さ | `bldg:measuredHeight uom="m"` | 小数。航空写真/DSM 由来の計測高で、LOD1 立体の高さと一致するのが原則(v2 以降)。**v1 では measuredHeight 未計測のとき LOD1 高さを階数×3m 等の名目値で作った都市がある**(確度: 中)。立体の上下面差から階数を逆算しない。 | 足場高さの検算 |
| 用途 | `bldg:usage codeSpace="../../codelists/Building_usage.xml"` | コード文字列。`411` 住宅、`412` 共同住宅、`413` 店舗等併用住宅、`414` 店舗等併用共同住宅、`415` 作業所併用住宅(確度: 高)。`401`〜`404` 業務/商業/宿泊/商業系複合、`421` 官公庁、`422` 文教厚生、`431` 運輸倉庫、`441` 工場、`451`〜`454` 農林漁業/供給処理/防衛/その他(確度: 中)。`0..*` なので複数出ることがある。 | 戸建て抽出(`411`,`413`) |
| 住所 | `bldg:address/core:Address/core:xalAddress/xAL:AddressDetails/xAL:Country/{xAL:CountryName, xAL:Locality[@Type="Town"]/xAL:LocalityName[@Type="Name"]}` | PLATEAU は **都道府県+市区町村+町丁目を 1 つの `LocalityName` に連結**して入れる(例 `東京都千代田区丸の内一丁目`)。番地・号までは原則入らない。まれに `xAL:DependentLocality` / `xAL:Thoroughfare` / `xAL:Premise` を使う都市がある(確度: 中)。 | 住所→建物検索の粗い絞り込み。番地照合は国土地理院ジオコーダ等で補う |
| 汎用属性 | `gen:stringAttribute[@name="…"]/gen:value`、`gen:intAttribute`, `gen:doubleAttribute`, `gen:measureAttribute/gen:value[@uom]`, `gen:dateAttribute`, `gen:uriAttribute`, `gen:genericAttributeSet` | v1(2020)では `建物ID`, `大字・町コード`, `町・丁目コード`, `13_区市町村コード_大字・町コード_町・丁目コード`, `浸水ランク`, `土砂災害警戒区域` などが gen で入っていた(確度: 中)。v2 以降は uro に移った。 | v1 データの退避読み |

#### 1.3 幾何 — lod1Solid の読み方と底面の選び方 [確度: 高]

```
bldg:lod1Solid/gml:Solid/gml:exterior/gml:CompositeSurface
  /gml:surfaceMember/gml:Polygon/gml:exterior/gml:LinearRing/gml:posList
```

- `gml:posList` は **EPSG:6697(JGD2011 緯度経度 + 標高)** の 3 つ組 `緯度 経度 標高` を空白区切りで並べる。**緯度が先**。`srsDimension` は通常 `gml:Envelope` にだけ付き `posList` には付かないので、既定 3 とし、`posList[@srsDimension]` があればそれを優先する。
- `gml:pos` の列で書く実装もあり得るので、`posList` が無ければ `gml:pos` を連結する(現行実装済み)。
- 内周(`gml:interior`)は LOD1 では稀だが、中庭型の建物で出る。底面の外周だけ使う。
- LOD1 立体は「底面 1 + 側面 n + 天面 1」の押し出し。**底面の選び方**:
  1. `bldg:lod0FootPrint` があればそれを最優先(z は底面と同じ地盤高)。
  2. 無ければ `lod1Solid` の全ポリゴンのうち、**リング内の z の範囲が 0.5m 未満(水平)** で、**平均 z が最小** のものを底面とする。「最初の surfaceMember が底面」と決め打ちしない(都市・変換ツールによって順序が違う。§6 のサンプル建物 B は天面を先に置いてこれを検査する)。
  3. それも無ければ `lod0RoofEdge`(屋根縁は底面より外に出るので、隣棟間隔がやや小さく出る。警告を残す)。
- 底面ポリゴンは外向き法線が下を向くよう **時計回り**(上から見て)で並ぶのが GML の規約。面積計算で符号が負なら反転して CCW にそろえる。
- **地盤高** = 底面の z。v2 以降は DEM から取った建物位置の標高が入っているので、DEM を読まなくても `groundElevation` はここから取れる。斜面判定(§3)だけ DEM が要る。
- 座標精度: 8 桁小数(≈1mm)。隣棟間隔を出すには十分。

#### 1.4 uro:BuildingDetailAttribute [確度: 中]

```
uro:buildingDetailAttribute/uro:BuildingDetailAttribute
  uro:serialNumberOfBuildingCertification    建築確認番号(通常空)
  uro:siteArea[@uom="m2"]                     敷地面積
  uro:totalFloorArea[@uom="m2"]               延床面積
  uro:buildingFootprintArea[@uom="m2"]        建築面積
  uro:buildingRoofEdgeArea[@uom="m2"]         屋根面積(v1 の gen 由来)
  uro:developmentArea[@uom="m2"]
  uro:buildingStructureType[@codeSpace]       構造: 601 木造・土蔵造, 602 鉄骨鉄筋コンクリート造, 603 鉄筋コンクリート造,
                                              604 鉄骨造, 605 軽量鉄骨造, 606 レンガ造・コンクリートブロック造・石造,
                                              610 非木造, 611 不明   (確度: 中)
  uro:buildingStructureOrgType                自治体独自コード
  uro:fireproofStructureType[@codeSpace]      1001 耐火, 1002 準耐火, 1003 その他, 1004 不明 (確度: 低)
  uro:urbanPlanType / areaClassificationType / districtsAndZonesType / landUseType   都市計画区分・用途地域 等
  uro:vacancy                                 空き家(1=空き家、確度: 低)
  uro:buildingCoverageRate / floorAreaRate / specified* / standard*   建蔽率・容積率
  uro:buildingHeight[@uom="m"]                基礎調査の建物高さ(measuredHeight とは別)
  uro:surveyYear                              基礎調査の調査年(gYear)  ← 築年ではない
  uro:note
```

- v1(uro 1.x)では `uro:buildingDetails/uro:BuildingDetails` という名前だった(確度: 中)。両方のローカル名を探す。
- 本サービスでの使い道: `buildingStructureType=601`(木造)は足場の壁つなぎ・撤去時の屋根荷重の目安、`totalFloorArea` は延床から階数を補う退避(`storeysAboveGround` が無いとき `floor(延床/建築面積+0.5)`)。
- `uro:surveyYear` を `yearOfConstruction` と取り違えない。

#### 1.5 浸水想定 — uro:BuildingRiverFloodingRiskAttribute [確度: 中〜高]

```
uro:buildingDisasterRiskAttribute/uro:BuildingRiverFloodingRiskAttribute   (0..*  河川ごと・規模ごとに複数)
  uro:description[@codeSpace="../../codelists/RiverFloodingRiskAttribute_description.xml"]   河川名(コード。codelist に名前)
  uro:rank[@codeSpace="../../codelists/RiverFloodingRiskAttribute_rank.xml"]                 浸水深ランク
  uro:rankOrg                                                                               自治体独自ランク
  uro:depth[@uom="m"]                                                                        浸水深 [m](小数、あれば最優先)
  uro:adminType[@codeSpace]     1 国管理河川, 2 都道府県管理河川   (確度: 中)
  uro:scale[@codeSpace]         1 計画規模(L1), 2 想定最大規模(L2)   (確度: 中)
  uro:duration[@uom="h"]        浸水継続時間(任意)
```

- `rank` のコードリスト(確度: 中): `1` 0.5m 未満、`2` 0.5m 以上 3m 未満、`3` 3m 以上 5m 未満、`4` 5m 以上 10m 未満、`5` 10m 以上。都市によって `0.5〜1m`/`1〜3m` を分けた `6`/`7` 等の追加コードがある。**必ず同梱の `codelists/RiverFloodingRiskAttribute_rank.xml` を読み、`gml:description` の「Nm以上Mm未満」を正規表現で下限・上限に落とす**(§2.4 と同じ機構)。
- 同じ建物に複数(河川×規模)が付く。本サービスは**「想定最大規模(L2)の最大 `depth`」**を `floodDepth` に採る。`depth` が無く `rank` だけの都市は rank の区間下限を代表値にする。
- 兄弟属性: `uro:BuildingTsunamiRiskAttribute`(津波)、`uro:BuildingHighTideRiskAttribute`(高潮)、`uro:BuildingInlandFloodingRiskAttribute`(内水)、`uro:BuildingLandSlideRiskAttribute`(土砂: `uro:description`, `uro:areaType` 1 警戒区域/2 特別警戒区域)。感電・飛散リスクの啓発優先度には河川・内水・高潮の最大 depth を使う。
- v1 では建物属性としてではなく `udx/fld/`, `udx/tnm/`, `udx/htd/`, `udx/ifld/`, `udx/lsld/` の**面データ**(浸水想定区域ポリゴン + `uro:floodingRiskAttribute`/`uro:rank`/`uro:depth`)として配られた(確度: 中)。v1 だけの都市では面と建物重心の point-in-polygon で付ける退避経路を残す。

#### 1.6 uro 1.x → 2.x/3.x で名前が変わった要素(両方探す) [確度: 中]

| v1 (uro 1.x) | v2 以降 (uro 2.x/3.x) |
|---|---|
| `uro:buildingDetails/uro:BuildingDetails` | `uro:buildingDetailAttribute/uro:BuildingDetailAttribute` |
| `uro:extendedAttribute/uro:KeyValuePairAttribute` | `uro:keyValuePairAttribute/uro:KeyValuePairAttribute`(`uro:key`, `uro:codeValue` / `uro:stringValue` …) |
| `gen:stringAttribute[@name="建物ID"]` | `uro:buildingIDAttribute/uro:BuildingIDAttribute/uro:buildingID` |
| `udx/fld` の面 + `uro:floodingRiskAttribute` | `uro:buildingDisasterRiskAttribute/uro:Building*RiskAttribute` |

---

## 2. tran:Road LOD1 と uro:RoadStructureAttribute

### 2.1 骨格 [確度: 高(tran)、中(uro の子要素の網羅)]

```
core:cityObjectMember
  tran:Road[@gml:id]
    core:creationDate
    tran:class / tran:function[@codeSpace="../../codelists/Road_function.xml"] / tran:usage
    tran:lod0Network                       (線、稀)
    tran:lod1MultiSurface/gml:MultiSurface/gml:surfaceMember/gml:Polygon/gml:exterior/gml:LinearRing/gml:posList
    tran:lod2MultiSurface                  (LOD2 整備区域)
    tran:trafficArea / tran:auxiliaryTrafficArea   (LOD2 以上。車道・歩道の分解)
    uro:roadStructureAttribute/uro:RoadStructureAttribute        (0..* として読む)
      uro:widthType[@codeSpace="../../codelists/RoadStructureAttribute_widthType.xml"]   幅員区分
      uro:width[@uom="m"]                                                               幅員 [m](gml:MeasureType)
      uro:numberOfLanes                                                                  車線数
      uro:sectionType[@codeSpace="../../codelists/RoadStructureAttribute_sectionType.xml"] 区間種別
      uro:sectionID / uro:routeName                                                      区間 ID・路線名(任意)
    uro:trafficVolumeAttribute/uro:TrafficVolumeAttribute   道路交通センサス(幹線のみ: weekday12hourTrafficVolume 等)
    uro:tranDataQualityAttribute
```

- `tran:lod1MultiSurface` の z は **0 か、道路面の標高**(都市による)。幅員推定は 2D で行う。
- 1 つの `tran:Road` が「交差点で切った 1 区間」であることが多い(v2 以降)が、**v1 の一部都市は町丁目単位の巨大 MultiSurface** になっている(確度: 中)。後者は幾何からの幅員推定が効かないので §2.4 の局所測定にする。
- `tran:function`(Road_function.xml、確度: 中): `1` 高速自動車国道、`2` 都市高速道路、`3` 一般国道、`4` 主要地方道、`5` 一般都道府県道、`6` 市区町村道、… 住宅街の区画道路は `6`。車格判定には直接使わず、幅員が全く無いときの最後の退避(市道=4m 級と仮定)にだけ使う。

### 2.2 多重度 [確度: 中]

| 要素 | 多重度 | パーサの扱い |
|---|---|---|
| `uro:roadStructureAttribute` | 0..1(仕様上)。実装によっては複数 | 配列として読み、`width`・`numberOfLanes` は最大値、`widthType` は最初のもの |
| `uro:width` | 0..1 | |
| `uro:widthType` | 0..1 | |
| `uro:numberOfLanes` | 0..1 | |
| `uro:sectionType` | 0..1 | |

### 2.3 コードリストの値と意味 [確度: 低〜中 — 同梱 codelist で確定すること]

`RoadStructureAttribute_widthType.xml`(都市計画基礎調査「道路の状況」の幅員区分に由来)。記憶している区分は次のとおりで、**境界値(3m か 4m か)と 5 段か 4 段かに確信がない**。

| コード | 意味(推定) | 代表値 [m](engine `WIDTH_TYPE_REPRESENTATIVE_METERS`) | 車格 |
|---|---|---|---|
| `1` | 3.0m 未満(4.0m 未満の可能性) | 2.5 | 軽トラ(通行不可の可能性も) |
| `2` | 3.0m 以上 5.5m 未満 | 4.0 | 軽トラ〜2t |
| `3` | 5.5m 以上 13.0m 未満 | 8.0 | 4t |
| `4` | 13.0m 以上 19.5m 未満 | 16.0 | 4t |
| `5` | 19.5m 以上 | 22.0 | 4t |

`RoadStructureAttribute_sectionType.xml`(確度: 低): `1` 一般部、`2` 交差点部、`3` 橋梁部、`4` トンネル部、`5` その他 … 程度。本サービスでは `sectionType` を「交差点部の幅員は道路幅の代表値に使わない」フィルタにだけ使う。

**確定手順(必須)**: 同梱の `codelists/RoadStructureAttribute_widthType.xml` は `gml:Dictionary` で、各 `gml:definitionMember/gml:Definition` に `gml:description`(和文ラベル)と `gml:name`(コード)が入る。ingest 時にこれを読み、ラベルから `/(\d+(?:\.\d+)?)m\s*以上/` と `/(\d+(?:\.\d+)?)m\s*未満/` で下限・上限を抽出して `{code: {min, max}}` を作り、代表値は `min` があれば `min + 0.5`(上限だけなら `max − 0.5`)とする。codelist が無い(v1)ときだけ上表の既定値に落ちる。

### 2.4 幅員の充足状況と多段退避 [確度: 中]

正直な見立て:

- **`uro:width`(数値)が入っている都市は少数**。基礎調査は幅員を「区分」で持つ自治体が多く、数値幅員は道路台帳を持ち込んだ一部都市(政令市・東京都の一部)に限られる。
- **`widthType` だけの都市がかなりある**(v2 以降の基礎調査連携都市)。
- **v1(2020 年度)の多くの都市は `tran:Road` に幾何と `tran:function` しかない**。`uro:RoadStructureAttribute` 自体が無い。
- 数値幅員があっても、それは「道路区間の代表幅員」であり、家の前の実測ではない。

したがって engine の `effectiveRoadWidth()` は次の順で退避し、根拠 `WidthSource` を必ず残す(見積画面に「幅員の根拠」を出す)。

1. `uro:width` があり `> 0` → そのまま(`source: 'uro:width'`)。
2. `uro:widthType` → codelist から区間代表値(`'uro:widthType'`)。
3. **LOD1 幾何からの推定**(`'lod1-geometry'`):
   - 区間ポリゴンが細長い場合、`幅 ≈ 2A / P`(A 面積、P 周長)。矩形なら `2wl/(2w+2l) → w` に収束する。交差点を含む塊状の面では過大になるので、複数ポリゴンの最小値を採る(現行実装)。
   - **建物単位の局所測定(推奨追加)**: 建物底面の道路側の辺の中点から、辺に垂直な光線を道路ポリゴンに向けて飛ばし、ポリゴンに入った点から出た点までの**弦長**を幅員とする。巨大 MultiSurface でも効き、「家の前の幅」に最も近い。弦が 30m を超えたら交差点や広場に当たったとみなして棄却し 2A/P に戻す。
4. 何も無ければ `undefined`(`'unknown'`)。車格は `tran:function=6`(市道)なら 2t、それ以外は 4t を**仮置きし、UI で「幅員未確認」を明示**して事業者確認に回す。

ingest CLI は都市ごとに `width` / `widthType` / 幾何のみ の道路本数を stderr に出し、`meta.widthCoverage` として JSON に残す。

---

## 3. dem:ReliefFeature / dem:TINRelief — 地盤高と勾配

### 3.1 構造 [確度: 高]

```
core:cityObjectMember
  dem:ReliefFeature[@gml:id]
    dem:lod>1</dem:lod
    dem:reliefComponent
      dem:TINRelief[@gml:id]
        dem:lod>1</dem:lod
        dem:tin
          gml:TriangulatedSurface
            gml:trianglePatches
              gml:Triangle              (0..* 数万〜数十万)
                gml:exterior/gml:LinearRing/gml:posList   ← 3 頂点 + 閉点 = 12 数(緯度 経度 標高 ×4)
```

- ファイルは `udx/dem/<メッシュ>_dem_6697_op.gml`。多くの都市で **2 次メッシュ(6 桁)単位** に 1 ファイル、bldg より粗い単位で配られる(確度: 中)。1 ファイルが 100MB 級になる都市があるので、`fast-xml-parser` でツリー化せず **`posList` を正規表現/SAX でストリーム抽出**する。
- 元データは基盤地図情報 5m/10m メッシュ DEM を TIN 化したもの(LOD1)。v3 以降の一部都市は航空レーザ由来の LOD2/3(1m 級)。TIN の三角形辺長は 5〜50m。

### 3.2 建物重心での標高サンプリング(重心座標)

1. 三角形を局所平面(建物と同じ `localProjector(origin)`)に投影し、各三角形の bbox で **均一グリッド(セル 50m)** に登録する。3 次メッシュ 1 枚(約 1km²)なら数千三角形なので線形走査でも可だが、都市全体を読むときはグリッドが要る。
2. 点 `p` を含む三角形 `(a, b, c)` を bbox → 重心座標で判定:
   ```
   d = (b.y − c.y)(a.x − c.x) + (c.x − b.x)(a.y − c.y)
   λ1 = ((b.y − c.y)(p.x − c.x) + (c.x − b.x)(p.y − c.y)) / d
   λ2 = ((c.y − a.y)(p.x − c.x) + (a.x − c.x)(p.y − c.y)) / d
   λ3 = 1 − λ1 − λ2
   内側 ⇔ λ1, λ2, λ3 ∈ [−ε, 1+ε]   (ε = 1e-9)
   z = λ1·a.z + λ2·b.z + λ3·c.z
   ```
   緯度経度のままでも重心座標はアフィン不変なので判定・補間はできるが、勾配は必ずメートル座標で計算する。
3. TIN の隙間(データ境界・メッシュ境界)に落ちた点は、最寄り 3 頂点の逆距離加重で埋め、`groundElevationSource: 'idw'` を残す。
4. `bldg` の底面 z と DEM の差が 2m を超える建物は警告(盛土・擁壁・DEM 更新差)。groundElevation は底面 z を優先し、DEM は勾配にだけ使う。

### 3.3 勾配の導出

- **三角形の平面から**: 三角形 `(a, b, c)` の法線 `n = (b − a) × (c − a)`、勾配 `tan θ = sqrt(nx² + ny²) / |nz|`、`slopePercent = 100 · tan θ`。建物重心が落ちた 1 枚だけだと 5m TIN の微細凹凸を拾うので、
- **推奨**: 重心から ±10m の 4 点(東西南北)で標高をサンプルし中心差分 `gx = (zE − zW)/20`, `gy = (zN − zS)/20`、`slopePercent = 100·sqrt(gx² + gy²)`、`aspect = atan2(gy, gx)`。街区平均は建物ごとの値の中央値。
- 判定閾値(engine 側の既定): **6% 以上を「斜面地」**(足場のジャッキベース・搬出台車の条件が変わる)、12% 以上は「急斜面」(人力搬出・別途見積)。フィクスチャ F ブロックは 12%。

---

## 4. 取得と探索

### 4.1 G空間情報センター(CKAN) [確度: 中]

- データセット URL: `https://www.geospatial.jp/ckan/dataset/plateau-<市区町村コード5桁>-<都市ローマ字>-<整備年度>`
  - 例: `plateau-12100-chiba-shi-2020`(千葉市 2020)、`plateau-14130-kawasaki-shi-2020`、`plateau-14100-yokohama-shi-2020`、東京 23 区は `plateau-tokyo23ku`(2020)/`plateau-tokyo23ku-2022`、`plateau-13100-tokyo23-ku-2023`(年度で命名が揺れる。確度: 低)。
  - 全都市の親データセット `https://www.geospatial.jp/ckan/dataset/plateau` に年度別の一覧がある。
  - CKAN API: `https://www.geospatial.jp/ckan/api/3/action/package_search?q=plateau-12100` で `resources[].url` を取ると zip 直リンクが得られる(確度: 中)。
- zip 名: `<コード>_<都市>_<年度>_citygml_<版>_op.zip`(例 `12100_chiba-shi_2020_citygml_4_op.zip`)。v3 以降は発注主体が入り `12100_chiba-shi_city_2022_citygml_1_op.zip` の形(確度: 中)。大都市は `_1_op`, `_2_op` … と分割される。
- 2023 年度以降は 3D Tiles / MVT を **PLATEAU CMS(`api.plateauview.mlit.go.jp` / `assets.cms.plateau.reearth.io`)** からも配信している。CityGML も同 CMS のデータカタログからダウンロードできる(確度: 中)。

### 4.2 zip の中身 [確度: 高(udx/bldg, udx/tran, udx/dem, codelists)、中(その他)]

```
<コード>_<都市>_<年度>_citygml_<版>_op/
  udx/
    bldg/   53393063_bldg_6697_op.gml        建物(3 次メッシュ単位。v1 の LOD2 都市は 53393063_bldg_6697_2_op.gml 形式)
    tran/   53393063_tran_6697_op.gml        道路
    dem/    533930_dem_6697_op.gml           地形(2 次メッシュ単位が多い)
    luse/   土地利用   urf/ 都市計画決定   fld/ tnm/ htd/ ifld/ lsld/  災害リスク面(v1〜)
    brid/ frn/ veg/ wtr/ area/ unf/ gen/     v3 以降で増える
  codelists/   Building_usage.xml, RoadStructureAttribute_widthType.xml, RiverFloodingRiskAttribute_rank.xml …
  schemas/     iur/uro/… .xsd(uro の版の確定に使う)
  metadata/    メタデータ XML
  specification/ 製品仕様書・拡張仕様書 PDF
  indexmap/    メッシュ索引図(shp/pdf)
  misc/
```

ingest はディレクトリを再帰し `*_bldg_*.gml` / `*_tran_*.gml` / `*_dem_*.gml` をパターンで拾う(接尾の `_2_op`/`_lod2` 等の揺れを吸収する)。

### 4.3 3 次メッシュコード [確度: 高]

8 桁 = 1 次(4 桁)+ 2 次(2 桁)+ 3 次(2 桁)。1 次は緯度×1.5 の整数部 2 桁と経度−100 の 2 桁、2 次は 1 次を 8×8、3 次はさらに 10×10 に分割。3 次メッシュ 1 枚 ≈ 緯度 30″ × 経度 45″ ≈ 南北 0.93km × 東西 1.1km。

```ts
function mesh3(lon: number, lat: number): string {
  const p = Math.floor(lat * 1.5), u = Math.floor(lon) - 100;
  const a = lat * 1.5 - p, b = lon - Math.floor(lon);
  const q = Math.floor(a * 8), v = Math.floor(b * 8);
  const r = Math.floor((a * 8 - q) * 10), w = Math.floor((b * 8 - v) * 10);
  return `${p}${u}${q}${v}${r}${w}`;
}
// mesh3(140.0455, 35.6395) === '53403063'  (千葉市美浜区真砂付近・フィクスチャ原点)
// mesh3(139.767, 35.681)   === '53394611'  (東京駅)
```

住所→建物では、ジオコード結果の (lon, lat) から `mesh3` で対象ファイルを 1 枚(境界付近は隣接 9 枚)に絞ってから読む。

### 4.4 bldg:yearOfConstruction が入っている都市 [確度: 中〜低]

築年は航空写真からは作れない。入るのは **都市計画基礎調査(建物利用現況調査)に「建築年次」項目を持つ自治体**、または固定資産(家屋)台帳を突合した自治体だけ。

| 区分 | 期待 | 確度 |
|---|---|---|
| 東京都 23 区(v1〜) | 東京都の基礎調査(建物現況)に建築年があり、**多数の建物に入っている**。ただし古い建物や未調査で `0`/欠損あり | 中 |
| 政令指定都市で基礎調査を高頻度に行う都市(横浜・川崎・名古屋・大阪・福岡 等) | 入っている都市とほぼ空の都市が混在。**都市ごとに充足率を実測する以外に確かめる方法がない** | 低 |
| 中小都市(v1 の 50 都市の多く) | 空か、`0001` 埋め | 中 |
| v3 以降で「建物用途・築年を基礎調査から付与」を謳う都市 | 充足率が高い傾向 | 低 |

**設計上の結論**: 築年は「あれば強い種、無ければ住民申告で補う」二本立てにする。ingest は都市ごとの **築年充足率(非欠損 ÷ 住宅棟数)** と **年代分布(2010〜2016 年の棟数)** を `meta` に書き、API は充足率 30% 未満の都市で「築年クラスタは参考表示」に落とす。築年が無い建物は `uro:BuildingDetailAttribute/uro:surveyYear`(調査年)で代替**しない**(意味が違う)。

### 4.5 PLATEAU VIEW / 3D Tiles(任意の視覚レイヤ) [確度: 中]

- PLATEAU VIEW(`plateauview.mlit.go.jp`)は 3D Tiles を配信しており、建物タイルの属性(batch table)に `gml:id`, `bldg:usage`, `bldg:measuredHeight`, `bldg:yearOfConstruction` 等が入る。CityGML を解析せずにブラウザで街並みを立てるだけならこれを MapLibre + deck.gl の `Tile3DLayer` で重ねればよい。
- 本サービスの中核(隣棟間隔・幅員)は CityGML から計算した `data/*.json` を使い、3D Tiles は「自分の家が立つ」演出のためのオプションレイヤとする。オフラインデモは同梱 GeoJSON の押し出し(MapLibre `fill-extrusion`)で代替する。

---

## 5. オフラインデモ用フィクスチャ(合成街区)

実装: `packages/plateau/src/fixture.ts`(`generateFixture()`)。出力: `data/sample/masago.json` と、パーサ往復用の `data/sample/masago_bldg_tran_6697_op.gml`。

### 5.1 位置

- 原点(南西隅)`[140.0455, 35.6395]`(千葉市美浜区真砂付近、3 次メッシュ `53403063`)。**座標は例示で、実在の建物・世帯とは無関係**。真砂・磯辺は 1970〜80 年代の埋立造成地で、実際の分譲年とも一致させていない(2012〜2015 の築年はデモ上の設定)。
- 局所座標は正距円筒近似(`localProjector`)。街区全体は東西 260m × 南北 140m。

### 5.2 パラメータ

| 記号 | 値 | 意味 |
|---|---|---|
| `LOT_DEPTH` | 18m | 宅地の奥行 |
| `HOUSE_DEPTH` | 9m ± 0.5 | 家の奥行 |
| `SETBACK` | 2.5m | 道路から外壁までの後退 |
| `ROW_PITCH` | 36m | 背中合わせ 2 列で 1 ブロック |
| 家の幅 | `lotWidth − gap` ± 0.2 | 間口から隣棟間隔を引く |
| `seed` | 20261119 | mulberry32。決定的 |

ブロック(`DEFAULT_BLOCKS`):

| key | 位置 (x, y) | 列あたり | 間口 | 隣棟間隔 | 分譲年 | 3 階率 | 特記 |
|---|---|---|---|---|---|---|---|
| A | (8, 8) | 8 | 8.8 | 1.2 | 2012–2013 | 0.15 | 密集・連棟移設が効く |
| B | (88, 8) | 8 | 8.8 | 1.2 | 2013–2014 | 0.15 | 同上 |
| C | (8, 52) | 8 | 9.0 | 1.4 | 2014–2015 | 0.20 | 同上 |
| D | (88, 52) | 7 | 8.4 | 0.9 | 2013–2014 | 0.35 | 幅員 3m の路地に面す(軽トラのみ) |
| E | (176, 8) | 5 | 14 | 6 | 2013–2014 | 0 | 疎な郊外型(連棟移設不可) |
| F | (176, 52) | 5 | 12 | 4 | 2012–2015 | 0.10 | 斜面 12% + 浸水想定 1.5m |
| G | (8, 96) | 8 | 9.5 | 1.6 | 1992–1998 | 0.05 | 旧い街区(候補から外れる) |
| H | (88, 96) | 7 | 9.5 | 1.6 | 2003–2006 | 0.10 | 同上 |

道路(`DEFAULT_ROADS`): 東西幹線 4 本(幅 6m、2 車線、`widthType=3`)、南北区画道路 4 本(A〜D の間の 2 本は幅 4.5m・1 車線・`widthType=2` = 2t 止まり、E・F の脇の 2 本は幅 6m・2 車線・`widthType=3` = 4t 可)、D ブロック前の路地 1 本(幅 3m、1 車線、`widthType=2` = 軽トラのみ)。全道路に `width`・`numberOfLanes`・`widthType` を入れてあるので、退避経路のテストでは属性を落として使う(§6 の検証で幾何推定 3.38m ← 実幅 4.0m を確認済み)。

### 5.3 期待される統計(seed 20261119 で実測)

| 指標 | 値 |
|---|---|
| 建物数 | **112**(A16 B16 C16 D14 E10 F10 G16 H14) |
| うち 2012〜2015 年築 | 82 |
| 3 階建て | 19(A5 B2 C4 D8 E0 F0 G0 H0) |
| 底面積の平均 | 68〜72 m²(A 68.7, E 71.3, G 72.0) |
| 最寄り隣棟間隔 | 最小 0.76m、中央値 1.34m、最大 6.19m |
| 隣棟 ≤ 1.5m(連棟移設可) | 72 軒 / ≤ 2.0m: 92 軒 |
| 斜面地(≥ 6%) | 10 軒(F) |
| 浸水想定あり | 10 軒(F、1.5m) |
| 道路 | 9 本(6m×6、4.5m×2、3m×1) |
| bbox | lon 140.04560–140.04819, lat 35.63959–35.64067 |

ユニットテストはこれらを固定値として検査する(`fixture.test.ts`)。乱数はジッタ(±0.2m の幅、±0.5m の奥行、3 階判定、年)にしか使わないので、ブロック定義を変えない限り軒数・道路本数は不変。

---

## 6. パーサ単体テスト用の最小 CityGML サンプル

建物 2 棟(2 階建て 2013 年築・浸水想定 1.5m、3 階建て 2014 年築・`lod0FootPrint` 無し・天面を先に記述)+ 道路 1 本(幅 4.0m、1 車線)。隣棟間隔は **1.00m**、建物と道路の距離は 2.5m。座標は §5 と同じ千葉市美浜区付近の例示値。`packages/plateau` の `parseCityGML` で解析し、`groundElevation=3.2`、`floodDepth=1.5`、`footprintArea=68.4`、`gapMeters=1.0`、`effectiveRoadWidth → 4.0 (uro:width)` を得ることを確認済み。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel
  xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:tran="http://www.opengis.net/citygml/transportation/2.0"
  xmlns:dem="http://www.opengis.net/citygml/relief/2.0"
  xmlns:gen="http://www.opengis.net/citygml/generics/2.0"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:uro="https://www.geospatial.jp/iur/uro/3.0"
  xmlns:xAL="urn:oasis:names:tc:ciq:xsdschema:xAL:2.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <gml:boundedBy>
    <gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3">
      <gml:lowerCorner>35.63944161 140.04547789 3.10</gml:lowerCorner>
      <gml:upperCorner>35.63958085 140.04572107 12.70</gml:upperCorner>
    </gml:Envelope>
  </gml:boundedBy>

  <!-- 建物 A: 2 階建て住宅、2013 年築、浸水想定 0.5〜3m -->
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg_00000000-0000-0000-0000-000000000001">
      <core:creationDate>2024-03-01</core:creationDate>
      <gen:stringAttribute name="建物ID">
        <gen:value>12104-bldg-1</gen:value>
      </gen:stringAttribute>
      <bldg:usage codeSpace="../../codelists/Building_usage.xml">411</bldg:usage>
      <bldg:yearOfConstruction>2013</bldg:yearOfConstruction>
      <bldg:measuredHeight uom="m">6.7</bldg:measuredHeight>
      <bldg:storeysAboveGround>2</bldg:storeysAboveGround>
      <bldg:lod0FootPrint>
        <gml:MultiSurface>
          <gml:surfaceMember>
            <gml:Polygon>
              <gml:exterior>
                <gml:LinearRing>
                  <gml:posList>35.63950000 140.04550000 3.20 35.63950000 140.04558401 3.20 35.63958085 140.04558401 3.20 35.63958085 140.04550000 3.20 35.63950000 140.04550000 3.20</gml:posList>
                </gml:LinearRing>
              </gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember>
        </gml:MultiSurface>
      </bldg:lod0FootPrint>
      <bldg:lod1Solid>
        <gml:Solid>
          <gml:exterior>
            <gml:CompositeSurface>
              <!-- 底面 (z = 地盤高 3.20) -->
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04550000 3.20 35.63950000 140.04558401 3.20 35.63958085 140.04558401 3.20 35.63958085 140.04550000 3.20 35.63950000 140.04550000 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <!-- 側面 ×4 -->
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04550000 3.20 35.63950000 140.04558401 3.20 35.63950000 140.04558401 9.90 35.63950000 140.04550000 9.90 35.63950000 140.04550000 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04558401 3.20 35.63958085 140.04558401 3.20 35.63958085 140.04558401 9.90 35.63950000 140.04558401 9.90 35.63950000 140.04558401 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63958085 140.04558401 3.20 35.63958085 140.04550000 3.20 35.63958085 140.04550000 9.90 35.63958085 140.04558401 9.90 35.63958085 140.04558401 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63958085 140.04550000 3.20 35.63950000 140.04550000 3.20 35.63950000 140.04550000 9.90 35.63958085 140.04550000 9.90 35.63958085 140.04550000 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <!-- 天面 (z = 3.20 + 6.7) -->
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04550000 9.90 35.63958085 140.04550000 9.90 35.63958085 140.04558401 9.90 35.63950000 140.04558401 9.90 35.63950000 140.04550000 9.90</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:CompositeSurface>
          </gml:exterior>
        </gml:Solid>
      </bldg:lod1Solid>
      <bldg:address>
        <core:Address>
          <core:xalAddress>
            <xAL:AddressDetails>
              <xAL:Country>
                <xAL:CountryName>日本</xAL:CountryName>
                <xAL:Locality Type="Town">
                  <xAL:LocalityName Type="Name">千葉県千葉市美浜区真砂三丁目</xAL:LocalityName>
                </xAL:Locality>
              </xAL:Country>
            </xAL:AddressDetails>
          </core:xalAddress>
        </core:Address>
      </bldg:address>
      <uro:buildingDetailAttribute>
        <uro:BuildingDetailAttribute>
          <uro:totalFloorArea uom="m2">118.5</uro:totalFloorArea>
          <uro:buildingFootprintArea uom="m2">68.4</uro:buildingFootprintArea>
          <uro:buildingStructureType codeSpace="../../codelists/BuildingDetailAttribute_buildingStructureType.xml">601</uro:buildingStructureType>
          <uro:landUseType codeSpace="../../codelists/Common_landUseType.xml">211</uro:landUseType>
          <uro:surveyYear>2022</uro:surveyYear>
        </uro:BuildingDetailAttribute>
      </uro:buildingDetailAttribute>
      <uro:buildingDisasterRiskAttribute>
        <uro:BuildingRiverFloodingRiskAttribute>
          <uro:description codeSpace="../../codelists/RiverFloodingRiskAttribute_description.xml">1</uro:description>
          <uro:rank codeSpace="../../codelists/RiverFloodingRiskAttribute_rank.xml">2</uro:rank>
          <uro:depth uom="m">1.50</uro:depth>
          <uro:adminType codeSpace="../../codelists/RiverFloodingRiskAttribute_adminType.xml">2</uro:adminType>
          <uro:scale codeSpace="../../codelists/RiverFloodingRiskAttribute_scale.xml">2</uro:scale>
        </uro:BuildingRiverFloodingRiskAttribute>
      </uro:buildingDisasterRiskAttribute>
      <uro:buildingIDAttribute>
        <uro:BuildingIDAttribute>
          <uro:buildingID>12104-bldg-1</uro:buildingID>
          <uro:prefecture codeSpace="../../codelists/Common_prefecture.xml">12</uro:prefecture>
          <uro:city codeSpace="../../codelists/Common_localPublicAuthorities.xml">12104</uro:city>
        </uro:BuildingIDAttribute>
      </uro:buildingIDAttribute>
    </bldg:Building>
  </core:cityObjectMember>

  <!-- 建物 B: 3 階建て住宅、2014 年築、建物 A と 1.0m の隣棟間隔。lod0FootPrint 無し(lod1Solid の底面から輪郭を取る) -->
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg_00000000-0000-0000-0000-000000000002">
      <core:creationDate>2024-03-01</core:creationDate>
      <bldg:usage codeSpace="../../codelists/Building_usage.xml">411</bldg:usage>
      <bldg:yearOfConstruction>2014</bldg:yearOfConstruction>
      <bldg:measuredHeight uom="m">9.5</bldg:measuredHeight>
      <bldg:storeysAboveGround>3</bldg:storeysAboveGround>
      <bldg:lod1Solid>
        <gml:Solid>
          <gml:exterior>
            <gml:CompositeSurface>
              <!-- 天面を先に置く: 「最初の面 = 底面」と決め打ちしないことの確認用 -->
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04559506 12.70 35.63958085 140.04559506 12.70 35.63958085 140.04567907 12.70 35.63950000 140.04567907 12.70 35.63950000 140.04559506 12.70</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04559506 3.20 35.63950000 140.04567907 3.20 35.63950000 140.04567907 12.70 35.63950000 140.04559506 12.70 35.63950000 140.04559506 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04567907 3.20 35.63958085 140.04567907 3.20 35.63958085 140.04567907 12.70 35.63950000 140.04567907 12.70 35.63950000 140.04567907 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63958085 140.04567907 3.20 35.63958085 140.04559506 3.20 35.63958085 140.04559506 12.70 35.63958085 140.04567907 12.70 35.63958085 140.04567907 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63958085 140.04559506 3.20 35.63950000 140.04559506 3.20 35.63950000 140.04559506 12.70 35.63958085 140.04559506 12.70 35.63958085 140.04559506 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.63950000 140.04559506 3.20 35.63950000 140.04567907 3.20 35.63958085 140.04567907 3.20 35.63958085 140.04559506 3.20 35.63950000 140.04559506 3.20</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
            </gml:CompositeSurface>
          </gml:exterior>
        </gml:Solid>
      </bldg:lod1Solid>
      <bldg:address>
        <core:Address>
          <core:xalAddress>
            <xAL:AddressDetails>
              <xAL:Country>
                <xAL:CountryName>日本</xAL:CountryName>
                <xAL:Locality Type="Town">
                  <xAL:LocalityName Type="Name">千葉県千葉市美浜区真砂三丁目</xAL:LocalityName>
                </xAL:Locality>
              </xAL:Country>
            </xAL:AddressDetails>
          </core:xalAddress>
        </core:Address>
      </bldg:address>
    </bldg:Building>
  </core:cityObjectMember>

  <!-- 道路: 幅員 4.0m・1 車線の区画道路。建物の南側 2.5m に接する -->
  <core:cityObjectMember>
    <tran:Road gml:id="tran_00000000-0000-0000-0000-000000000003">
      <core:creationDate>2024-03-01</core:creationDate>
      <tran:function codeSpace="../../codelists/Road_function.xml">6</tran:function>
      <tran:lod1MultiSurface>
        <gml:MultiSurface>
          <gml:surfaceMember>
            <gml:Polygon>
              <gml:exterior>
                <gml:LinearRing>
                  <gml:posList>35.63944161 140.04547789 3.10 35.63944161 140.04572107 3.10 35.63947754 140.04572107 3.10 35.63947754 140.04547789 3.10 35.63944161 140.04547789 3.10</gml:posList>
                </gml:LinearRing>
              </gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember>
        </gml:MultiSurface>
      </tran:lod1MultiSurface>
      <uro:roadStructureAttribute>
        <uro:RoadStructureAttribute>
          <uro:widthType codeSpace="../../codelists/RoadStructureAttribute_widthType.xml">2</uro:widthType>
          <uro:width uom="m">4.0</uro:width>
          <uro:numberOfLanes>1</uro:numberOfLanes>
          <uro:sectionType codeSpace="../../codelists/RoadStructureAttribute_sectionType.xml">1</uro:sectionType>
        </uro:RoadStructureAttribute>
      </uro:roadStructureAttribute>
    </tran:Road>
  </core:cityObjectMember>
</core:CityModel>
```

テストで期待する値:

| 対象 | 期待 |
|---|---|
| 建物 A | `yearOfConstruction=2013`, `storeysAboveGround=2`, `measuredHeight=6.7`, `usage='411'`, `address='千葉県千葉市美浜区真砂三丁目'`, `groundElevation=3.2`, `floodDepth=1.5`, `footprintArea≈68.4`, `perimeter≈33.2` |
| 建物 B | `yearOfConstruction=2014`, `storeysAboveGround=3`, `floodDepth=undefined`, 底面が天面(12.70)ではなく z=3.20 のリングから取れること |
| 隣棟 | `buildAdjacencyGraph` で A↔B の `gapMeters=1.00` |
| 道路 | `width=4`, `numberOfLanes=1`, `widthType='2'`; `effectiveRoadWidth → {4, 'uro:width'}`; `width`・`widthType` を落とすと `{≈3.38, 'lod1-geometry'}`(2A/P 推定は実幅 4.0m をやや過小に出す — 弦長法を入れれば 4.0 になる) |
| 最寄り道路 | 建物 A 重心から道路辺まで ≈ 7.0m(重心は奥行 9m の中央 4.5m + 後退 2.5m) |

---

## 6.5 実データで確認できたこと(2026-09-04、新座市 2020 年度版)

- 取得元: OSM インポート検討用の公開サンプル(nyampire/plateau_samples4import)に同梱されたオリジナル CityGML。館林・新座・毛呂山・松本・伊那の 5 都市分(2020 年度 = uro 1.4)。横浜は OSM 変換後のみ。
- 5 都市とも `bldg:yearOfConstruction`・`storeysAboveGround` は 0%。`measuredHeight` はほぼ 100%。`bldg:usage` は館林・伊那で一部、新座は 0%。`gen:stringAttribute` は「建物ID」「規模」「浸水ランク」(館林)。`uro:buildingDetails` は v1 の名前(§1.6 の表のとおり)。
- 道路(tran)・DEM・codelists は同梱されていない。
- 新座市 3 メッシュ(53395414 / 53395424 / 53395425)= 10,110 棟の取り込みは 6.7 秒、警告 0。底面積の中央値 57 m²、高さの中央値 7 m。
- 築年が無いので形状コホートに退避すると 566 コホート・4,936 棟が「同時期分譲の疑い」になり、最大コホートは 46 棟(底面 59 m²・高さ 7.7 m・隣棟 0.93 m が揃った列)。
- 道路が無いので向かいの建物との間隔から幅員を推定すると、上位 40 コホートの車格は 4t 25 / 2t 13 / 軽トラ 2。家ごとの推定は 4〜17 m とばらつくため束では下位 1/4 を採っている。**tran のある都市では使わない退避**であり、画面には「幅員未確認」を出す。

## 7. 未確定事項の確定手順(実データを触ったときに最初にやること)

1. `schemas/iur/uro/*.xsd` の `targetNamespace` で uro の版を確定し、§1.1 の表を直す。
2. `codelists/RoadStructureAttribute_widthType.xml`・`RiverFloodingRiskAttribute_rank.xml`・`Building_usage.xml` を読み、§2.3・§1.5・§1.2 のコード表を差し替える(ingest は codelist 実読なので動作は変わらない)。
3. `pnpm --filter @ashiba/plateau cli ingest udx/bldg udx/tran -o city.json` を回し、stderr の **築年充足率・幅員充足率・警告** を §4.4/§2.4 の表に書き戻す。
4. 建物 20 棟を無作為に抜き、底面 z と DEM サンプル値の差、`measuredHeight` と立体高さの差を確認する(v1 都市の名目高さ検出)。
