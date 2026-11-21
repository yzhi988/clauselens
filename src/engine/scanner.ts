import { rules } from '../data/rules';
import type { Clause, MatchRange, RiskHit, RiskRule, ScanResult, ScanScenario } from './types';

interface ClauseMarker {
  start: number;
  end: number;
  number: string;
}

// Only short, non-sentence labels are treated as titles. In ambiguous cases,
// keeping the line in the body is safer than hiding a potential risk in a title.
function isShortTitle(text: string): boolean {
  return text.length > 0 && text.length <= 20
    && !/[，,。.!！?？；;：:<>]/u.test(text)
    && !/(?:应当|必须|不得|无需|无须|有权|无权|可以|一律|任何|不予|不退|不承担|须|应|均|全部|所有|承担|(?<!与|及)支付|扣除|扣减|赔偿|收取|归属于)/u.test(text);
}

function splitTitle(content: string): { title: string; text: string } {
  const body = content.trim();
  const lineBreak = /\r\n?|\n/u.exec(body);
  if (lineBreak) {
    const heading = body.slice(0, lineBreak.index).trim();
    const remainder = body.slice(lineBreak.index + lineBreak[0].length).trim();
    if (remainder && isShortTitle(heading)) return { title: heading, text: remainder };
  }

  // Also accept a short inline label, such as “租赁期限：租期一年。”
  const label = /^([^\r\n：:]+)[：:][\t \u3000]*([\s\S]+)$/u.exec(body);
  if (label && isShortTitle(label[1].trim()) && label[2].trim()) {
    return { title: label[1].trim(), text: label[2].trim() };
  }
  return { title: '', text: body };
}

/** Parse plain text without executing HTML or discarding an unnumbered preamble. */
export function parseClauses(text: string): Clause[] {
  if (!text.trim()) return [];

  // Arabic/Chinese list numbers must start a line, avoiding decimals in prose.
  // Article markers may also follow a sentence boundary on the same line.
  const markerPattern = /(第[零〇一二三四五六七八九十百千万两0-9０-９]+条)|^[\t \u3000]*([0-9０-９]+[.．、)）](?![0-9０-９])|[零〇一二三四五六七八九十百千万两]+、|[（(][零〇一二三四五六七八九十百千万两0-9０-９]+[）)])/gmu;
  const markers: ClauseMarker[] = [];
  for (const match of text.matchAll(markerPattern)) {
    // Do not turn references such as “依照本合同第二条执行” into headings.
    if (match[1] && match.index > 0 && !/[\s。！？；.!?;]/u.test(text[match.index - 1])) continue;
    markers.push({ start: match.index, end: match.index + match[0].length, number: match[1] ?? match[2] });
  }

  const clauses: Clause[] = [];
  const append = (number: string, title: string, body: string) => {
    clauses.push({ id: `clause-${clauses.length}`, number, title, text: body });
  };
  const appendParagraphs = (content: string, title: string) => {
    // Blank lines delimit paragraphs; line wrapping inside a paragraph survives.
    for (const paragraph of content.split(/(?:\r\n?|\n)(?:[^\S\r\n]*(?:\r\n?|\n))+/u)) {
      if (paragraph.trim()) append('', title, paragraph.trim());
    }
  };

  if (!markers.length) {
    appendParagraphs(text, '');
    return clauses;
  }

  appendParagraphs(text.slice(0, markers[0].start), '前言');
  for (const [index, marker] of markers.entries()) {
    const content = text.slice(marker.end, markers[index + 1]?.start ?? text.length);
    const { title, text: body } = splitTitle(content);
    append(marker.number, title, body);
  }
  return clauses;
}

function matchRanges(text: string, rule: RiskRule): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const pattern of rule.patterns) {
    // Patterns describe searchable text, not a mutable regex cursor. Cloning
    // leaves caller-owned lastIndex untouched; matchAll advances empty matches
    // correctly even for Unicode surrogate pairs. Empty highlights are omitted.
    const search = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`);
    for (const match of text.matchAll(search)) {
      if (match[0].length) ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** All ranges are half-open JavaScript UTF-16 offsets into the owning clause.text. */
export function scanContract(
  text: string,
  scenario: ScanScenario = 'auto',
  ruleSet: RiskRule[] = rules,
): ScanResult {
  const clauses = parseClauses(text);
  const activeRules = ruleSet.filter(rule => scenario === 'auto'
    ? new RegExp(rule.context.source, rule.context.flags).test(text)
    : rule.scenario === scenario);
  const hits: RiskHit[] = [];
  const counts: ScanResult['counts'] = { high: 0, medium: 0, low: 0 };

  for (const clause of clauses) {
    const clauseHits: RiskHit[] = [];
    for (const rule of activeRules) {
      const ranges = matchRanges(clause.text, rule);
      if (!ranges.length) continue;
      clauseHits.push({
        id: `${clause.id}-${rule.id}`,
        clauseId: clause.id,
        rule,
        ranges,
        excerpt: ranges.map(range => clause.text.slice(range.start, range.end)).join(' … '),
      });
      counts[rule.severity] += 1;
    }
    clauseHits.sort((a, b) => a.ranges[0].start - b.ranges[0].start);
    hits.push(...clauseHits);
  }

  const overall = counts.high ? 'high' : counts.medium ? 'medium' : counts.low ? 'low' : 'none';
  return { clauses, hits, counts, overall };
}
