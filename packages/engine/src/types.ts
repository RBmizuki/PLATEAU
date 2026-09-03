/**
 * 足場の割り勘 — 段差価格エンジンの公開型。
 *
 * すべての座標は WGS84 (lon, lat)。距離・面積の計算はエンジン内部で
 * 局所平面近似(メートル)に変換して行う。
 */

export type LngLat = [lon: number, lat: number];

/** PLATEAU bldg:Building (LOD1) から正規化した建物。 */
export interface Building {
  /** gml:id */
  id: string;
  /** LOD1 底面の外周リング(閉じている: 先頭と末尾が同じ点)。 */
  footprint: LngLat[];
  centroid: LngLat;
  /** bldg:storeysAboveGround */
  storeysAboveGround?: number;
  /** bldg:measuredHeight [m] */
  measuredHeight?: number;
  /** bldg:yearOfConstruction */
  yearOfConstruction?: number;
  /** bldg:usage コード(例: "411" 住宅)。 */
  usage?: string;
  /** bldg:address を平文化したもの。 */
  address?: string;
  /** dem から取った地盤高 [m]。 */
  groundElevation?: number;
  /** 周辺の地盤勾配 [%]。斜面地判定用。 */
  groundSlopePercent?: number;
  /** uro:BuildingRiverFloodingRiskAttribute 等からの想定浸水深 [m]。 */
  floodDepth?: number;
  /** 底面積 [m^2](エンジンが算出)。 */
  footprintArea: number;
  /** 底面外周長 [m](エンジンが算出)。 */
  perimeter: number;
}

/** PLATEAU tran:Road (LOD1) + uro:RoadStructureAttribute から正規化した道路。 */
export interface Road {
  id: string;
  /** LOD1 面の外周リング群(閉じている)。 */
  polygons: LngLat[][];
  /** uro:RoadStructureAttribute/uro:width [m] */
  width?: number;
  /** uro:RoadStructureAttribute/uro:numberOfLanes */
  numberOfLanes?: number;
  /** uro:RoadStructureAttribute/uro:widthType コード */
  widthType?: string;
}

/** 車格。道路幅員から決まる「その街区に入れる最大の車」。 */
export type VehicleClass = 'kei' | '2t' | '4t';

/** 隣棟関係。 */
export interface Neighbor {
  buildingId: string;
  /** 外壁面間の最短距離 [m](LOD1 輪郭の実寸から)。 */
  gapMeters: number;
}

export interface AdjacencyGraph {
  /** buildingId -> 近い順に並んだ隣棟。 */
  neighbors: Record<string, Neighbor[]>;
}

/** 太陽光設備の申告値(所有者の自己入力)。 */
export interface PanelInstallation {
  buildingId: string;
  /** 設置年(西暦)。 */
  installYear: number;
  /** 設備容量 [kW]。未入力なら既定値を使う。 */
  capacityKw?: number;
}

/** 築年クラスタ = 同時期分譲・同時期搭載が疑われる街区単位の束の種。 */
export interface YearCluster {
  id: string;
  /** クラスタの代表年(中央値)。 */
  medianYear: number;
  yearMin: number;
  yearMax: number;
  buildingIds: string[];
  centroid: LngLat;
  /** 断定表示しない「候補」の軒数(登録前)。 */
  candidateCount: number;
}

/**
 * 単価表。公表相場の概算で駆動し、事業者値に差し替え可能。
 * 金額はすべて円(税抜)。
 */
export interface RateTable {
  /** 単価表の識別子(例: "public-2026-estimate" / 事業者名)。 */
  id: string;
  label: string;
  /** 出典・注記。 */
  note?: string;

  scaffold: {
    /** 足場材の搬入・搬出と架払い準備。現場(束)あたり固定。 */
    mobilizationPerSite: number;
    /** 足場の組立・解体。外壁面積 [m^2] あたり。 */
    perWallSqm: number;
    /** 1軒あたりの最低足場費(小さな家でも下限)。 */
    minimumPerHouse: number;
    /** 連棟移設が成立する隣棟間隔の上限 [m]。 */
    relocationMaxGapMeters: number;
    /** 連棟移設が効く軒の組立・解体単価の掛け率(0〜1)。 */
    relocationFactor: number;
    /** 階数→標準階高 [m]。 */
    storeyHeightMeters: number;
  };

