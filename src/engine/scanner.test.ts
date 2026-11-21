import { describe, expect, it } from 'vitest';
import { rules } from '../data/rules';
import { samples } from '../data/samples';
import { parseClauses, scanContract } from './scanner';
import type { RiskRule, Scenario, ScanResult, Severity } from './types';

function rule(overrides: Partial<RiskRule> = {}): RiskRule {
  return {
    id: 'test-deposit',
    scenario: 'rental',
    severity: 'high',
    title: '押金条款',
    short: '核实退还条件',
    explanation: '测试规则',
    law: { name: '测试参考', articles: '', summary: '', url: '' },
    suggestion: '明确退还条件',
    script: '请明确退还条件。',
    patterns: [/押金不退/],
    context: /租房|租赁|房屋/,
    ...overrides,
  };
}

function expectValidRanges(result: ScanResult, source: string): void {
  for (const hit of result.hits) {
    const clause = result.clauses.find(item => item.id === hit.clauseId);
    expect(clause).toBeDefined();
    expect(hit.id).toBe(`${hit.clauseId}-${hit.rule.id}`);
    expect(hit.ranges.length).toBeGreaterThan(0);
    let previousEnd = -1;
    for (const range of hit.ranges) {
      expect(Number.isInteger(range.start)).toBe(true);
      expect(Number.isInteger(range.end)).toBe(true);
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.start).toBeGreaterThanOrEqual(previousEnd);
      expect(range.end).toBeGreaterThan(range.start);
      expect(range.end).toBeLessThanOrEqual(clause!.text.length);
      const highlighted = clause!.text.slice(range.start, range.end);
      expect(source).toContain(highlighted);
      expect(hit.rule.patterns.some(pattern => new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(highlighted))).toBe(true);
      previousEnd = range.end;
    }
  }
  const positions = result.hits.map(hit => [result.clauses.findIndex(clause => clause.id === hit.clauseId), hit.ranges[0].start]);
  expect(positions).toEqual([...positions].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
}

const expectedSampleRisks: Record<Scenario, Record<string, Severity>> = {
  rental: {
    'rental-deposit': 'high',
    'rental-penalty': 'high',
    'rental-increase': 'medium',
    'rental-eviction': 'high',
    'rental-wear': 'medium',
    'rental-sublet': 'low',
  },
  internship: {
    'internship-training': 'high',
    'internship-noncompete': 'high',
    'internship-pay': 'high',
    'internship-dismissal': 'medium',
    'internship-overtime': 'medium',
    'internship-ip': 'low',
  },
  fitness: {
    'fitness-refund': 'high',
    'fitness-closure': 'high',
    'fitness-injury': 'high',
    'fitness-hours': 'medium',
    'fitness-fees': 'medium',
    'fitness-interpretation': 'low',
  },
};

const scenarios: Scenario[] = ['rental', 'internship', 'fitness'];

describe('教学样本与正式规则', () => {
  it('提供约定的三个样本和十八个独立规则', () => {
    expect(samples.map(sample => sample.id).sort()).toEqual([...scenarios].sort());
    expect(rules.map(item => item.id).sort()).toEqual(Object.values(expectedSampleRisks).flatMap(Object.keys).sort());
  });

  it.each(scenarios)('%s 恰好十二条、六命中，高三中二低一', scenario => {
    const sample = samples.find(item => item.id === scenario);
    expect(sample).toBeDefined();
    const result = scanContract(sample!.text, scenario);
    expect(result.clauses).toHaveLength(12);
    expect(result.clauses.every(clause => clause.number && clause.title && clause.text)).toBe(true);
    expect(result.hits).toHaveLength(6);
    expect(Object.fromEntries(result.hits.map(hit => [hit.rule.id, hit.rule.severity]))).toEqual(expectedSampleRisks[scenario]);
    expect(result.counts).toEqual({ high: 3, medium: 2, low: 1 });
    expect(result.overall).toBe('high');
    expectValidRanges(result, sample!.text);
    expect(scanContract(sample!.text, 'auto')).toEqual(result);
    expect(scanContract(sample!.text, scenario)).toEqual(result);
  });

  it.each([
    ['rental', '房屋租赁合同\n\n第一条 押金\n租赁结束并结清费用后七日内退还押金，不得任意扣除。\n\n第二条 责任\n正常损耗无需承租人赔偿；提前退租按实际损失协商，不要求赔偿剩余全部租金。\n\n第三条 租金\n租赁期内不得单方提高租金，调整须双方书面同意。'],
    ['internship', '实习协议\n\n第一条 费用\n实习生离职无需支付培训违约金，补贴按实际出勤足额支付。\n\n第二条 工作安排\n加班须双方协商并依法支付报酬。竞业限制仅在依法适用时另行约定并支付补偿。\n\n第三条 成果\n个人既有作品与实习无关的成果归本人所有。'],
    ['fitness', '健身会员服务合同\n\n第一条 退费\n会员可申请退费，扣除已消费的合理费用后退还余额。\n\n第二条 服务责任\n闭店应提前通知会员并退还剩余费用。因场馆过错造成的人身伤害由场馆依法承担责任。\n\n第三条 调整\n服务时间和收费调整须会员书面同意，条款争议由双方协商解决。'],
  ] as const)('%s 的正常及明确否定条款不误报', (scenario, text) => {
    for (const mode of [scenario, 'auto'] as const) {
      const result = scanContract(text, mode);
      expect(result.hits.map(hit => hit.rule.id)).toEqual([]);
      expect(result.counts).toEqual({ high: 0, medium: 0, low: 0 });
      expect(result.overall).toBe('none');
    }
  });
});

