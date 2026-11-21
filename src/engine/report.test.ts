import { describe, expect, it } from 'vitest';
import { buildReportData, inferContractScenario, REPORT_DISCLAIMER } from './report';
import { scanContract } from './scanner';
import { rules } from '../data/rules';
import { samples } from '../data/samples';
import type { RiskHit, ScanScenario } from './types';
const hit = (index: number, clauseId = 'clause-0'): RiskHit => ({ id: `${clauseId}-${index}`, clauseId, rule: rules[index], ranges: [], excerpt: '不应导出的原文' });

describe('体检卡安全数据', () => {
  it.each(samples)('$label 只输出内置场景与风险摘要', sample => {
    const result = scanContract(sample.text, sample.id);
    const data = buildReportData(result.hits, sample.id);
    expect(data.counts).toEqual({ high: 3, medium: 2, low: 1 });
    expect(data.total).toBe(6); expect(data.overall).toBe('high');
    expect(data.risks).toHaveLength(6); expect(data.omitted).toBe(0);
    expect(JSON.stringify(data)).not.toContain(sample.parties[0]);
    expect(inferContractScenario(result.hits, 'auto')).toBe(sample.id);
  });
  it('零命中不是安全结论', () => {
    expect(buildReportData([], 'auto')).toEqual({ scenarioLabel: '我的合同 · 综合体检', overall: 'none', counts: { high: 0, medium: 0, low: 0 }, total: 0, risks: [], omitted: 0 });
    expect(REPORT_DISCLAIMER).toContain('不构成正式法律意见');
  });
  it('忽略伪造的标题、等级、摘录、私密ID，等级由白名单重建', () => {
    const secret = '王小明 身份证110101 地址中山路88号 金额987654321';
    const forged = { ...hit(0), id: secret, clauseId: secret, excerpt: secret, rule: { ...rules[0], title: secret, severity: 'low' as const, scenario: 'fitness' as const, suggestion: secret } };
    const data = buildReportData([forged], secret as ScanScenario);
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(data.counts).toEqual({ high: 1, medium: 0, low: 0 });
    expect(data.scenarioLabel).toBe('租房合同');
  });
  it('不把教学样本金额带入体检卡', () => {
    expect(buildReportData([hit(6)], 'internship').risks[0].title).toBe('离职被要求支付“培训费”');
    expect(JSON.stringify(buildReportData([hit(6)], 'internship'))).not.toContain('一万元');
  });
  it('未知规则不进入图片或场景推断', () => {
    const forged = { ...hit(0), rule: { ...rules[0], id: 'PRIVATE_UNKNOWN', title: 'PRIVATE_TITLE' } };
    expect(buildReportData([forged], 'auto').total).toBe(0);
    expect(inferContractScenario([forged], 'auto')).toBeNull();
  });
  it('混合场景不猜测，显式场景仍保留', () => {
    expect(inferContractScenario([hit(0), hit(6)], 'auto')).toBeNull();
    expect(inferContractScenario([], 'fitness')).toBe('fitness');
    expect(buildReportData([hit(0), hit(6)], 'auto').scenarioLabel).toBe('我的合同 · 综合体检');
  });
  it('同条同规则去重，不同条累计，摘要合并重复标题', () => {
    const data = buildReportData([hit(0), hit(0), hit(0, 'clause-1')], 'auto');
    expect(data.total).toBe(2); expect(data.risks).toHaveLength(1);
    expect(data.risks[0].occurrences).toBe(2);
  });
  it('先展示最高等级，最多6种风险但总计不截断', () => {
    const data = buildReportData(rules.map((_, index) => hit(index)), 'auto');
    expect(data.total).toBe(18); expect(data.risks).toHaveLength(6);
    expect(data.omitted).toBe(12); expect(data.risks.every(item => item.severity === 'high')).toBe(true);
  });
  it.each(['medium', 'low'] as const)('支持只有%s风险', severity => {
    const data = buildReportData([hit(rules.findIndex(rule => rule.severity === severity))], 'auto');
    expect(data.overall).toBe(severity);
  });
  it('生成结果与输入独立，不修改输入', () => {
    const input = [hit(0)]; const before = JSON.stringify(input);
    const data = buildReportData(input, 'auto'); data.risks[0].title = 'changed';
    expect(JSON.stringify(input)).toBe(before);
    expect(buildReportData(input, 'auto').risks[0].title).toBe(rules[0].title);
  });
});
