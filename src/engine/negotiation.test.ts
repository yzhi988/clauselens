import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildNegotiationMarkdown,
  buildNegotiationText,
  buildPrintableHtml,
  cleanExportTitle,
  customExportTitle,
  MAX_EXPORT_TITLE_LENGTH,
  defaultSelectedIds,
  groupRedlines,
  selectedHits,
} from './negotiation';
import type { NegotiationInput, Tone } from './negotiation';
import type { RiskHit, RiskRule } from './types';

// All fixtures are invented here; no user contracts or browser storage are read.
function makeHit(id: string, clauseId: string, start: number, rule: Partial<RiskRule> = {}): RiskHit {
  return {
    id, clauseId, ranges: [{ start, end: start + 2 }], excerpt: `${id}的原文片段`,
    rule: {
      id: `rule-${id}`, scenario: 'rental', severity: 'high', title: `核对${id}事项`,
      short: '测试提示', explanation: '测试说明',
      law: { name: '测试参考', articles: '测试条文', summary: '需结合事实核实。', url: 'https://example.invalid/law' },
      script: `我理解${id}的安排，能否一起确认？`,
      suggestion: `双方应书面明确${id}的条件与处理方式。`,
      context: /测试/, patterns: [/测试/], ...rule,
    },
  };
}

