import { rules } from '../data/rules';
import type { RiskHit, ScanScenario, Scenario, Severity } from './types';
import { severityOrder } from './types';

const scenarioLabels: Record<Scenario, string> = { rental: '租房合同', internship: '实习 / 劳动协议', fitness: '健身年卡协议' };
const safeRules = new Map(rules.map(rule => [rule.id, { id: rule.id, title: rule.id === 'internship-training' ? '离职被要求支付“培训费”' : rule.title, severity: rule.severity, scenario: rule.scenario }]));
export const REPORT_DISCLAIMER = '本地规则扫描结果，仅作常见霸王条款科普参考，不构成正式法律意见';
export interface ReportData {
  scenarioLabel: string;
  overall: Severity | 'none';
  counts: Record<Severity, number>;
  total: number;
  risks: { title: string; severity: Severity; occurrences: number }[];
  omitted: number;
}

/** Only trusted built-in IDs are used. No excerpts, clause text or supplied titles cross this boundary. */
export function inferContractScenario(hits: readonly RiskHit[], scenario: ScanScenario): Scenario | null {
  if (Object.hasOwn(scenarioLabels, scenario)) return scenario as Scenario;
  const found = new Set(hits.map(hit => safeRules.get(hit.rule.id)?.scenario).filter((value): value is Scenario => !!value));
  return found.size === 1 ? [...found][0] : null;
}
export function buildReportData(hits: readonly RiskHit[], scenario: ScanScenario): ReportData {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  const seen = new Set<string>();
  const grouped = new Map<string, { title: string; severity: Severity; occurrences: number }>();
  for (const hit of hits) {
    const rule = safeRules.get(hit.rule.id);
    const key = JSON.stringify([hit.clauseId, hit.rule.id]);
    if (!rule || seen.has(key)) continue;
    seen.add(key);
    counts[rule.severity]++;
    const item = grouped.get(rule.id);
    if (item) item.occurrences++;
    else grouped.set(rule.id, { title: rule.title, severity: rule.severity, occurrences: 1 });
  }
  const all = [...grouped.values()].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
  const inferred = inferContractScenario(hits, scenario);
  return {
    scenarioLabel: inferred ? scenarioLabels[inferred] : '我的合同 · 综合体检',
    overall: severityOrder.find(level => counts[level] > 0) ?? 'none',
    counts, total: counts.high + counts.medium + counts.low,
    risks: all.slice(0, 6), omitted: Math.max(0, all.length - 6),
  };
}
