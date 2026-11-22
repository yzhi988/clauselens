export type Severity = 'high' | 'medium' | 'low';
export type Scenario = 'rental' | 'internship' | 'fitness';
export type ScanScenario = Scenario | 'auto';
export interface LawReference { name: string; articles: string; summary: string; url: string }
export interface RiskRule {
  id: string;
  scenario: Scenario;
  severity: Severity;
  title: string;
  short: string;
  explanation: string;
  law: LawReference;
  suggestion: string;
  script: string;
  patterns: RegExp[];
  /** Complete, high-confidence expressions allowed in auto mode without context. */
  standalonePatterns?: RegExp[];
  /** Only positive matches fully contained in an ignored range are suppressed. */
  ignorePatterns?: RegExp[];
  /** Full-text guard for ordinary patterns; explicit scenarios bypass this guard. */
  context: RegExp;
}
export interface Clause { id: string; number: string; title: string; text: string }
export interface MatchRange { start: number; end: number }
export interface RiskHit { id: string; clauseId: string; rule: RiskRule; ranges: MatchRange[]; excerpt: string }
export interface ScanResult {
  clauses: Clause[];
  hits: RiskHit[];
  counts: Record<Severity, number>;
  overall: Severity | 'none';
}
export interface ContractSample {
  id: Scenario;
  label: string;
  title: string;
  subtitle: string;
  parties: [string, string];
  meta: string;
  text: string;
}
export const severityOrder: Severity[] = ['high', 'medium', 'low'];
export const severityLabels: Record<Severity, string> = { high: '高危', medium: '警惕', low: '注意' };
