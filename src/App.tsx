import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Check, CircleHelp, ClipboardPaste, Dumbbell, FileSearch, FileText, Heart, House, LockKeyhole, ScanLine, ShieldCheck, Upload, WifiOff, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { samples } from './data/samples';
import { legalSources } from './data/rules';
import { scanContract } from './engine/scanner';
import { MAX_TEXT_LENGTH, readContractFile } from './engine/file';
import type { Scenario } from './engine/types';
import { severityLabels } from './engine/types';
import { ContractReader } from './components/ContractReader';
import { RiskPanel, type RiskFilter } from './components/RiskPanel';
import { useOffline } from './useOffline';
import { Calculator, type CalculatorLaunch } from './components/Calculator';
import { Negotiation } from './components/Negotiation';
import { defaultSelectedIds } from './engine/negotiation';
import { buildReportData, inferContractScenario } from './engine/report';
import { ReportDialog } from './components/ReportDialog';

type Module = 'review' | 'calculator' | 'negotiate';
function moduleFromUrl(): Module {
  const value = new URLSearchParams(window.location.search).get('module');
  return value === 'calculator' || value === 'negotiate' ? value : 'review';
}

type Mode = Scenario | 'custom';
type MobileView = 'document' | 'risk';
const modeIcons = { rental: House, internship: BriefcaseBusiness, fitness: Dumbbell, custom: ClipboardPaste };
const initialResult = scanContract(samples[0].text, 'rental');

