/**
 * PLATEAU 同梱の codelists/*.xml(gml:Dictionary)を読む。
 * 幅員区分(RoadStructureAttribute_widthType)は「3.0m以上5.5m未満」のような和文ラベルなので、
 * 下限・上限を正規表現で取り出し、代表値を決める。
 */
import { XMLParser } from 'fast-xml-parser';

export interface CodeDefinition {
  code: string;
  label: string;
}

export interface WidthTypeRange extends CodeDefinition {
  min?: number;
  max?: number;
  /** 代表幅員 [m]。下限があれば下限 + 0.5、上限だけなら上限 − 0.5。 */
  representative: number;
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  const t = (v as Record<string, unknown>)['#text'];
  return typeof t === 'string' || typeof t === 'number' ? String(t).trim() : '';
}

/** gml:Dictionary → [{code, label}]。 */
export function parseCodelist(xml: string): CodeDefinition[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: true });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const dict = (doc['Dictionary'] ?? doc) as Record<string, unknown>;
  const entries = [...toArray(dict['dictionaryEntry']), ...toArray(dict['definitionMember'])] as Array<Record<string, unknown>>;
  const out: CodeDefinition[] = [];
  for (const e of entries) {
    const def = (e['Definition'] ?? e) as Record<string, unknown>;
    const code = text(def['name']);
    const label = text(def['description']);
    if (code) out.push({ code, label });
  }
  return out;
}

const NUM = '(\\d+(?:\\.\\d+)?)';

/** 幅員区分ラベルから範囲を取り出す。 */
export function parseWidthTypeCodelist(xml: string): Record<string, WidthTypeRange> {
  const out: Record<string, WidthTypeRange> = {};
  for (const { code, label } of parseCodelist(xml)) {
    const norm = label.normalize('NFKC').replace(/\s+/g, '');
    const minM = norm.match(new RegExp(`${NUM}m以上`));
    const maxM = norm.match(new RegExp(`${NUM}m未満`));
    const min = minM ? Number(minM[1]) : undefined;
    const max = maxM ? Number(maxM[1]) : undefined;
    let representative: number;
    if (min !== undefined && max !== undefined) representative = min + Math.min(0.5, (max - min) / 2);
    else if (min !== undefined) representative = min + 0.5;
    else if (max !== undefined) representative = Math.max(0.5, max - 0.5);
    else continue;
    out[code] = { code, label, min, max, representative: Math.round(representative * 100) / 100 };
  }
  return out;
}
