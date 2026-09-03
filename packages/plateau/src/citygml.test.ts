import { describe, expect, it } from 'vitest';
import { parseCityGML } from './citygml.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/2.0"
  xmlns:tran="http://www.opengis.net/citygml/transportation/2.0"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:uro="https://www.geospatial.jp/iur/uro/3.0"
  xmlns:xAL="urn:oasis:names:tc:ciq:xsdschema:xAL:2.0">
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg_a">
      <bldg:usage>411</bldg:usage>
      <bldg:yearOfConstruction>2013</bldg:yearOfConstruction>
      <bldg:measuredHeight uom="m">6.9</bldg:measuredHeight>
      <bldg:storeysAboveGround>2</bldg:storeysAboveGround>
      <bldg:lod1Solid>
        <gml:Solid>
          <gml:exterior>
            <gml:CompositeSurface>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.650000 140.050000 3.0 35.650000 140.050100 3.0 35.650090 140.050100 3.0 35.650090 140.050000 3.0 35.650000 140.050000 3.0</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.650000 140.050000 9.9 35.650090 140.050000 9.9 35.650090 140.050100 9.9 35.650000 140.050100 9.9 35.650000 140.050000 9.9</gml:posList>
                    </gml:LinearRing>
                  </gml:exterior>
                </gml:Polygon>
              </gml:surfaceMember>
              <gml:surfaceMember>
                <gml:Polygon>
                  <gml:exterior>
                    <gml:LinearRing>
                      <gml:posList>35.650000 140.050000 3.0 35.650000 140.050000 9.9 35.650000 140.050100 9.9 35.650000 140.050100 3.0 35.650000 140.050000 3.0</gml:posList>
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
                  <xAL:LocalityName Type="Name">千葉県千葉市美浜区真砂</xAL:LocalityName>
                </xAL:Locality>
              </xAL:Country>
            </xAL:AddressDetails>
          </core:xalAddress>
        </core:Address>
      </bldg:address>
      <uro:buildingDisasterRiskAttribute>
        <uro:BuildingRiverFloodingRiskAttribute>
          <uro:description codeSpace="../../codelists/RiverFloodingRiskAttribute_description.xml">1</uro:description>
          <uro:rank codeSpace="../../codelists/RiverFloodingRiskAttribute_rank.xml">2</uro:rank>
          <uro:depth uom="m">1.2</uro:depth>
        </uro:BuildingRiverFloodingRiskAttribute>
      </uro:buildingDisasterRiskAttribute>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <bldg:Building gml:id="bldg_b">
      <bldg:usage>402</bldg:usage>
      <bldg:lod1Solid>
        <gml:Solid><gml:exterior><gml:CompositeSurface>
          <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
            <gml:posList>35.650200 140.050000 3.0 35.650200 140.050100 3.0 35.650290 140.050100 3.0 35.650290 140.050000 3.0 35.650200 140.050000 3.0</gml:posList>
          </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
        </gml:CompositeSurface></gml:exterior></gml:Solid>
      </bldg:lod1Solid>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <tran:Road gml:id="tran_1">
      <tran:lod1MultiSurface>
        <gml:MultiSurface>
          <gml:surfaceMember>
            <gml:Polygon>
              <gml:exterior>
                <gml:LinearRing>
                  <gml:posList>35.649900 140.049900 3.0 35.649900 140.051000 3.0 35.649950 140.051000 3.0 35.649950 140.049900 3.0 35.649900 140.049900 3.0</gml:posList>
                </gml:LinearRing>
              </gml:exterior>
            </gml:Polygon>
          </gml:surfaceMember>
        </gml:MultiSurface>
      </tran:lod1MultiSurface>
      <uro:roadStructureAttribute>
        <uro:RoadStructureAttribute>
          <uro:widthType codeSpace="../../codelists/RoadStructureAttribute_widthType.xml">2</uro:widthType>
          <uro:width uom="m">4.5</uro:width>
          <uro:numberOfLanes>1</uro:numberOfLanes>
        </uro:RoadStructureAttribute>
      </uro:roadStructureAttribute>
    </tran:Road>
  </core:cityObjectMember>
</core:CityModel>`;

describe('parseCityGML', () => {
  const result = parseCityGML(SAMPLE);

  it('reads buildings with attributes and a ground footprint in (lon, lat)', () => {
    expect(result.buildings).toHaveLength(2);
    const a = result.buildings.find((b) => b.id === 'bldg_a')!;
    expect(a.yearOfConstruction).toBe(2013);
    expect(a.storeysAboveGround).toBe(2);
    expect(a.measuredHeight).toBeCloseTo(6.9);
    expect(a.usage).toBe('411');
    expect(a.address).toBe('千葉県千葉市美浜区真砂');
    expect(a.floodDepth).toBeCloseTo(1.2);
    expect(a.groundElevation).toBeCloseTo(3.0);
    // 先頭点は (lon, lat) の順
    expect(a.footprint[0]).toEqual([140.05, 35.65]);
    // 約 9m × 10m
    expect(a.footprintArea).toBeGreaterThan(80);
    expect(a.footprintArea).toBeLessThan(100);
  });

  it('filters by usage when asked', () => {
    const only = parseCityGML(SAMPLE, { usageFilter: ['411'] });
    expect(only.buildings.map((b) => b.id)).toEqual(['bldg_a']);
  });

  it('reads roads with uro:RoadStructureAttribute', () => {
    expect(result.roads).toHaveLength(1);
    const r = result.roads[0]!;
    expect(r.id).toBe('tran_1');
    expect(r.width).toBeCloseTo(4.5);
    expect(r.numberOfLanes).toBe(1);
    expect(r.widthType).toBe('2');
    expect(r.polygons[0]!.length).toBe(5);
  });

  it('reports warnings without throwing on geometry-less objects', () => {
    const broken = SAMPLE.replace(/<bldg:lod1Solid>[\s\S]*?<\/bldg:lod1Solid>/, '');
    const r = parseCityGML(broken);
    expect(r.buildings).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('bldg_a'))).toBe(true);
  });
});