export default function App() {
  const [module, setModule] = useState<Module>(moduleFromUrl);
  const [calculatorLaunch, setCalculatorLaunch] = useState<CalculatorLaunch | null>(null);
  const [negotiationIds, setNegotiationIds] = useState<string[]>(() => defaultSelectedIds(initialResult.hits));
  const [mode, setMode] = useState<Mode>('rental');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<RiskFilter>('all');
  const [selected, setSelected] = useState<string | null>(initialResult.hits[0]?.id ?? null);
  const [mobileView, setMobileView] = useState<MobileView>('document');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [inputError, setInputError] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [navigation, setNavigation] = useState<{ target: string; side: MobileView; sequence: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importSequence = useRef(0);
  const { online, cacheState } = useOffline();
  const sample = samples.find(item => item.id === mode);
  const content = sample?.text ?? text;
  const result = useMemo(() => scanContract(content, mode === 'custom' ? 'auto' : mode), [content, mode]);
  const activeId = result.hits.some(hit => hit.id === selected) ? selected : null;
  const reportData = useMemo(() => buildReportData(result.hits, mode === 'custom' ? 'auto' : mode), [result, mode]);
  const currentScenario = inferContractScenario(result.hits, mode === 'custom' ? 'auto' : mode);
  useEffect(() => { setNegotiationIds(defaultSelectedIds(result.hits)); }, [result]);
  useEffect(() => {
    const onPopState = () => setModule(moduleFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  function switchModule(value: string) {
    if (value !== 'review' && value !== 'calculator' && value !== 'negotiate') return;
    if (value !== module) {
      setModule(value);
      const url = new URL(window.location.href);
      if (value === 'review') url.searchParams.delete('module'); else url.searchParams.set('module', value);
      window.history.pushState(null, '', url);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }
  function launchCalculator(scenario: Scenario | null) {
    setCalculatorLaunch(previous => ({ scenario: scenario ?? 'rental', sequence: (previous?.sequence ?? 0) + 1, source: sample?.title ?? (scenario ? '我的合同（示例参数，请按实际调整）' : '未能确定单一场景，先展示租房示例，请手动选择适用场景') }));
    switchModule('calculator');
    requestAnimationFrame(() => document.getElementById('module-calculator-tab')?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (mode === 'custom') return;
    const first = scanContract(samples.find(item => item.id === mode)!.text, mode).hits[0];
    const frame = requestAnimationFrame(() => {
      const element = first && document.getElementById(first.clauseId);
      const scroller = document.getElementById('document-scroll');
      if (element && scroller) scroller.scrollTo({ top: element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 20, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  function switchMode(value: string) {
    const next = value as Mode;
    if (next === mode) return;
    setMode(next); setFilter('all'); setMobileView('document'); setNavigation(null);
    const nextText = samples.find(item => item.id === next)?.text ?? text;
    setSelected(scanContract(nextText, next === 'custom' ? 'auto' : next).hits[0]?.id ?? null);
    requestAnimationFrame(() => { document.getElementById('document-scroll')?.scrollTo(0, 0); document.getElementById('risk-list')?.scrollTo(0, 0); });
  }
  function navigate(id: string, side: MobileView, switchView: boolean) {
    setSelected(id);
    if (side === 'risk') setFilter('all');
    if (switchView) setMobileView(side);
    setNavigation(previous => ({ target: id, side, sequence: (previous?.sequence ?? 0) + 1 }));
  }
  useEffect(() => {
    if (!navigation) return;
    const frame = requestAnimationFrame(() => {
      const hit = result.hits.find(item => item.id === navigation.target);
      if (!hit) return;
      const element = navigation.side === 'risk'
        ? document.getElementById(`risk-${hit.id}`)
        : document.getElementById(`mark-${hit.id}`) ?? document.getElementById(hit.clauseId);
      const scroller = document.getElementById(navigation.side === 'risk' ? 'risk-list' : 'document-scroll');
      if (!element || !scroller) return;
      const smallScreen = window.matchMedia('(max-width: 800px)').matches;
      if (smallScreen && mobileView !== navigation.side) return;
      // Desktop: move only the target column, never the whole workbench.
      const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 18;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      if (smallScreen) document.getElementById('mobile-view-switch')?.scrollIntoView({ block: 'start', behavior: 'instant' });
      element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, result, mobileView]);

  function updateText(value: string) {
    importSequence.current += 1; setReadingFile(false);
    if (value.length > MAX_TEXT_LENGTH) { setInputError('最多可审阅 50,000 字符，超出部分未加入。请分段审阅。'); value = value.slice(0, MAX_TEXT_LENGTH); }
    else setInputError('');
    setText(value); setFileStatus(''); setNavigation(null); setFilter('all');
  }
  async function importFile(file?: File) {
    if (!file) return;
    const sequence = ++importSequence.current;
    setInputError(''); setFileStatus(''); setReadingFile(true);
    try {
      const imported = await readContractFile(file);
      if (sequence !== importSequence.current) return;
      setText(imported); setSelected(null); setFilter('all'); setNavigation(null);
      setFileStatus('已在本地读取，扫描完成。文件不会上传或保存。');
    } catch (error) {
      if (sequence === importSequence.current) setInputError(error instanceof Error ? error.message : '无法读取文件，请直接粘贴文本。');
    } finally {
      if (sequence === importSequence.current) setReadingFile(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const offlineLabel = cacheState === 'ready' ? (online ? '离线已就绪' : '离线模式') : cacheState === 'dev' ? '本地开发模式' : cacheState === 'loading' ? '准备离线资源' : '离线缓存未就绪';

  return <Tabs value={module} onValueChange={switchModule} className="app-shell">
    <a href="#main-content" className="skip-link">跳转到工作区</a>
    <header className="brand-header"><div className="header-inner">
      <a className="brand" href="#" aria-label="ClauseLens 条款透视镜首页" onClick={event => { event.preventDefault(); switchMode('rental'); switchModule('review'); }}><span className="brand-mark"><FileSearch size={26} strokeWidth={1.65} /></span><span className="brand-wordmark">Clause<span>Lens</span><small>条款透视镜</small></span></a>
      <nav className="module-nav" aria-label="产品模块"><TabsList variant="line" className="module-tabs-list" aria-label="产品模块"><TabsTrigger value="review"><ScanLine size={16} />合同 X 光</TabsTrigger><TabsTrigger id="module-calculator-tab" value="calculator">违约金计算器</TabsTrigger><TabsTrigger value="negotiate">协商与导出</TabsTrigger></TabsList></nav>
      <button type="button" className="privacy-button" onClick={() => setPrivacyOpen(true)}><ShieldCheck size={16} /><span>隐私优先</span></button>
    </div></header>
    <div className="boundary-bar"><div><ShieldCheck size={16} /><p>仅作常见霸王条款风险提示与科普参考，不构成正式法律意见；<strong>所有内容均在浏览器本地分析，不上传服务器。</strong></p><button type="button" aria-label="查看法律与隐私边界" onClick={() => setPrivacyOpen(true)}><CircleHelp size={16} /></button></div></div>

    <main className="main-container" id="main-content" tabIndex={-1}>
      <TabsContent value="review" forceMount className="module-content">
      <div className="intro-row"><div><div className="eyebrow"><span />让每一次签字，都更有底气</div><h1>合同 X 光审阅台<span className="round-label">公益开放工具</span></h1><p className="intro-description">看清那些小字里的大问题，把不对等的条款变成可以商量的事。</p></div><div className="local-status"><div><span className="status-dot" />本地分析，合同不离开你的设备</div><span><LockKeyhole size={12} /> 无需登录 · 无 AI 上传 · 无历史留存</span></div></div>

      <Tabs value={mode} onValueChange={switchMode} className="contract-tabs">
        <div className="sample-bar"><TabsList aria-label="选择合同样本或输入自己的合同" className="sample-tabs-list">
          {(['rental', 'internship', 'fitness', 'custom'] as const).map(value => { const Icon = modeIcons[value]; return <TabsTrigger className={`sample-tab ${value === 'custom' ? 'custom-tab' : ''}`} key={value} value={value}><Icon size={17} /><span>{value === 'custom' ? '粘贴我的合同' : samples.find(item => item.id === value)!.label}</span>{mode === value && <span className="tab-selected-dot" />}</TabsTrigger>; })}
        </TabsList><span className="sample-hint">{mode === 'custom' ? '仅在当前页面内存中保留' : '内置样本，点击即可体验'}<ArrowRight size={14} /></span></div>
        <TabsContent value={mode} className="contract-content">
          {mode === 'custom' && <section className={`input-panel panel ${dragging ? 'is-dragging' : ''}`} aria-label="输入我的合同"
            onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true); }}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
            onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
            onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (event.dataTransfer.files.length !== 1) { setInputError('请每次拖入一个 .txt 或 .docx 文件。'); return; } void importFile(event.dataTransfer.files[0]); }}><div className="input-heading"><label htmlFor="contract-input"><ClipboardPaste size={17} />粘贴合同正文</label><div><button type="button" className="plain-button" disabled={!text && !readingFile} onClick={() => { updateText(''); setSelected(null); }}>清空</button><button type="button" className="upload-button" onClick={() => fileRef.current?.click()} disabled={readingFile}><Upload size={14} />{readingFile ? '本地读取中…' : '导入 TXT / Word'}</button></div></div>
            <textarea id="contract-input" value={text} onChange={event => updateText(event.target.value)} placeholder="把合同文字粘贴在这里，风险会自动出现在下方。建议先隐去姓名、身份证号、详细地址等个人信息。" spellCheck={false} aria-describedby="input-privacy input-error" />
            <input ref={fileRef} type="file" accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" tabIndex={-1} aria-label="选择本地 txt 或 docx 合同文件" onChange={event => { void importFile(event.target.files?.[0]); }} />
            <div className="input-bottom"><p id="input-privacy"><LockKeyhole size={12} />可拖入 TXT ≤ 200 KB / DOCX ≤ 2 MB · 本地解析 · 刷新即清</p><span>{text.length.toLocaleString()} / 50,000</span></div>
            <p id="input-error" role="alert" className={inputError ? 'input-error' : 'sr-only'}>{inputError}</p><p role="status" className={fileStatus ? 'file-status' : 'sr-only'}>{fileStatus}</p>
          </section>}
          {mode === 'internship' && <div className="internship-boundary"><BookNotice /><p><strong>先确认关系，再看条款。</strong>在校实习不当然构成劳动关系；劳动合同法相关提示以依法成立劳动关系为前提。</p></div>}
          <div className="workbench-label"><span className="scan-complete"><Check size={13} />{content.trim() ? '本地扫描完成' : '等待输入合同'}<span className="scan-separator">/</span><span>{mode === 'custom' ? '自动识别场景' : '教学样本'}</span></span><div className="legend">{(['high', 'medium', 'low'] as const).map(level => <span key={level}><span className={`clause-dot ${level}`} />{severityLabels[level]}</span>)}</div></div>
          <div id="mobile-view-switch" className="mobile-view-switch" role="group" aria-label="切换原文与风险视图"><button type="button" aria-pressed={mobileView === 'document'} onClick={() => setMobileView('document')}><FileText size={16} />合同原文</button><button type="button" aria-pressed={mobileView === 'risk'} onClick={() => setMobileView('risk')}><ScanLine size={16} />风险解读<span>{result.hits.length}</span></button></div>
          <div className={`workspace mobile-${mobileView}`} id="workspace" tabIndex={-1}>
            <ContractReader result={result} sample={sample} selected={activeId} onSelect={id => navigate(id, 'risk', true)} custom={mode === 'custom'} />
            <RiskPanel result={result} selected={activeId} filter={filter} onFilter={setFilter} onSelect={id => navigate(id, 'document', false)} onLocate={id => navigate(id, 'document', true)} onCollapse={() => setSelected(null)} hasText={!!content.trim()} onCalculate={launchCalculator} onReport={() => setReportOpen(true)} />
          </div>
          <section className="next-step-bar" aria-label="审阅后的下一步"><div><span className="eyebrow">下一步</span><p>把发现的问题，变成可以谈的方案。</p>{mode === 'custom' && !currentScenario && <small>场景尚不明确，可进入计算器手动选择；参数均为示例。</small>}</div><div className="next-step-actions"><button type="button" className="primary-action" onClick={() => launchCalculator(currentScenario)}>去算算违约金差额 →</button><button type="button" className="subtle-button" onClick={() => switchModule('negotiate')}>生成协商清单与修订版合同 →</button></div></section>
          <p className="sr-only" role="status">{content.trim() ? `扫描完成，共${result.hits.length}处风险：高危${result.counts.high}，警惕${result.counts.medium}，注意${result.counts.low}。` : '等待输入合同。'}</p>
        </TabsContent>
      </Tabs>
      </TabsContent>
      <TabsContent value="calculator" forceMount className="module-content"><Calculator launch={calculatorLaunch} onReview={() => switchModule('review')} onNegotiate={() => switchModule('negotiate')} /></TabsContent>
      <TabsContent value="negotiate" forceMount className="module-content"><Negotiation title={sample?.title ?? '我的合同'} result={result} scenario={mode === 'custom' ? 'auto' : mode} selectedIds={negotiationIds} onSelection={setNegotiationIds} onReview={() => switchModule('review')} onReport={() => setReportOpen(true)} /></TabsContent>
      <footer className="app-footer"><span><Heart size={13} />让法律常识，成为每个人的日常工具。</span><div><button type="button" className="footer-privacy" onClick={() => setPrivacyOpen(true)}>法律与隐私边界</button><span className="footer-divider" /><span className="offline-status" title="生产版首次联网缓存完成后，同一浏览器可断网刷新；开发模式不启用离线缓存。">{!online ? <WifiOff size={13} /> : <span className={`status-dot ${cacheState === 'ready' ? '' : 'neutral'}`} />}{offlineLabel}</span><span className="version">v0.3</span></div></footer>
    </main>
    <ReportDialog open={reportOpen} onOpenChange={setReportOpen} data={reportData} />
    <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}><DialogContent className="privacy-dialog" showCloseButton={false}><DialogClose className="dialog-close" aria-label="关闭隐私说明"><X size={19} /></DialogClose><div className="privacy-dialog-icon"><ShieldCheck size={25} /></div><DialogTitle>你的合同，只留在你的设备</DialogTitle><DialogDescription>ClauseLens 的法律、隐私与离线边界</DialogDescription><div className="privacy-body"><section><h3>我们做什么，不做什么</h3><p>使用18条本地规则提示常见风险，不连接远程 AI，不判断合同最终效力，不保证发现全部问题。等级表示复核优先级，不是司法结论。适用于中国大陆合同科普，重要事项请咨询专业人士。</p></section><section><h3>文本不上传，也不保存</h3><p>支持 TXT（≤200 KB）与 DOCX（≤2 MB）选择或拖拽，本地解析正文（≤50,000字符），不读取图片、页眉页脚或批注，不执行宏或外链；旧 DOC 请在 Word/WPS 另存为 DOCX。粘贴或导入的内容仅在当前标签页内存中分析。切换样本时暂存，清空、刷新或关闭页面即清除。不写入浏览器持久存储，不记录日志、不使用统计埋点。金额推演、勾选与沟通文本也仅保留在内存；修订合同与清单通过本地生成 HTML 或 Markdown 文件完成；体检卡 PNG 只含内置场景名、风险标题和统计，不含合同原文及金额明细。所有导出不上传、不调用云端转换，下载后的文件由你自行保管，刷新页面不会删除已下载文件。剪贴板仅在点击复制时写入。</p></section><section><h3>“离线可用”的前提</h3><p>生产版首次联网加载，显示“离线已就绪”后，同一浏览器、同一地址可断网刷新。缓存只含应用和虚构样本，不含你的合同。首次访问或清理缓存后需重新联网。开发模式不启用离线缓存。</p></section><section><h3>仍需注意的边界</h3><p>托管方可能记录静态页面访问的基础元数据；合同内容不会发送。浏览器扩展、共享设备及系统剪贴板不在应用控制范围内。点击下方官方法条链接会主动访问外部网站，离线时仍可阅读卡片内的要点。</p></section><div className="legal-source-links"><a href={legalSources.civil} target="_blank" rel="noopener noreferrer">民法典 · 官方全文 ↗</a><a href={legalSources.labor} target="_blank" rel="noopener noreferrer">劳动合同法 · 官方全文 ↗</a></div></div></DialogContent></Dialog>
  </Tabs>;
}
function BookNotice() { return <CircleHelp size={16} />; }
