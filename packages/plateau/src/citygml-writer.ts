/**
 * Building / Road から PLATEAU 風の CityGML を書き出す(パーサの往復テストと
 * 「実データと同じ経路で読める」ことの証明に使う)。属性は最小限。
 */
import type { Building, Road } from '@ashiba/engine';

function posList(ring: readonly [number, number][], h: number): string {
  return ring.map(([lon, lat]) => `${lat.toFixed(8)} ${lon.toFixed(8)} ${h.toFixed(2)}`).join(' ');
}

function polygon(ring: readonly [number, number][], h: number): string {
  return `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${posList(ring, h)}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function writeCityGML(buildings: readonly Building[], roads: readonly Road[]): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:tran="http://www.opengis.net/citygml/transportation/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:uro="https://www.geospatial.jp/iur/uro/3.0" xmlns:xAL="urn:oasis:names:tc:ciq:xsdschema:xAL:2.0">',
  );
  for (const b of buildings) {
    const ground = b.groundElevation ?? 0;
    const height = b.measuredHeight ?? (b.storeysAboveGround ?? 2) * 3;
    const top = ground + height;
    const ring = b.footprint;
    const walls: string[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i]!;
      const q = ring[i + 1]!;
      walls.push(
        `<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${[
          `${p[1].toFixed(8)} ${p[0].toFixed(8)} ${ground.toFixed(2)}`,
          `${q[1].toFixed(8)} ${q[0].toFixed(8)} ${ground.toFixed(2)}`,
          `${q[1].toFixed(8)} ${q[0].toFixed(8)} ${top.toFixed(2)}`,
          `${p[1].toFixed(8)} ${p[0].toFixed(8)} ${top.toFixed(2)}`,
          `${p[1].toFixed(8)} ${p[0].toFixed(8)} ${ground.toFixed(2)}`,
        ].join(' ')}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>`,
      );
    }
    parts.push(`<core:cityObjectMember><bldg:Building gml:id="${escapeXml(b.id)}">`);
    if (b.usage) parts.push(`<bldg:usage codeSpace="../../codelists/Building_usage.xml">${escapeXml(b.usage)}</bldg:usage>`);
    if (b.yearOfConstruction) parts.push(`<bldg:yearOfConstruction>${b.yearOfConstruction}</bldg:yearOfConstruction>`);
    if (b.measuredHeight) parts.push(`<bldg:measuredHeight uom="m">${b.measuredHeight.toFixed(1)}</bldg:measuredHeight>`);
    if (b.storeysAboveGround) parts.push(`<bldg:storeysAboveGround>${b.storeysAboveGround}</bldg:storeysAboveGround>`);
    parts.push(
      `<bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember>${polygon(ring, ground)}</gml:surfaceMember>${walls.join('')}<gml:surfaceMember>${polygon([...ring].reverse(), top)}</gml:surfaceMember></gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>`,
    );
    if (b.address) {
      parts.push(
        `<bldg:address><core:Address><core:xalAddress><xAL:AddressDetails><xAL:Country><xAL:CountryName>日本</xAL:CountryName><xAL:Locality Type="Town"><xAL:LocalityName Type="Name">${escapeXml(b.address)}</xAL:LocalityName></xAL:Locality></xAL:Country></xAL:AddressDetails></core:xalAddress></core:Address></bldg:address>`,
      );
    }
    if (b.floodDepth !== undefined) {
      parts.push(
        `<uro:buildingDisasterRiskAttribute><uro:BuildingRiverFloodingRiskAttribute><uro:description codeSpace="../../codelists/RiverFloodingRiskAttribute_description.xml">1</uro:description><uro:rank codeSpace="../../codelists/RiverFloodingRiskAttribute_rank.xml">2</uro:rank><uro:depth uom="m">${b.floodDepth.toFixed(2)}</uro:depth></uro:BuildingRiverFloodingRiskAttribute></uro:buildingDisasterRiskAttribute>`,
      );
    }
    parts.push('</bldg:Building></core:cityObjectMember>');
  }
  for (const r of roads) {
    parts.push(`<core:cityObjectMember><tran:Road gml:id="${escapeXml(r.id)}">`);
    parts.push(
      `<tran:lod1MultiSurface><gml:MultiSurface>${r.polygons.map((p) => `<gml:surfaceMember>${polygon(p, 0)}</gml:surfaceMember>`).join('')}</gml:MultiSurface></tran:lod1MultiSurface>`,
    );
    if (r.width !== undefined || r.numberOfLanes !== undefined || r.widthType !== undefined) {
      parts.push('<uro:roadStructureAttribute><uro:RoadStructureAttribute>');
      if (r.widthType !== undefined) parts.push(`<uro:widthType codeSpace="../../codelists/RoadStructureAttribute_widthType.xml">${escapeXml(r.widthType)}</uro:widthType>`);
      if (r.width !== undefined) parts.push(`<uro:width uom="m">${r.width.toFixed(1)}</uro:width>`);
      if (r.numberOfLanes !== undefined) parts.push(`<uro:numberOfLanes>${r.numberOfLanes}</uro:numberOfLanes>`);
      parts.push('</uro:RoadStructureAttribute></uro:roadStructureAttribute>');
    }
    parts.push('</tran:Road></core:cityObjectMember>');
  }
  parts.push('</core:CityModel>');
  return parts.join('\n');
}
