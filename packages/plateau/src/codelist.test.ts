import { describe, expect, it } from 'vitest';
import { parseCodelist, parseWidthTypeCodelist } from './codelist.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gml:Dictionary xmlns:gml="http://www.opengis.net/gml" gml:id="RoadStructureAttribute_widthType">
  <gml:name>RoadStructureAttribute_widthType</gml:name>
  <gml:dictionaryEntry><gml:Definition gml:id="id1"><gml:description>3.0m未満</gml:description><gml:name>1</gml:name></gml:Definition></gml:dictionaryEntry>
  <gml:dictionaryEntry><gml:Definition gml:id="id2"><gml:description>3.0m以上5.5m未満</gml:description><gml:name>2</gml:name></gml:Definition></gml:dictionaryEntry>
  <gml:dictionaryEntry><gml:Definition gml:id="id3"><gml:description>5.5m以上13.0m未満</gml:description><gml:name>3</gml:name></gml:Definition></gml:dictionaryEntry>
  <gml:dictionaryEntry><gml:Definition gml:id="id4"><gml:description>19.5m以上</gml:description><gml:name>5</gml:name></gml:Definition></gml:dictionaryEntry>
  <gml:dictionaryEntry><gml:Definition gml:id="id5"><gml:description>不明</gml:description><gml:name>9</gml:name></gml:Definition></gml:dictionaryEntry>
</gml:Dictionary>`;

describe('codelists', () => {
  it('parses definitions', () => {
    expect(parseCodelist(XML)).toHaveLength(5);
    expect(parseCodelist(XML)[1]).toEqual({ code: '2', label: '3.0m以上5.5m未満' });
  });
  it('derives width ranges and representative widths', () => {
    const t = parseWidthTypeCodelist(XML);
    expect(t['1']).toMatchObject({ max: 3, representative: 2.5 });
    expect(t['2']).toMatchObject({ min: 3, max: 5.5, representative: 3.5 });
    expect(t['3']).toMatchObject({ min: 5.5, max: 13, representative: 6 });
    expect(t['5']).toMatchObject({ min: 19.5, representative: 20 });
    expect(t['9']).toBeUndefined();
  });
});
