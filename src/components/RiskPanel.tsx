import { useState } from 'react';
import { AlertTriangle, ArrowUpRight, BookOpen, Check, ChevronDown, Copy, ListFilter, LocateFixed, MessageCircle, PencilLine, ShieldCheck } from 'lucide-react';
import type { RiskHit, ScanResult, Severity, Scenario } from '../engine/types';
import { severityLabels, severityOrder } from '../engine/types';

export type RiskFilter = Severity | 'all';
interface Props {
  result: ScanResult; selected: string | null; filter: RiskFilter;
  onFilter: (filter: RiskFilter) => void; onSelect: (id: string) => void;
  onLocate: (id: string) => void; onCollapse: () => void; hasText: boolean;
  onCalculate: (scenario: Scenario) => void;
}

const calculableRules = new Set(['rental-deposit', 'rental-penalty', 'internship-training', 'internship-pay', 'fitness-refund', 'fitness-closure', 'fitness-fees']);
function RiskCard({ hit, index, expanded, onSelect, onLocate, onCollapse, onCalculate }: { hit: RiskHit; index: number; expanded: boolean; onSelect: () => void; onLocate: () => void; onCollapse: () => void; onCalculate: Props['onCalculate'] }) {
  const [copy, setCopy] = useState<'idle' | 'success' | 'error'>('idle');
  const { rule } = hit;
  async function copyScript() {
    try {
      await navigator.clipboard.writeText(rule.script);
      setCopy('success');
    } catch { setCopy('error'); }
  }
  return <article className={`risk-card ${rule.severity} ${expanded ? 'expanded' : ''}`} id={`risk-${hit.id}`} tabIndex={-1}>
    <button type="button" className="risk-card-toggle" aria-expanded={expanded} aria-controls={`detail-${hit.id}`} onClick={expanded ? onCollapse : onSelect}>
      <span className="risk-icon"><AlertTriangle size={17} /></span>
      <span className="risk-card-title"><span className="risk-kicker"><span>{String(index + 1).padStart(2, '0')}</span><span>{severityLabels[rule.severity]}</span></span><strong>{rule.title}</strong></span>
      <ChevronDown size={17} className={expanded ? 'chevron open' : 'chevron'} />
    </button>
    {!expanded && <button type="button" className="collapsed-excerpt" onClick={onSelect}>{rule.short}<ArrowUpRight size={14} /></button>}
    {expanded && <div className="risk-detail" id={`detail-${hit.id}`}>
      <button type="button" className="source-quote" onClick={onLocate} title="定位到合同原文"><span>“{hit.excerpt}”</span><LocateFixed size={15} /></button>
      <section className="explanation-section"><h4><span className="section-number">01</span>为什么有风险</h4><p>{rule.explanation}</p></section>
      <section className="law-section"><h4><BookOpen size={14} />参考法条</h4><a href={rule.law.url} target="_blank" rel="noopener noreferrer">{rule.law.name} · {rule.law.articles}<ArrowUpRight size={13} /></a><p>{rule.law.summary}</p></section>
      <section className="suggestion-section"><h4><PencilLine size={14} />可以这样修改</h4><p>{rule.suggestion}</p></section>
      <section className="script-section"><h4><MessageCircle size={14} />温和沟通话术</h4><p className="script-text">{rule.script}</p><button type="button" className={`copy-button ${copy === 'success' ? 'copied' : ''}`} onClick={copyScript}>{copy === 'success' ? <Check size={15} /> : <Copy size={15} />}{copy === 'success' ? '已复制，可以去沟通了' : '复制沟通话术'}</button><div role="status" className={copy === 'error' ? 'copy-error' : 'sr-only'}>{copy === 'success' ? '话术已复制到剪贴板' : copy === 'error' ? '浏览器未允许复制，请长按或选中上方话术手动复制。' : ''}</div></section>
      {calculableRules.has(rule.id) && <button type="button" className="calculate-link" onClick={() => onCalculate(rule.scenario)}>去算算差额 →</button>}
      <button type="button" className="locate-link" onClick={onLocate}><LocateFixed size={14} />定位原文<ArrowUpRight size={13} /></button>
    </div>}
  </article>;
}

export function RiskPanel({ result, selected, filter, onFilter, onSelect, onLocate, onCollapse, hasText, onCalculate }: Props) {
  const filtered = result.hits.filter(hit => filter === 'all' || hit.rule.severity === filter);
  return <aside className="risk-panel" aria-label="风险解读">
    <section className="risk-summary panel">
      <div className="summary-title"><h2><ScanIcon />风险体检</h2><span className="summary-tag">规则扫描 · 非法律鉴定</span></div>
      <div className="summary-verdict"><div><span className={`rating ${result.overall}`}>{result.overall === 'none' ? (hasText ? '暂无规则命中' : '等待输入') : result.overall === 'high' ? '高风险' : result.overall === 'medium' ? '需警惕' : '需注意'}</span><p>{result.hits.length ? `发现 ${result.hits.length} 处风险，建议先沟通再签署` : hasText ? '未命中不代表合同安全，请继续核对具体约定' : '文本留在本地，输入后即刻审阅'}</p></div><div className={`summary-stamp ${result.overall}`}><ShieldCheck size={28} strokeWidth={1.3} /></div></div>
      <div className="risk-counts">{severityOrder.map(level => <button type="button" key={level} className={`count-cell ${level} ${filter === level ? 'selected' : ''}`} aria-pressed={filter === level} aria-label={`筛选${severityLabels[level]}，${result.counts[level]}处`} onClick={() => onFilter(filter === level ? 'all' : level)}><span className="count-number">{result.counts[level]}</span><span><span className={`clause-dot ${level}`} />{severityLabels[level]}</span></button>)}</div>
    </section>
    <div className="risk-list-heading"><h3>逐条风险解读 <span>{filtered.length}</span></h3><button type="button" className={filter !== 'all' ? 'filter-reset active' : 'filter-reset'} aria-label="显示全部风险" onClick={() => onFilter('all')}><ListFilter size={14} />{filter === 'all' ? '全部风险' : '清除筛选'}</button></div>
    <div className="risk-list" id="risk-list">
      {filtered.map(hit => <RiskCard key={hit.id} hit={hit} index={result.hits.indexOf(hit)} expanded={selected === hit.id} onSelect={() => onSelect(hit.id)} onLocate={() => onLocate(hit.id)} onCollapse={onCollapse} onCalculate={onCalculate} />)}
      {!filtered.length && <div className="empty-state small"><ShieldCheck size={30} strokeWidth={1.2} /><h3>{!hasText ? '准备好，帮你多看一眼' : filter !== 'all' ? '没有这一等级的命中' : '未命中内置规则'}</h3><p>{filter !== 'all' ? '可点击“全部风险”查看其他提示。' : '规则无法覆盖所有表达或隐含风险，\n重要合同仍建议咨询专业人士。'}</p></div>}
      {result.hits.length > 0 && <div className="review-note">提示可能存在误报或遗漏。<br />风险等级用于安排复核顺序，不是法律效力结论。</div>}
    </div>
  </aside>;
}
function ScanIcon() { return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4M3 10h3l2-3 4 6 2-3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