describe('parseClauses', () => {
  it.each(['', '  \t\r\n\n\u3000'])('空白文本不产生条款', text => {
    expect(parseClauses(text)).toEqual([]);
    expect(scanContract(text, 'auto', [rule()])).toEqual({
      clauses: [], hits: [], counts: { high: 0, medium: 0, low: 0 }, overall: 'none',
    });
  });

  it('分别提取中文编号、短标题和完整正文', () => {
    expect(parseClauses('第一条 房屋与用途\n房屋用于居住。\n请保持清洁。\n\n第二条 租赁期限\n租期一年。')).toEqual([
      { id: 'clause-0', number: '第一条', title: '房屋与用途', text: '房屋用于居住。\n请保持清洁。' },
      { id: 'clause-1', number: '第二条', title: '租赁期限', text: '租期一年。' },
    ]);
  });

  it('保留编号前的合同前言及其中的风险', () => {
    const result = scanContract('双方约定押金不退。\n\n第一条 房屋与用途\n用于居住。', 'rental', [rule()]);
    expect(result.clauses[0]).toEqual({ id: 'clause-0', number: '', title: '前言', text: '双方约定押金不退。' });
    expect(result.clauses[1].number).toBe('第一条');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].clauseId).toBe('clause-0');
  });

  it('同一行多个中文条款可以拆分，不吞掉无标题的完整句子', () => {
    const result = scanContract('第一条 押金不退。第二条 房屋用于居住。 第三条 押金不退。', 'rental', [rule()]);
    expect(result.clauses.map(clause => clause.number)).toEqual(['第一条', '第二条', '第三条']);
    expect(result.clauses.map(clause => clause.title)).toEqual(['', '', '']);
    expect(result.clauses.map(clause => clause.text)).toEqual(['押金不退。', '房屋用于居住。', '押金不退。']);
    expect(result.hits.map(hit => hit.id)).toEqual(['clause-0-test-deposit', 'clause-2-test-deposit']);
  });

  it('不把短风险陈述或无标题的首句当作标题', () => {
    for (const body of ['押金不退', '押金一律不退还\n承租人已知悉。', '押金不退。\n承租人已知悉。']) {
      expect(parseClauses(`第一条 ${body}`)[0]).toMatchObject({ title: '', text: body });
      expect(scanContract(`第一条 ${body}`, 'rental', [rule({ patterns: [/押金(?:一律)?不退/] })]).hits).toHaveLength(1);
    }
  });

  it('支持短标题冒号及中文数字条号', () => {
    expect(parseClauses('第十二条 租赁期限：租期一年。')[0]).toMatchObject({ number: '第十二条', title: '租赁期限', text: '租期一年。' });
  });

  it.each(['1.', '1、', '1．', '１、', '一、', '（一）', '(1)', '1)'])('支持数字及列表编号 %s', number => {
    expect(parseClauses(`  ${number} 租赁期限\n租期一年。\n\n2、 押金不退。`)).toEqual([
      { id: 'clause-0', number, title: '租赁期限', text: '租期一年。' },
      { id: 'clause-1', number: '2、', title: '', text: '押金不退。' },
    ]);
  });

  it('不把正文中的小数和交叉引用解析为新条款', () => {
    const clauses = parseClauses('第一条 费用\n月租为1.5万元，依照本合同第二条执行。\n1.5万元并非条款编号。\n\n第二条 租期\n租期一年。');
    expect(clauses).toHaveLength(2);
    expect(clauses[0].text).toContain('依照本合同第二条执行。');
    expect(clauses[0].text).toContain('1.5万元并非条款编号。');
  });

  it('兼容 CRLF、空行、缩进和尾部空白，保留正文内部换行', () => {
    expect(parseClauses(' \r\n\t第一条 房屋与用途\r\n  用于居住。\r\n保持清洁。\r\n \r\n\t第二条 租期\r\n一年。  \r\n')).toEqual([
      { id: 'clause-0', number: '第一条', title: '房屋与用途', text: '用于居住。\r\n保持清洁。' },
      { id: 'clause-1', number: '第二条', title: '租期', text: '一年。' },
    ]);
  });

  it('无编号文本按非空段落处理并保留段内换行', () => {
    expect(parseClauses('\n房屋用于居住。\n双方应当爱护设施。\n\n  押金不退。\n \n\n')).toEqual([
      { id: 'clause-0', number: '', title: '', text: '房屋用于居住。\n双方应当爱护设施。' },
      { id: 'clause-1', number: '', title: '', text: '押金不退。' },
    ]);
  });

  it('HTML 只作为原样文本保留', () => {
    const text = '<script>throw new Error("must not execute")</script><img src=x onerror=alert(1)>押金不退。';
    const result = scanContract(text, 'rental', [rule()]);
    expect(result.clauses[0].text).toBe(text);
    expect(result.hits).toHaveLength(1);
    expectValidRanges(result, text);
  });
});