  vehicle: {
    /** 車格ごとの 1台1日あたり費用(運転手込み)。 */
    dayCost: Record<VehicleClass, number>;
    /** 車格ごとのパネル積載枚数(架台込みの実効値)。 */
    panelCapacity: Record<VehicleClass, number>;
    /** 道路幅員 [m] の下限。これ未満なら一つ下の車格に落ちる。 */
    minRoadWidth: Record<VehicleClass, number>;
    /** 斜面地(勾配 [%] がこの値以上)では車格を 1 段落とす。 */
    slopePercentDowngrade: number;
  };

  disposal: {
    /** パネル 1 枚あたりの処分費。 */
    perPanel: number;
    /** 処分場への運搬。1 トリップ(=1台)あたり。 */
    transportPerTrip: number;
  };

  labor: {
    /** 電気工事(切離し・パワコン撤去)。1軒固定。 */
    electricalPerHouse: number;
    /** パネル・架台の取外し。パネル 1 枚あたり。 */
    removalPerPanel: number;
    /** 架台跡の防水補修。1軒固定。 */
    roofRepairPerHouse: number;
    /** 班の出動費(移動・段取り)。1出動日あたり。 */
    crewMobilizationPerDay: number;
    /** 1 班が 1 日に処理できる軒数。 */
    housesPerCrewDay: number;
  };

  /** kW → パネル枚数の換算(1枚あたり kW)。 */
  kwPerPanel: number;
  /** 容量未入力時の既定容量 [kW]。 */
  defaultCapacityKw: number;
  /** 事業者への成約手数料率(0〜1)。リード価値の算出用。 */
  leadFeeRate: number;
}

/** 束(共同撤去枠)に入る 1 軒の入力。 */
export interface BundleMember {
  building: Building;
  installation: PanelInstallation;
}

/** 束を評価するための街区条件。 */
export interface SiteContext {
  /** 街区に入れる車格(道路幅員・斜面から判定済み)。 */
  vehicleClass: VehicleClass;
  /** 車格判定の根拠。 */
  vehicleReason: string;
  /** 隣接グラフ(連棟移設の判定に使う)。 */
  adjacency: AdjacencyGraph;
}

/** 1 軒ぶんの内訳。 */
export interface HouseBreakdown {
  buildingId: string;
  panels: number;
  wallAreaSqm: number;
  /** この軒は連棟移設の恩恵を受けたか。 */
  scaffoldRelocated: boolean;
  scaffold: number;
  vehicle: number;
  disposal: number;
  electrical: number;
  removal: number;
  roofRepair: number;
  crew: number;
  total: number;
}

/** 束サイズ n の評価結果。 */
export interface BundleQuote {
  size: number;
  vehicleClass: VehicleClass;
  trucks: number;
  crewDays: number;
  /** 連棟移設が効いた軒数。 */
  relocatedHouses: number;
  totalPanels: number;
  /** 束全体の合計。 */
  bundleTotal: number;
  /** 1 軒あたり平均。 */
  perHouseAverage: number;
  perHouse: HouseBreakdown[];
  /** 費目別の束合計。 */
  byCategory: {
    scaffold: number;
    vehicle: number;
    disposal: number;
    electrical: number;
    removal: number;
    roofRepair: number;
    crew: number;
  };
}

/** 段差価格の 1 段。 */
export interface StaircaseStep {
  size: number;
  perHouseAverage: number;
  trucks: number;
  crewDays: number;
  /** 直前の段からの差分(負なら安くなった)。 */
  deltaFromPrevious: number;
  /** 直前の段から車両が増えたか(正直に戻る段)。 */
  truckAdded: boolean;
  /** 単独価格に対する削減率(0〜1)。 */
  savingsRate: number;
}

export interface Staircase {
  rateTableId: string;
  vehicleClass: VehicleClass;
  singlePrice: number;
  steps: StaircaseStep[];
  /** 最も安い段。 */
  best: StaircaseStep;
}

/** 束の成立判定。 */
export type BundleStatus = 'forming' | 'threshold_met' | 'handed_to_contractor' | 'cancelled';

/** 事業者への発注仕様。 */
export interface LeadSpec {
  bundleId: string;
  clusterId: string;
  /** ISO 週(例: 2026-W47)。 */
  week: string;
  vehicleClass: VehicleClass;
  members: Array<{
    buildingId: string;
    address?: string;
    panels: number;
    storeys?: number;
    wallAreaSqm: number;
    scaffoldRelocated: boolean;
  }>;
  quote: BundleQuote;
  /** 想定リード価値(bundleTotal × leadFeeRate)。 */
  leadValue: number;
  /** 車両の巡回順(buildingId の列)。 */
  route: string[];
  /** 注意事項(斜面・浸水想定など)。 */
  notes: string[];
}
