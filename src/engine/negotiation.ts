import type { Clause, RiskHit, Scenario } from './types';

export type Tone = 'gentle' | 'firm';

export interface NegotiationInput {
  title: string;
  clauses: Clause[];
  hits: RiskHit[];
  selectedIds: string[];
  tone: Tone;
  scenario: Scenario | 'auto';
}

const addressees: Record<NegotiationInput['scenario'], string> = {
  rental: '房东', internship: 'HR', fitness: '商家', auto: '对方',
};
const toneLabels: Record<Tone, string> = { gentle: '温和商量版', firm: '坚定底线版' };
const draftBoundary = '协商草案 · 未达成合意';
const riskNotice = '本内容仅为风险提示与协商参考，不构成正式法律意见，不对合同效力或裁判结果作出结论。扫描可能误报或漏报，具体权利义务须结合事实及适用法律核实。';
const integrationNotice = '多项建议需由双方结合完整条款整合并书面确认，不自动替换原条款，也不自动成为正式合同。未选内容的保留不代表已完成审查或确认无风险。';
const htmlEntities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, character => htmlEntities[character]);
}

function escapeMarkdown(text: string): string {
  // Escape ASCII punctuation, including link/image syntax and bare-URL dots/colons.
  // HTML entities preserve literal angle brackets without enabling inline HTML.
  return text.replace(/[\\!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~]/g,
    character => htmlEntities[character] ?? `\\${character}`);
}

function documentTitle(input: NegotiationInput): string {
  return input.title.trim() ? input.title : '当前合同';
}

function clauseLabel(clause: Clause, index: number): string {
  return [clause.number || `原文第${index + 1}段`, clause.title].filter(Boolean).join(' ');
}

/** Keep the scanner's document order, selecting high/medium risks only. */
export function defaultSelectedIds(hits: RiskHit[]): string[] {
  return [...new Set(hits.filter(hit => hit.rule.severity === 'high' || hit.rule.severity === 'medium')
    .map(hit => hit.id))];
}

/** Resolve current IDs once; ignore stale/orphan hits and never mutate input arrays. */
export function selectedHits(input: NegotiationInput): RiskHit[] {
  const requested = new Set(input.selectedIds);
  const clauseOrder = new Map(input.clauses.map((clause, index) => [clause.id, index]));
  const seen = new Set<string>();
  return input.hits.filter(hit => {
    if (!requested.has(hit.id) || seen.has(hit.id) || !clauseOrder.has(hit.clauseId)) return false;
    seen.add(hit.id);
    return true;
  }).map((hit, index) => ({
    hit,
    index,
    clauseIndex: clauseOrder.get(hit.clauseId)!,
    start: hit.ranges.reduce((earliest, range) => Math.min(earliest, range.start), Infinity),
  })).sort((a, b) => a.clauseIndex - b.clauseIndex || a.start - b.start || a.index - b.index)
    .map(item => item.hit);
}

/** A selected clause occurs once, with individually ordered, selected suggestions. */
export function groupRedlines(input: NegotiationInput): Array<{ clause: Clause; hits: RiskHit[] }> {
  const clauses = new Map(input.clauses.map(clause => [clause.id, clause]));
  const groups = new Map<string, { clause: Clause; hits: RiskHit[] }>();
  for (const hit of selectedHits(input)) {
    let group = groups.get(hit.clauseId);
    if (!group) {
      group = { clause: clauses.get(hit.clauseId)!, hits: [] };
      groups.set(hit.clauseId, group);
    }
    group.hits.push(hit);
  }
  return [...groups.values()];
}

function communicationParagraphs(input: NegotiationInput): string[] {
  const hits = selectedHits(input);
  if (!hits.length) return [];
  const labels = new Map(input.clauses.map((clause, index) => [clause.id, clauseLabel(clause, index)]));
  const opening = `${addressees[input.scenario]}您好：\n${input.tone === 'gentle'
    ? `感谢您提供《${documentTitle(input)}》。我希望在理解双方安排的基础上，就以下事项一起确认，让约定更清楚，也便于双方履行。`
    : `关于《${documentTitle(input)}》，以下是我提出的书面修改要求，请逐项核对并在合同修订稿中明确落实。`}`;
  const items = hits.map((hit, index) => {
    const heading = `${index + 1}. ${labels.get(hit.clauseId)}｜${hit.rule.title}`;
    const request = input.tone === 'gentle'
      ? `${hit.rule.script}\n具体修改建议：${hit.rule.suggestion}`
      : `请就本事项作出明确书面修改，建议条文如下：${hit.rule.suggestion}`;
    return `${heading}\n${request}`;
  });
  const closing = input.tone === 'gentle'
    ? '如果您有不同考虑，我们可以继续商量。请您逐项回复，并将双方商定的修改内容书面确认。谢谢！'
    : '请逐项书面回复，并提供整合后的修订稿供双方核对；最终修改以双方书面确认为准。';
  return [opening, ...items, closing];
}