describe('scanContract 注入规则', () => {
  it('重复句每条款每规则只计一次，非 global 正则也提取全部命中', () => {
    const text = '第一条 押金不退。押金不退。';
    const result = scanContract(text, 'rental', [rule()]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ranges).toEqual([{ start: 0, end: 4 }, { start: 5, end: 9 }]);
    expect(result.counts).toEqual({ high: 1, medium: 0, low: 0 });
    expect(result.hits[0].excerpt).toBe('押金不退 … 押金不退');
    expectValidRanges(result, text);
  });

  it('同规则所有 patterns 都扫描，并合并重复、嵌套及相交范围', () => {
    const injected = rule({ patterns: [/押金不退/, /金不/, /不退且加收/, /加收费用/, /押金不退/g] });
    const text = '押金不退且加收费用。押金不退。';
    const result = scanContract(text, 'rental', [injected]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].ranges).toEqual([{ start: 0, end: 9 }, { start: 10, end: 14 }]);
    expectValidRanges(result, text);
  });

  it('相邻但不重叠的范围保持分离', () => {
    const result = scanContract('押金不退', 'rental', [rule({ patterns: [/押金/, /不退/] })]);
    expect(result.hits[0].ranges).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it('不同规则允许重叠，多风险按正文而不是规则或等级排序', () => {
    const injected = [
      rule({ id: 'late-high', patterns: [/额外收费/], severity: 'high' }),
      rule({ id: 'inside-medium', patterns: [/不退/], severity: 'medium' }),
      rule({ id: 'early-low', severity: 'low' }),
    ];
    const text = '第一条 押金不退，额外收费。第二条 额外收费。';
    const result = scanContract(text, 'rental', injected);
    expect(result.hits.map(hit => hit.id)).toEqual([
      'clause-0-early-low', 'clause-0-inside-medium', 'clause-0-late-high', 'clause-1-late-high',
    ]);
    expect(result.hits[0].ranges).toEqual([{ start: 0, end: 4 }]);
    expect(result.hits[1].ranges).toEqual([{ start: 2, end: 4 }]);
    expect(result.counts).toEqual({ high: 2, medium: 1, low: 1 });
    expect(result.overall).toBe('high');
    expectValidRanges(result, text);
  });

  it.each(['high', 'medium', 'low'] as const)('综合等级正确处理仅有 %s 的情况', severity => {
    const result = scanContract('押金不退。', 'rental', [rule({ severity })]);
    expect(result.overall).toBe(severity);
    expect(result.counts[severity]).toBe(1);
  });

  it('零命中和空规则集不报告安全认证或虚构等级', () => {
    const result = scanContract('双方协商后退还押金。', 'rental', [rule()]);
    expect(result.hits).toEqual([]);
    expect(result.overall).toBe('none');
    expect(result.counts).toEqual({ high: 0, medium: 0, low: 0 });
    expect(scanContract('押金不退。', 'rental', []).hits).toEqual([]);
  });

  it('显式场景仅运行本场景规则，且不要求上下文命中', () => {
    const injected = scenarios.map(scenario => rule({ id: scenario, scenario, context: /不存在的上下文/ }));
    for (const scenario of scenarios) {
      expect(scanContract('押金不退。', scenario, injected).hits.map(hit => hit.rule.id)).toEqual([scenario]);
    }
    expect(scanContract('押金不退。', 'auto', injected).hits).toEqual([]);
  });

  it('auto 按每条规则的全文上下文筛选，支持同一文本中的多个场景', () => {
    const injected = [
      rule({ id: 'rental-allowed' }),
      rule({ id: 'rental-blocked', context: /转租授权/ }),
      rule({ id: 'fitness-allowed', scenario: 'fitness', context: /健身/ }),
      rule({ id: 'internship-blocked', scenario: 'internship', context: /实习/ }),
    ];
    const text = '房屋租赁与健身服务约定\n\n第一条 押金不退。';
    expect(scanContract(text, 'auto', injected).hits.map(hit => hit.rule.id)).toEqual(['rental-allowed', 'fitness-allowed']);
    expect(scanContract('押金不退。', 'auto', injected).hits).toEqual([]);
  });

  it('跨次扫描不受正则 lastIndex 影响，也不修改调用者正则状态', () => {
    const context = /租房/g;
    const pattern = /押金不退/g;
    context.lastIndex = 99;
    pattern.lastIndex = 99;
    const injected = [rule({ context, patterns: [pattern] })];
    const text = '租房约定\n\n第一条 押金不退。押金不退。';
    const first = scanContract(text, 'auto', injected);
    expect(first.hits).toHaveLength(1);
    expect(first.hits[0].ranges).toHaveLength(2);
    expect(scanContract(text, 'auto', injected)).toEqual(first);
    expect(context.lastIndex).toBe(99);
    expect(pattern.lastIndex).toBe(99);
  });

  it('保留 i/m/s 标志，sticky 模式也作为全文查找模式处理', () => {
    const injected = rule({ patterns: [/risk/iy, /^NEXT$/m, /甲.乙/s] });
    const text = '前缀 RISK\nNEXT\n甲\n乙';
    const result = scanContract(text, 'rental', [injected]);
    expect(result.hits[0].ranges.map(range => text.slice(range.start, range.end))).toEqual(['RISK', 'NEXT', '甲\n乙']);
  });

  it('offset 使用 clause.text 的 UTF-16 索引，而非全文或 Unicode 字符数', () => {
    const body = '𠮷押金不退。补充𠮷押金不退。';
    const text = `第一条 费用说明\r\n${body}`;
    const result = scanContract(text, 'rental', [rule()]);
    expect(result.clauses[0].text).toBe(body);
    expect(result.hits[0].ranges).toEqual([
      { start: 2, end: 6 },
      { start: body.lastIndexOf('押金不退'), end: body.lastIndexOf('押金不退') + 4 },
    ]);
    expectValidRanges(result, text);
  });

  it('空匹配不会生成空高亮或陷入循环，包括 Unicode 空匹配', () => {
    const result = scanContract('𠮷押金不退。', 'rental', [rule({ patterns: [/(?:)/gu, /(?=押金)/g, /押金不退/] })]);
    expect(result.hits[0].ranges).toEqual([{ start: 2, end: 6 }]);
    expect(scanContract('𠮷文本', 'rental', [rule({ patterns: [/(?:)/gu] })]).hits).toEqual([]);
  });

  it('接受 UI 上限内的五万字符并保持末尾匹配偏移准确', () => {
    const text = `${'文'.repeat(49_996)}押金不退`;
    const result = scanContract(text, 'rental', [rule({ patterns: [/(?:)/gu, /押金不退/] })]);
    expect(result.clauses[0].text).toHaveLength(50_000);
    expect(result.hits[0].ranges).toEqual([{ start: 49_996, end: 50_000 }]);
  });
});
