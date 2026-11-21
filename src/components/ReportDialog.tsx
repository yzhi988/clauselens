import { useEffect, useState } from 'react';
import { Download, LockKeyhole, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ReportData } from '../engine/report';
import { renderReportPng } from '../engine/reportCanvas';

export function ReportDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (open: boolean) => void; data: ReportData }) {
  const [image, setImage] = useState<{ url: string; data: ReportData } | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true; let url: string | undefined;
    setImage(null); setError(''); setFeedback('');
    void renderReportPng(data).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob); setImage({ url, data });
    }).catch(() => { if (active) setError('未能生成体检卡，请重试或使用支持 Canvas 的现代浏览器。'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [open, data]);
  const ready = image?.data === data ? image : null;
  function download() {
    if (!ready) return;
    const anchor = document.createElement('a'); anchor.href = ready.url; anchor.download = 'ClauseLens-风险体检卡.png';
    document.body.append(anchor);
    try { anchor.click(); setFeedback('已发起本地 PNG 下载，请查看浏览器下载列表。'); }
    catch { setFeedback('未能下载，请检查浏览器下载设置后重试。'); }
    finally { anchor.remove(); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="report-dialog" showCloseButton={false}>
    <DialogClose className="dialog-close" aria-label="关闭体检卡预览"><X size={19} /></DialogClose>
    <DialogTitle>风险体检卡预览</DialogTitle><DialogDescription>仅含场景、内置风险标题与统计，不含合同原文、姓名、地址或金额明细。</DialogDescription>
    <div className="report-preview">{ready ? <img src={ready.url} width={960} height={1280} alt={`${data.scenarioLabel}风险体检卡：高危${data.counts.high}处、警惕${data.counts.medium}处、注意${data.counts.low}处。完整风险标题见审阅台。`} /> : <p role="status">{error || '正在本地绘制高清体检卡…'}</p>}</div>
    <div className="report-actions"><span><LockKeyhole size={12} />本地生成 · 960 × 1280</span><button type="button" className="primary-action" disabled={!ready} onClick={download}><Download size={15} />下载 PNG</button></div>
    <p role="status" className="report-feedback">{feedback}</p>
  </DialogContent></Dialog>;
}