function fixture(overrides: Partial<NegotiationInput> = {}): NegotiationInput {
  const clauses = [
    { id: 'preamble', number: '', title: '前言', text: '本合同为虚构教学文本。\n双方约定以下事项。' },
    { id: 'normal', number: '第一条', title: '租赁用途', text: '房屋用于居住，双方共同保持设施完好。\n  公共区域按约使用。' },
    { id: 'multiple', number: '第二条', title: '押金与退租', text: '押金由甲方保管。费用结清后押金不退。提前退租需支付剩余全部租金。转租授权另行核对。' },
    { id: 'unselected', number: '第三条', title: '维修', text: '正常损耗费用由乙方承担。' },
    { id: 'signature', number: '第四条', title: '签署', text: '甲方（签字）：________\n乙方（签字）：________\n日期：____年__月__日' },
  ];
  return {
    title: '虚构租赁合同', clauses,
    hits: [
      makeHit('deposit', 'multiple', 14),
      makeHit('penalty', 'multiple', 19, { severity: 'medium' }),
      makeHit('authorization', 'multiple', 33, { severity: 'low' }),
      makeHit('repair', 'unselected', 0),
    ],
    selectedIds: ['penalty', 'deposit'], tone: 'gentle', scenario: 'rental', ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function sections(html: string): string[] {
  return [...html.matchAll(/<section class="clause(?: clause-selected)?">[\s\S]*?<\/section>/g)]
    .map(match => match[0]);
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => entities[entity]);
}

const builders = [buildNegotiationText, buildNegotiationMarkdown, buildPrintableHtml];
afterEach(() => vi.restoreAllMocks());

describe('v0.4 自定义导出标题', () => {
  it.each(['', ' \t\r\n', '\u0000\u202e\u2066'])('空白或控制字符回退到我的合同：%j', value => {
    expect(customExportTitle(value)).toBe('我的合同');
  });
  it('保留编辑中空格，输出去首尾空白，删除控制字符', () => {
    expect(cleanExportTitle(' 标\n题\u0000\u202e ')).toBe(' 标题 ');
    expect(customExportTitle(' 标题 ')).toBe('标题');
  });
  it('限制80个UTF16字符，不截出孤立高代理项', () => {
    expect(cleanExportTitle('合'.repeat(81))).toHaveLength(MAX_EXPORT_TITLE_LENGTH);
    expect(cleanExportTitle('合'.repeat(79) + '𠮷')).toBe('合'.repeat(79));
    expect(cleanExportTitle('𠮷'.repeat(41))).toBe('𠮷'.repeat(40));
  });
  it('私有标题进入清单和HTML但仍按文本转义，不改变勾选', () => {
    const title = customExportTitle('<img src=x onerror=alert(1)>私有标题![图](https://example.invalid)');
    const input = fixture({ title });
    expect(buildNegotiationText(input)).toContain(title);
    const html = buildPrintableHtml(input);
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
    expect(buildNegotiationMarkdown(input)).not.toContain('![图](');
    expect(input.selectedIds).toEqual(['penalty', 'deposit']);
  });
});

describe('默认选择和当前有效选择', () => {
  it('只选 high/medium，保留传入文档顺序而非按严重程度排列', () => {
    const hits = [
      makeHit('low', 'c', 0, { severity: 'low' }),
      makeHit('medium', 'c', 2, { severity: 'medium' }),
      makeHit('high', 'c', 4),
    ];
    expect(defaultSelectedIds(hits)).toEqual(['medium', 'high']);
    expect(defaultSelectedIds([...hits, hits[1], hits[2]])).toEqual(['medium', 'high']);
    expect(defaultSelectedIds([])).toEqual([]);
    expect(defaultSelectedIds([hits[0]])).toEqual([]);
  });

  it('不按 selectedIds、hits、严重程度或ID顺序排列，而按条款与原文位置', () => {
    const input = fixture();
    input.hits = [input.hits[3], input.hits[1], input.hits[2], input.hits[0]];
    input.selectedIds = ['repair', 'authorization', 'penalty', 'deposit', 'penalty'];
    expect(selectedHits(input).map(hit => hit.id)).toEqual(['deposit', 'penalty', 'authorization', 'repair']);
    input.clauses = [input.clauses[3], input.clauses[2]];
    expect(selectedHits(input).map(hit => hit.id)).toEqual(['repair', 'deposit', 'penalty', 'authorization']);
  });

  it('使用所有 ranges 的最早起点，不修改原 ranges；无范围的风险排在本条末尾', () => {
    const later = makeHit('later', 'multiple', 5);
    const earliest = makeHit('earliest', 'multiple', 40);
    earliest.ranges.push({ start: 1, end: 3 });
    const noRange = { ...makeHit('no-range', 'multiple', 0), ranges: [] };
    const secondNoRange = { ...noRange, id: 'second-no-range' };
    const input = fixture({ hits: [noRange, later, earliest, secondNoRange], selectedIds: ['later', 'second-no-range', 'earliest', 'no-range'] });
    expect(selectedHits(input).map(hit => hit.id)).toEqual(['earliest', 'later', 'no-range', 'second-no-range']);
    expect(earliest.ranges).toEqual([{ start: 40, end: 42 }, { start: 1, end: 3 }]);
  });

  it('相同位置按 hits 的稳定顺序，而不是用户勾选顺序', () => {
    const hits = [makeHit('z-first', 'multiple', 2), makeHit('a-second', 'multiple', 2)];
    expect(selectedHits(fixture({ hits, selectedIds: ['a-second', 'z-first'] }))).toEqual(hits);
  });

  it('重复勾选和重复命中ID只取首个有效命中，未知ID和孤立条款被忽略', () => {
    const input = fixture();
    const duplicate = { ...input.hits[0], rule: { ...input.hits[0].rule, title: '不应采用重复记录' } };
    input.hits.push(duplicate, makeHit('orphan', 'missing-clause', 0));
    input.selectedIds = ['orphan', '__proto__', 'constructor', 'unknown', 'deposit', 'deposit'];
    expect(selectedHits(input)).toEqual([input.hits[0]]);
    expect(buildNegotiationText(input)).not.toContain('不应采用重复记录');
  });

  it('手动选中的低风险有效，不会额外自动加入未勾选的高风险', () => {
    const input = fixture({ selectedIds: ['authorization'] });
    expect(selectedHits(input).map(hit => hit.id)).toEqual(['authorization']);
    expect(buildNegotiationText(input)).toContain(input.hits[2].rule.suggestion);
    expect(buildNegotiationText(input)).not.toContain(input.hits[0].rule.suggestion);
  });
});

describe('groupRedlines', () => {
  it('同条多风险合并为一份原文，各建议仍按原文顺序单独列出', () => {
    const input = fixture({ selectedIds: ['repair', 'penalty', 'deposit', 'deposit'] });
    expect(groupRedlines(input)).toEqual([
      { clause: input.clauses[2], hits: [input.hits[0], input.hits[1]] },
      { clause: input.clauses[3], hits: [input.hits[3]] },
    ]);
  });

  it('同条未选风险不混入建议，也不把未选条款标为修订', () => {
    const input = fixture({ selectedIds: ['penalty'] });
    expect(groupRedlines(input)).toEqual([{ clause: input.clauses[2], hits: [input.hits[1]] }]);
  });
});

describe('buildNegotiationText', () => {
  it.each([
    ['rental', '房东'], ['internship', 'HR'], ['fitness', '商家'], ['auto', '对方'],
  ] as const)('%s 使用一致称呼 %s，auto 不根据风险擅自猜测对象', (scenario, addressee) => {
    for (const tone of ['gentle', 'firm'] as const) {
      const text = buildNegotiationText(fixture({ scenario, tone }));
      expect(text.startsWith(`${addressee}您好：\n`)).toBe(true);
      expect(text).toContain('《虚构租赁合同》');
    }
  });

  it('温和版包含连贯开头、编号条号、每条原话术和明确建议，以及书面确认收尾', () => {
    const input = fixture();
    const text = buildNegotiationText(input);
    expect(text).toContain('在理解双方安排的基础上');
    expect(text).toContain(`1. 第二条 押金与退租｜${input.hits[0].rule.title}`);
    expect(text).toContain(`2. 第二条 押金与退租｜${input.hits[1].rule.title}`);
    for (const hit of input.hits.slice(0, 2)) {
      expect(text).toContain(`${hit.rule.script}\n具体修改建议：${hit.rule.suggestion}`);
    }
    expect(text).toContain('将双方商定的修改内容书面确认');
    expect(text).toContain('风险提示与协商参考');
    expect(text).toContain('不对合同效力或裁判结果作出结论');
  });

  it('坚定版不复用温和话术，明确书面修改要求但不威胁或作法律断言', () => {
    const input = fixture({ tone: 'firm' });
    const text = buildNegotiationText(input);
    expect(text).not.toBe(buildNegotiationText({ ...input, tone: 'gentle' }));
    expect(text).toContain('书面修改要求');
    for (const hit of input.hits.slice(0, 2)) {
      expect(text).toContain(`明确书面修改，建议条文如下：${hit.rule.suggestion}`);
      expect(text).not.toContain(hit.rule.script);
    }
    expect(text).toContain('请逐项书面回复');
    expect(text).toContain('以双方书面确认为准');
    expect(text).not.toMatch(/你方违法|已经违法|必定胜诉|肯定无效|否则|曝光|起诉/);
  });

  it.each(['gentle', 'firm'] as const)('%s 不对未选风险发言', tone => {
    const input = fixture({ tone });
    for (const text of [buildNegotiationText(input), buildNegotiationMarkdown(input)]) {
      for (const hit of input.hits.slice(2)) {
        expect(text).not.toContain(hit.rule.title);
        expect(text).not.toContain(hit.rule.script);
        expect(text).not.toContain(hit.rule.suggestion);
      }
    }
  });

  it('无条号的前言、段落仍可定位，不伪造原合同条号', () => {
    const input = fixture({ hits: [makeHit('preamble-hit', 'preamble', 0)], selectedIds: ['preamble-hit'], title: '   ' });
    expect(buildNegotiationText(input)).toContain('《当前合同》');
    expect(buildNegotiationText(input)).toContain('1. 原文第1段 前言｜');
  });
});

describe('空选择与过期选择', () => {
  it.each([
    ['零勾选', { selectedIds: [] }],
    ['无命中', { hits: [] }],
    ['全为未知ID', { selectedIds: ['not-in-current-document', '__proto__'] }],
    ['无条款', { clauses: [] }],
    ['只有孤立命中', { hits: [makeHit('orphan', 'missing', 0)], selectedIds: ['orphan'] }],
  ] satisfies Array<[string, Partial<NegotiationInput>]>)('%s 不产生空白沟通包或下载内容', (_, overrides) => {
    const input = fixture(overrides);
    expect(selectedHits(input)).toEqual([]);
    expect(groupRedlines(input)).toEqual([]);
    for (const build of builders) expect(build(input)).toBe('');
  });

  it('未知ID混合有效ID不影响有效内容', () => {
    const input = fixture();
    for (const build of builders) {
      expect(build({ ...input, selectedIds: ['unknown', ...input.selectedIds, 'unknown'] })).toBe(build(input));
    }
  });
});

describe('buildPrintableHtml 完整合同对照', () => {
  it('完整保留前言、正常条款、未选风险、所选条款内未选内容和签署条款', () => {
    const input = fixture();
    const html = buildPrintableHtml(input);
    const blocks = sections(html);
    expect(blocks).toHaveLength(input.clauses.length);
    input.clauses.forEach((clause, index) => {
      expect(blocks[index]).toContain(clause.title);
      expect(blocks[index]).toContain(clause.number);
      const original = /<p class="original">([\s\S]*?)<\/p>/.exec(blocks[index])![1]
        .replace(/^<del>|<\/del>$/g, '');
      expect(decodeEntities(original)).toBe(clause.text);
      if (clause.id !== 'multiple') {
        expect(blocks[index]).not.toContain('<del>');
        expect(blocks[index]).not.toContain('<strong>');
        expect(blocks[index]).not.toContain('clause-selected');
      }
    });
    expect(html).toContain('转租授权另行核对。');
    expect(html).toContain('正常损耗费用由乙方承担。');
    expect(html).toContain('甲方（签字）：________');
  });

  it('同条多个命中原文只出现一次、建议分别列出，未选建议不输出', () => {
    const input = fixture();
    const html = buildPrintableHtml(input);
    expect(html.split(input.clauses[2].text)).toHaveLength(2);
    expect(html.match(/<del>/g)).toHaveLength(1);
    expect(html.match(/<li class="advice">/g)).toHaveLength(2);
    for (const hit of input.hits.slice(0, 2)) {
      expect(html).toContain(`<strong>${hit.rule.suggestion}</strong>`);
    }
    expect(html.indexOf(input.hits[0].rule.suggestion)).toBeLessThan(html.indexOf(input.hits[1].rule.suggestion));
    for (const hit of input.hits.slice(2)) {
      expect(html).not.toContain(hit.rule.title);
      expect(html).not.toContain(hit.rule.suggestion);
    }
  });

  it('提供独立文档、A4页边距、短块跨页控制和不依赖颜色的草案边界', () => {
    const html = buildPrintableHtml(fixture());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<title>虚构租赁合同 · 协商修订对照</title>');
    expect(html).toMatch(/@page\s*\{\s*size: A4;\s*margin: 18mm 16mm;/);
    expect(html).toContain('@media print');
    expect(html).toContain('break-inside: avoid-page');
    expect(html).toContain('white-space: pre-wrap');
    expect(html).toContain('.original del { color: #b8443a; text-decoration: line-through; }');
    expect(html).toContain('.suggestion strong { color: #205c45; font-weight: 700; }');
    expect(html).toContain('协商草案 · 未达成合意');
    expect(html).toContain('不表示原条款已失效或整条删除');
    expect(html).toContain('多项建议需由双方结合完整条款整合并书面确认');
    expect(html).toContain('不自动成为正式合同');
    expect(html).toContain('不对合同效力或裁判结果作出结论');
  });

  it('纯修订对照不受话术语气影响', () => {
    expect(buildPrintableHtml(fixture({ tone: 'gentle' }))).toBe(buildPrintableHtml(fixture({ tone: 'firm' })));
  });
});

const attack = '中文&<>"\' </title></style><style>body{background:url(https://evil.invalid/css)}</style><script src="https://evil.invalid/run.js">alert(1)</script><img src="https://evil.invalid/pixel" onerror="alert(2)"><svg onload="alert(3)"></svg><form action="https://evil.invalid/post"><input autofocus onfocus="alert(4)"></form>\n![追踪](https://evil.invalid/a.png)\n[链接](javascript:alert(5))\n<https://evil.invalid/>\n&lt;img src=x&gt;';
const expectedHtmlAttack = '中文&amp;&lt;&gt;&quot;&#39;';
const fieldWriters: Array<[string, (input: NegotiationInput, value: string) => void]> = [
  ['合同标题', (input, value) => { input.title = value; }],
  ['条款编号', (input, value) => { input.clauses[2].number = value; }],
  ['条款标题', (input, value) => { input.clauses[2].title = value; }],
  ['所选原文', (input, value) => { input.clauses[2].text = value; }],
  ['风险标题', (input, value) => { input.hits[0].rule.title = value; }],
  ['建议', (input, value) => { input.hits[0].rule.suggestion = value; }],
];

describe('HTML 注入隔离', () => {
  it.each([
    ...fieldWriters,
    ['未选原文', (input: NegotiationInput, value: string) => { input.clauses[1].text = value; }],
  ] satisfies typeof fieldWriters)('%s 转义所有五类实体且无法关闭 style/title 或激活事件', (_, writeField) => {
    const input = fixture();
    writeField(input, attack);
    const html = buildPrintableHtml(input);
    expect(html).toContain(expectedHtmlAttack);
    expect(html).toContain('&lt;script src=&quot;https://evil.invalid/run.js&quot;&gt;');
    expect(html).toContain('&lt;img src=&quot;https://evil.invalid/pixel&quot; onerror=&quot;alert(2)&quot;&gt;');
    expect(html).toContain('&amp;lt;img src=x&amp;gt;');
    expect(html).not.toMatch(/<(?:script|img|svg|form|input|iframe|link|object|embed|a)\b/i);
    expect(html).not.toMatch(/<[^>]*\s(?:on\w+|src|href|action|formaction)\s*=/i);
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<\/title>/g)).toHaveLength(1);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    expect(style).toBe(/<style>([\s\S]*?)<\/style>/.exec(buildPrintableHtml(fixture()))![1]);
    expect(style).not.toMatch(/url\s*\(|@import/i);
  });

  it('转义后原始正文能精确恢复，包括空白、单双引号和看似实体的字符串', () => {
    const input = fixture();
    input.clauses.forEach(clause => { clause.text = `  ${attack}\n\n  中文尾行  `; });
    const originals = sections(buildPrintableHtml(input)).map(block => decodeEntities(
      /<p class="original">([\s\S]*?)<\/p>/.exec(block)![1].replace(/^<del>|<\/del>$/g, ''),
    ));
    expect(originals).toEqual(input.clauses.map(clause => clause.text));
  });
});

describe('buildNegotiationMarkdown', () => {
  it.each(['gentle', 'firm'] satisfies Tone[])('%s 包含标题、沟通包、条号、所选原文及参考说明', tone => {
    const input = fixture({ tone });
    const markdown = buildNegotiationMarkdown(input);
    expect(markdown.startsWith('# 虚构租赁合同 · 协商清单')).toBe(true);
    expect(markdown).toContain(tone === 'gentle' ? '温和商量版' : '坚定底线版');
    expect(markdown).toContain('## 生成沟通包');
    expect(markdown).toContain('1\\. 第二条 押金与退租｜核对deposit事项');
    expect(markdown).toContain('2\\. 第二条 押金与退租｜核对penalty事项');
    expect(markdown).toContain('### 第二条 押金与退租');
    expect(markdown).toContain(`> ${input.clauses[2].text}`);
    expect(markdown.split(input.clauses[2].text)).toHaveLength(2);
    expect(markdown).toContain('## 参考说明');
    expect(markdown).toContain('协商草案 · 未达成合意');
    expect(markdown).toContain('多项建议需由双方结合完整条款整合并书面确认');
    expect(markdown).toContain('不自动成为正式合同');
    expect(markdown).not.toContain(input.hits[0].rule.law.url);
  });

  it.each([
    ...fieldWriters,
    ['温和话术', (input: NegotiationInput, value: string) => { input.hits[0].rule.script = value; }],
  ] satisfies typeof fieldWriters)('%s 中 HTML、图片、链接及实体均保持为文本', (_, writeField) => {
    const input = fixture();
    writeField(input, attack);
    const markdown = buildNegotiationMarkdown(input);
    expect(markdown).toContain(expectedHtmlAttack);
    expect(markdown).toContain(String.raw`\!\[追踪\]\(https\:\/\/evil\.invalid\/a\.png\)`);
    expect(markdown).toContain(String.raw`\[链接\]\(javascript\:alert\(5\)\)`);
    expect(markdown).toContain('&lt;img ');
    expect(markdown).toContain('&lt;script ');
    expect(markdown).toContain(String.raw`&amp;lt\;img src\=x&amp;gt\;`);
    expect(markdown).not.toContain('![追踪](');
    expect(markdown).not.toContain('[链接](');
    expect(markdown).not.toContain('https://evil.invalid');
    expect(markdown).not.toMatch(/<(?:script|img|style|svg|form|https?:)\b/i);
  });

  it('转义所有 ASCII 标点，同时保留中文，不让控制符产生新结构', () => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const punctuation = Array.from({ length: 94 }, (_, index) => String.fromCharCode(index + 33))
      .filter(character => !/[a-z0-9]/i.test(character));
    for (const character of punctuation) {
      const markdown = buildNegotiationMarkdown(fixture({ title: `甲${character}乙` }));
      expect(markdown.split('\n')[0]).toBe(`# 甲${entities[character] ?? `\\${character}`}乙 · 协商清单`);
    }
  });

  it('多行标题不注入标题块，引用每一行都被包在文本引用内', () => {
    const input = fixture({ title: '中文\r\n# 注入\n![图片](x)' });
    input.clauses[2].text = '首行\r\n> 伪造引用\n\n# 伪造标题\n---\n```html\n<img src=x>\n```';
    const markdown = buildNegotiationMarkdown(input);
    expect(markdown.split('\n')[0]).toBe(String.raw`# 中文 \# 注入 \!\[图片\]\(x\) · 协商清单`);
    expect(markdown).toContain('> 首行\n> &gt; 伪造引用\n> \n> \\# 伪造标题\n> \\-\\-\\-');
    expect(markdown).toContain('> \\`\\`\\`html\n> &lt;img src\\=x&gt;');
    expect(markdown).not.toMatch(/^# (?:注入|伪造标题)$/m);
  });
});

describe('纯函数约束', () => {
  it('所有函数接受冻结输入，重复调用一致且不改变选择、命中、条款或正则状态', () => {
    const input = fixture();
    input.hits.reverse();
    input.selectedIds.push('deposit', 'unknown');
    const before = structuredClone(input);
    deepFreeze(input);
    expect(defaultSelectedIds(input.hits)).toEqual(defaultSelectedIds(input.hits));
    expect(selectedHits(input)).toEqual(selectedHits(input));
    expect(groupRedlines(input)).toEqual(groupRedlines(input));
    for (const build of builders) expect(build(input)).toBe(build(input));
    expect(input).toEqual(before);
  });

  it('只返回字符串，不访问网络或创建、撤销下载URL', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('不应访问网络'); });
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('不应创建下载'); });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { throw new Error('不应撤销下载'); });
    for (const build of builders) expect(typeof build(fixture())).toBe('string');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
  });
});
