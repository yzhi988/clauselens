import { REPORT_DISCLAIMER, type ReportData } from './report';
import { severityLabels, severityOrder } from './types';

const colors = { high: '#B8443A', medium: '#976519', low: '#3F6C9B', none: '#536964' };
const soft = { high: '#FBECE8', medium: '#FBF2DE', low: '#EAF1F9', none: '#ECF1EE' };
const ratings = { high: '高风险', medium: '需警惕', low: '需注意', none: '未命中' };
const font = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

/** Accepts only the safe DTO; no contract or filename is available to this renderer. */
export async function renderReportPng(data: ReportData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 960; canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器暂不支持生成图片，请换用现代浏览器。');
  ctx.scale(2, 2);
  function box(x: number, y: number, w: number, h: number, fill: string, radius = 12) {
    ctx!.fillStyle = fill; ctx!.beginPath(); ctx!.roundRect(x, y, w, h, radius); ctx!.fill();
  }
  function text(value: string, x: number, y: number, size = 14, color = '#253C42', weight = 400) {
    ctx!.font = `${weight} ${size}px ${font}`; ctx!.fillStyle = color; ctx!.fillText(value, x, y);
  }
  function wrap(value: string, x: number, y: number, width: number, size: number, lineHeight: number, color = '#66716D', weight = 400) {
    ctx!.font = `${weight} ${size}px ${font}`;
    let line = ''; let row = 0;
    for (const char of value) {
      if (ctx!.measureText(line + char).width > width && line) { text(line, x, y + row * lineHeight, size, color, weight); line = ''; row++; }
      line += char;
    }
    if (line) text(line, x, y + row * lineHeight, size, color, weight);
  }
  box(0, 0, 480, 640, '#F7F6F2', 0);
  box(24, 24, 432, 592, '#FFFFFF', 18);
  box(44, 45, 30, 30, '#253C42', 8);
  text('CL', 49, 65, 14, '#FFFFFF', 700);
  text('ClauseLens', 84, 59, 19, '#253C42', 700);
  text('条款透视镜 · 公益合同科普', 84, 76, 10);
  text('风险体检卡', 44, 119, 26, '#253C42', 700);
  text(data.scenarioLabel, 45, 142, 13, '#66716D');
  box(342, 98, 94, 54, soft[data.overall], 9);
  text(ratings[data.overall], 356, 123, 21, colors[data.overall], 700);
  text('复核优先级', 361, 140, 10, colors[data.overall]);
  for (const [index, level] of severityOrder.entries()) {
    const x = 44 + index * 134;
    box(x, 165, 124, 66, soft[level], 9);
    const count = String(data.counts[level]);
    let countSize = 27;
    ctx!.font = `700 ${countSize}px ${font}`;
    while (ctx!.measureText(count).width > 50 && countSize > 12) { countSize--; ctx!.font = `700 ${countSize}px ${font}`; }
    text(count, x + 14, 196, countSize, colors[level], 700);
    text(severityLabels[level], x + 69, 195, 12, colors[level], 600);
    text('处规则命中', x + 14, 217, 10, colors[level]);
  }
  text(data.total ? `核心风险摘要  /  共 ${data.total} 处命中` : '本次未命中内置规则', 44, 260, 12, '#253C42', 600);
  data.risks.forEach((risk, index) => {
    const y = 281 + index * 38;
    box(44, y - 12, 40, 22, soft[risk.severity], 5);
    text(severityLabels[risk.severity], 52, y + 3, 11, colors[risk.severity], 600);
    wrap(risk.title, 96, y + 3, risk.occurrences > 1 ? 280 : 337, 13, 16, '#253C42', 500);
    if (risk.occurrences > 1) text(`×${risk.occurrences}`, 397, y + 3, 11, '#66716D');
  });
  if (!data.total) {
    wrap('未命中不代表合同安全。规则可能误报或漏报，请继续核对具体约定，重要事项咨询专业人士。', 44, 296, 382, 16, 27);
  }
  text(data.omitted ? `另有 ${data.omitted} 类风险，请在审阅台查看完整结果。` : '风险提示不是合同效力判定，重要事项请人工复核。', 44, 518, 10);
  box(44, 537, 392, 1, '#E4E7E2', 0);
  wrap(REPORT_DISCLAIMER, 44, 560, 392, 11, 18);
  text('本地生成 · 不含合同原文与金额明细', 44, 600, 10, '#66716D');
  text('v0.3', 412, 600, 10, '#66716D');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('未能生成图片，请重试。')), 'image/png'));
}