/** A copyable, selected-only communication package; no selection means no output. */
export function buildNegotiationText(input: NegotiationInput): string {
  const paragraphs = communicationParagraphs(input);
  return paragraphs.length ? [...paragraphs, `参考说明：${riskNotice}`].join('\n\n') : '';
}

/** Static Markdown: even supplied HTML, images and links remain literal text. */
export function buildNegotiationMarkdown(input: NegotiationInput): string {
  const paragraphs = communicationParagraphs(input);
  if (!paragraphs.length) return '';
  const clauseOrder = new Map(input.clauses.map((clause, index) => [clause.id, index]));
  const originals = groupRedlines(input).map(({ clause }) => [
    `### ${escapeMarkdown(clauseLabel(clause, clauseOrder.get(clause.id)!)).replace(/\r\n?|\n/g, ' ')}`,
    `> ${escapeMarkdown(clause.text).replace(/\r\n?|\n/g, '\n> ')}`,
  ].join('\n\n'));
  return [
    `# ${escapeMarkdown(documentTitle(input)).replace(/\r\n?|\n/g, ' ')} · 协商清单`,
    draftBoundary,
    `语气：${toneLabels[input.tone]}`,
    '## 生成沟通包',
    ...paragraphs.map(paragraph => escapeMarkdown(paragraph).replace(/\r\n?|\n/g, '  \n')),
    '## 所选条款原文（供核对）',
    ...originals,
    '## 参考说明',
    riskNotice,
    integrationNotice,
  ].join('\n\n');
}

// Entirely internal: no input can enter CSS, attributes, resource URLs or markup.
const printCss = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #263b39; background: #fff; font: 12pt/1.7 system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
main { max-width: 210mm; margin: 0 auto; padding: 18mm 16mm; overflow-wrap: anywhere; }
h1 { font-size: 22pt; line-height: 1.4; }
h2 { font-size: 15pt; margin: 0 0 8pt; }
h3, h4 { font-size: 12pt; margin: 8pt 0 4pt; }
h1, h2, h3, h4 { break-after: avoid-page; page-break-after: avoid; }
p { margin: 6pt 0; orphans: 3; widows: 3; }
.document-title, .clause-heading, .risk-title, .original, .suggestion { white-space: pre-wrap; }
.draft-boundary { border: 2px solid #b8443a; padding: 8pt 12pt; color: #b8443a; font-weight: 700; }
.legend, .caption { color: #52635f; font-size: 10pt; }
.clause { margin: 18pt 0; padding-top: 12pt; border-top: 1px solid #d9dfdc; }
.clause, .advice, .notes { break-inside: avoid-page; page-break-inside: avoid; }
.original del { color: #b8443a; text-decoration: line-through; }
.suggestion strong { color: #205c45; font-weight: 700; }
.suggestions { padding-left: 22pt; }
.advice { margin: 8pt 0; }
.notes { border-top: 2px solid #d9dfdc; margin-top: 20pt; padding-top: 12pt; font-size: 10pt; }
@media print {
  main { max-width: none; margin: 0; padding: 0; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;

/** Full original contract plus selected comparisons; no DOM/download/network effects. */
export function buildPrintableHtml(input: NegotiationInput): string {
  const groups = groupRedlines(input);
  if (!groups.length) return '';
  const byClause = new Map(groups.map(group => [group.clause.id, group.hits]));
  const sections = input.clauses.map((clause, index) => {
    const hits = byClause.get(clause.id);
    const heading = `<h2 class="clause-heading">${escapeHtml(clauseLabel(clause, index))}</h2>`;
    const original = escapeHtml(clause.text);
    if (!hits) {
      return `<section class="clause">\n${heading}\n<p class="original">${original}</p>\n</section>`;
    }
    const suggestions = hits.map(hit => `<li class="advice"><h4 class="risk-title">${escapeHtml(hit.rule.title)}</h4><p class="suggestion"><strong>${escapeHtml(hit.rule.suggestion)}</strong></p></li>`);
    return `<section class="clause clause-selected">
${heading}
<p class="caption">原文（仅作协商对照，尚未修改）</p>
<p class="original"><del>${original}</del></p>
<h3>分别协商的修改建议</h3>
<ol class="suggestions">\n${suggestions.join('\n')}\n</ol>
</section>`;
  });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(documentTitle(input))} · 协商修订对照</title>
<style>${printCss}</style>
</head>
<body>
<main>
<header>
<h1 class="document-title">${escapeHtml(documentTitle(input))}</h1>
<p class="draft-boundary">${draftBoundary}</p>
<p class="legend">红色删除线为所选条款原文，墨绿色加粗为待协商建议；未选条款原样保留。对照标记不表示原条款已失效或整条删除。</p>
</header>
${sections.join('\n')}
<footer class="notes">
<h2>参考说明</h2>
<p>${riskNotice}</p>
<p>${integrationNotice}</p>
</footer>
</main>
</body>
</html>`;
}
