import { Fragment } from 'react';
import { FileText, MousePointer2, ScanLine } from 'lucide-react';
import type { ContractSample, RiskHit, ScanResult } from '../engine/types';
import { severityLabels, severityOrder } from '../engine/types';

interface Props {
  result: ScanResult; sample?: ContractSample; selected: string | null;
  onSelect: (id: string) => void; custom: boolean;
}

function MarkedText({ text, hits, selected, onSelect }: { text: string; hits: RiskHit[]; selected: string | null; onSelect: Props['onSelect'] }) {
  const boundaries = [...new Set([0, text.length, ...hits.flatMap(hit => hit.ranges.flatMap(range => [range.start, range.end]))])].sort((a, b) => a - b);
  return <>{boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1];
    const active = hits.filter(hit => hit.ranges.some(range => range.start < end && range.end > start)).sort((a, b) => severityOrder.indexOf(a.rule.severity) - severityOrder.indexOf(b.rule.severity));
    if (!active.length) return <Fragment key={start}>{text.slice(start, end)}</Fragment>;
    const hit = active.find(item => item.id === selected) ?? active[0];
    // Split overlapping hits at their boundaries; never drop or duplicate original text.
    return <span key={start} role="button" tabIndex={0} id={hit.ranges[0].start === start ? `mark-${hit.id}` : undefined}
      className={`text-mark ${hit.rule.severity} ${selected === hit.id ? 'is-focused' : ''}`}
      aria-label={`${severityLabels[hit.rule.severity]}：${hit.rule.title}。查看风险解读`}
      aria-pressed={selected === hit.id} onClick={() => onSelect(hit.id)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(hit.id); } }}>{text.slice(start, end)}</span>;
  })}</>;
}

export function ContractReader({ result, sample, selected, onSelect, custom }: Props) {
  return <section className="document-panel panel" aria-label="合同原文">
    <div className="panel-toolbar"><div className="flex items-center gap-2"><FileText size={17} /><h2>合同原文</h2><span className="quiet-chip">{custom ? '仅本页保留' : '教学样本'}</span></div><span className="muted text-xs">{result.clauses.length} 条款</span></div>
    <div className="document-guide"><MousePointer2 size={14} /><span>点击有色条款，看看它藏着什么风险</span><span className="guide-arrow">↗</span></div>
    <div className="document-scroll" id="document-scroll">
      {result.clauses.length ? <div className="paper">
        <div className="paper-heading"><div className="document-eyebrow">{custom ? 'PRIVATE DOCUMENT / 本地文本' : 'SAMPLE DOCUMENT / 虚构教学样本'}</div>
          <h3>{sample?.title ?? '我的合同'}</h3>
          {sample && <><div className="parties">{sample.parties.map(party => <span key={party}>{party}</span>)}</div><div className="document-meta">{sample.meta}</div></>}
        </div>
        <div className="clauses">{result.clauses.map((clause) => {
          const hits = result.hits.filter(hit => hit.clauseId === clause.id);
          const focused = hits.some(hit => hit.id === selected);
          const highest = severityOrder.find(severity => hits.some(hit => hit.rule.severity === severity));
          return <article key={clause.id} id={clause.id} className={`clause ${focused ? 'focused-clause' : ''}`} tabIndex={-1}>
            <div className="clause-heading"><h4><span>{clause.number}</span>{clause.title}</h4>{highest && <span className={`clause-dot ${highest}`} title={`${severityLabels[highest]}风险`} />}</div>
            <p><MarkedText text={clause.text} hits={hits} selected={selected} onSelect={onSelect} /></p>
          </article>;
        })}</div>
        <div className="end-of-document"><span />文档结束<span /></div>
        {!custom && <p className="sample-note">本合同为虚构教学样本，特意包含不平衡条款，请勿直接用于签约。</p>}
      </div> : <div className="empty-state"><ScanLine size={38} strokeWidth={1.2} /><h3>从一份合同开始</h3><p>在上方粘贴正文，或选择 .txt 文件。<br />输入后会自动标出命中的风险片段。</p></div>}
    </div>
    <div className="document-footer"><span><span className="status-dot" />纯文本本地解析</span><span>不识别手写、图片或附件</span></div>
  </section>;
}
