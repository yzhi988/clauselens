import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileCheck2, LockKeyhole, MessageCircle, PencilLine } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ScanResult, ScanScenario } from '../engine/types';
import { severityLabels } from '../engine/types';
import { buildNegotiationText, buildNegotiationMarkdown, buildPrintableHtml, defaultSelectedIds, groupRedlines, type Tone } from '../engine/negotiation';

interface Props { title: string; result: ScanResult; scenario: ScanScenario; selectedIds: string[]; onSelection: (ids: string[]) => void; onReview: () => void; onReport: () => void }
function downloadLocal(content: string, fileName: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName;
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export function Negotiation({ title, result, scenario, selectedIds, onSelection, onReview, onReport }: Props) {
  const [tone, setTone] = useState<Tone>('gentle');
  const [feedback, setFeedback] = useState('');
  const input = useMemo(() => ({ title, clauses: result.clauses, hits: result.hits, selectedIds, tone, scenario }), [title, result, selectedIds, tone, scenario]);
  const communication = useMemo(() => buildNegotiationText(input), [input]);
  const groups = useMemo(() => groupRedlines(input), [input]);
  const count = groups.reduce((total, group) => total + group.hits.length, 0);
  useEffect(() => { setFeedback(''); }, [input]);
  async function copyAll() {
    if (!communication) return;
    try { await navigator.clipboard.writeText(communication); setFeedback('完整沟通清单已复制，请确认内容后自行发送。'); }
    catch { setFeedback('浏览器未允许复制。请选中下方沟通清单，手动复制。'); }
  }
  function exportFile(format: 'html' | 'md') {
    if (!communication) return;
    try {
      downloadLocal(format === 'html' ? buildPrintableHtml(input) : buildNegotiationMarkdown(input), format === 'html' ? 'ClauseLens-修订对照合同.html' : 'ClauseLens-协商清单.md', format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8');
      setFeedback(format === 'html' ? '已生成本地 HTML 下载。打开下载文件后，可用浏览器“打印”另存 PDF。' : '已生成本地 Markdown 下载。');
    } catch { setFeedback('未能生成下载，请复制下方清单保存，或检查浏览器的下载设置。'); }
  }
  return <section aria-label="协商清单与修订导出">
    <div className="intro-row module-intro"><div><div className="eyebrow"><span />把担心，变成一份具体的修改请求</div><h1>协商与导出<span className="round-label">协商草案 · 未达成合意</span></h1><p className="intro-description">选好要谈的条款，带上完整话术和修订对照。不替你发送，不替双方作决定。</p></div><button type="button" className="subtle-button" onClick={onReview}><ArrowLeft size={14} />返回审阅 / 换合同</button></div>
    <div className="current-contract"><FileCheck2 size={18} /><div><span>当前审阅合同</span><strong>{title}</strong></div><span className="quiet-chip">{result.hits.length} 处命中 · 已选 {count} 处</span><button type="button" className="subtle-button" disabled={!result.clauses.length} onClick={onReport}><Download size={14} />导出体检卡（PNG）</button></div>
    <div className="negotiation-grid"><aside className="panel negotiation-selection"><div className="section-heading"><span className="step-label">01</span><h2>选出这次要谈的事项</h2></div><p className="field-hint">默认选择高危与警惕，可按你的实际需要调整。</p><div className="selection-actions"><button type="button" onClick={() => onSelection(defaultSelectedIds(result.hits))}>恢复默认</button><button type="button" onClick={() => onSelection(result.hits.map(hit => hit.id))}>全选</button><button type="button" onClick={() => onSelection([])}>清空选择</button></div>
      <div className="selection-list">{result.hits.map(hit => <label key={hit.id} className={`selection-item ${selectedIds.includes(hit.id) ? 'chosen' : ''}`}><input type="checkbox" checked={selectedIds.includes(hit.id)} onChange={event => onSelection(event.target.checked ? [...selectedIds, hit.id] : selectedIds.filter(id => id !== hit.id))} /><span><span className="selection-meta"><i className={`clause-dot ${hit.rule.severity}`} />{severityLabels[hit.rule.severity]}<span>{result.clauses.find(clause => clause.id === hit.clauseId)?.number}</span></span><strong>{hit.rule.title}</strong><small>{hit.excerpt}</small></span></label>)}</div>
      {!result.hits.length && <div className="empty-state small"><FileCheck2 size={28} /><h3>当前没有规则命中</h3><p>可以回到审阅台输入合同或切换样本。没有命中不代表合同安全。</p></div>}
      <p className="selection-note"><LockKeyhole size={13} />勾选仅在本页内存保留，换合同重新初始化。</p>
    </aside><div className="negotiation-preview"><section className="panel communication-card"><div className="section-heading"><span className="step-label">02</span><h2>一份可以直接沟通的清单</h2></div><Tabs value={tone} onValueChange={value => setTone(value as Tone)}><TabsList className="tone-tabs" aria-label="选择沟通语气"><TabsTrigger value="gentle"><MessageCircle size={14} />温和商量版</TabsTrigger><TabsTrigger value="firm">坚定底线版</TabsTrigger></TabsList><TabsContent value={tone}>
      <label htmlFor="communication-text" className="sr-only">完整沟通清单</label><textarea id="communication-text" readOnly value={communication} placeholder="先在事项列表中勾选至少一处风险，再生成沟通清单。" spellCheck={false} />
      <div className="communication-actions"><span>{count ? `${count} 处事项，按原文顺序整理` : '未选择事项，复制与导出暂不可用'}</span><button type="button" className="primary-action" disabled={!communication} onClick={() => { void copyAll(); }}>{feedback.startsWith('完整') ? <Check size={15} /> : <Copy size={15} />}复制全文</button></div>
      <div className="export-actions"><button type="button" className="download-action" disabled={!communication} onClick={() => exportFile('html')}><Download size={16} /><span>修订合同 · HTML<small>完整合同，可打印为 PDF</small></span></button><button type="button" className="download-action" disabled={!communication} onClick={() => exportFile('md')}><Download size={16} /><span>协商清单 · Markdown<small>便于保存与继续编辑</small></span></button></div><p className="export-hint">文件只在你的设备生成。HTML 打开后使用浏览器打印，可选择“另存为 PDF”。</p><p role="status" className="negotiation-feedback">{feedback}</p></TabsContent></Tabs></section>
      <section className="panel redline-panel"><div className="section-heading"><span className="step-label">03</span><h2>修订对照，改哪里一目了然</h2></div><div className="redline-legend"><span><del>原文</del> 红色删除线</span><span><strong>建议</strong> 墨绿色加粗</span></div><p className="field-hint">以下是修改建议，不是已生效合同；同条多个建议须由双方整合确认。导出会保留未选条款。</p>
        {groups.map(({ clause, hits }) => <article className="redline-clause" key={clause.id}><h3>{clause.number} {clause.title}</h3><div className="redline-original"><span>原条款</span><del>{clause.text}</del></div>{hits.map(hit => <div className="redline-proposal" key={hit.id}><span><PencilLine size={12} />建议修改为 · {hit.rule.title}</span><strong>{hit.rule.suggestion}</strong></div>)}</article>)}
        {!groups.length && <div className="redline-empty">勾选事项后，在这里查看原文与建议的对照。</div>}
      </section></div></div>
  </section>;
}
