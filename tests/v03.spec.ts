import { test, expect, type Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { readFile } from 'node:fs/promises';

const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const secret = 'PRIVATE_V03_王小明_中山路88号_987654321';
function docx(text: string) {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map(line => `<w:p><w:r><w:t>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`),
  }));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))).toBeLessThanOrEqual((await page.viewportSize())!.width);
}
async function canvasAudit(page: Page) {
  await page.addInitScript(() => {
    const drawn: string[] = [];
    Object.assign(window, { __drawn: drawn });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof original>) { drawn.push(args[0]); return original.apply(this, args); };
  });
}
async function downloadPng(page: Page, name: string) {
  await expect(page.getByRole('dialog', { name: '风险体检卡预览' })).toBeVisible();
  const image = page.locator('.report-preview img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(960);
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(1280);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PNG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('ClauseLens-风险体检卡.png');
  await download.saveAs(`.verification/${name}.png`);
  const bytes = await readFile(`.verification/${name}.png`);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBe(960); expect(bytes.readUInt32BE(20)).toBe(1280);
  expect(bytes.length).toBeGreaterThan(20_000);
}

test('Word选择和拖拽、错误保留正文、直线闭环与安全PNG', async ({ page }) => {
  await canvasAudit(page);
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith('http://127.0.0.1:4174/')) external.push(req.url()); });
  await page.goto('/');
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  const input = page.locator('#contract-input');
  const body = `健身年卡协议 ${secret}\n第一条 退费\n任何理由概不退费、不得转让。\n第二条 解释\n最终解释权归甲方所有。`;
  await page.locator('input[type=file]').setInputFiles({ name: `${secret}.docx`, mimeType, buffer: docx(body) });
  await expect(input).toHaveValue(body);
  await expect(page.locator('.risk-card')).toHaveCount(2);
  for (const [name, buffer, message] of [
    ['old.doc', Buffer.from('word'), '旧版 .doc'],
    ['broken.docx', Buffer.from('broken'), '损坏'],
    ['empty.docx', docx(''), '为空'],
    ['huge.docx', Buffer.alloc(2 * 1024 * 1024 + 1), '2 MB'],
  ] as const) {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
    await expect(page.locator('#input-error')).toContainText(message); await expect(input).toHaveValue(body);
  }
  const dropped = '房屋租赁合同\n第一条 押金\n房东可以任意扣除押金，无需提供凭证。';
  const transfer = await page.evaluateHandle(({ bytes, type }) => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], '拖拽合同.docx', { type })); return data; }, { bytes: [...docx(dropped)], type: mimeType });
  await page.locator('.input-panel').dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(page.locator('.input-panel')).toHaveClass(/is-dragging/);
  await page.locator('.input-panel').dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
  await expect(input).toHaveValue(dropped);
  await expect(page.locator('.input-panel')).not.toHaveClass(/is-dragging/);
  await page.locator('input[type=file]').setInputFiles({ name: `${secret}.docx`, mimeType, buffer: docx(body) });
  await expect(input).toHaveValue(body);
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await downloadPng(page, 'v03-private-report');
  await noOverflow(page);
  await page.screenshot({ path: '.verification/v03-report-desktop.png', fullPage: true, animations: 'disabled' });
  const drawn = await page.evaluate(() => (window as unknown as { __drawn: string[] }).__drawn.join('\n'));
  expect(drawn).toContain('健身年卡协议'); expect(drawn).toContain('不构成正式法律意见');
  expect(drawn).not.toMatch(/PRIVATE_V03|王小明|中山路|987654321|任何理由/);
  const blobUrl = await page.locator('.report-preview img').getAttribute('src');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(async url => { try { await fetch(url!); return false; } catch { return true; } }, blobUrl)).toBe(true);
  await page.getByRole('button', { name: '去算算违约金差额 →', exact: true }).click();
  await expect(page.getByRole('tab', { name: '健身年卡退费', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.calculator-source')).toContainText('并非自动提取金额');
  await page.getByRole('button', { name: '去协商与导出 →', exact: true }).click();
  await expect(page.locator('#communication-text')).toHaveValue(/退费/);
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await expect(page.locator('.report-preview img')).toHaveAttribute('alt', /高危1处.*注意1处/);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: '合同 X 光', exact: true }).click();
  await expect(input).toHaveValue(body);
  await page.getByRole('button', { name: '生成协商清单与修订版合同 →', exact: true }).click();
  await expect(page.locator('#communication-text')).toBeEmpty();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('375px全部入口、报告布局、场景未知与零命中提示', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: '风险解读 6' }).click();
  await noOverflow(page);
  await page.screenshot({ path: '.verification/v03-review-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await downloadPng(page, 'v03-sample-report');
  await noOverflow(page);
  await page.screenshot({ path: '.verification/v03-report-mobile.png', fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '去算算违约金差额 →', exact: true }).click();
  await noOverflow(page);
  await page.getByRole('button', { name: '去协商与导出 →', exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: '.verification/v03-negotiate-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '返回审阅 / 换合同', exact: true }).click();
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await page.locator('#contract-input').fill('双方协商处理问题。');
  await expect(page.locator('.next-step-bar')).toContainText('场景尚不明确');
  await page.getByRole('button', { name: '风险解读 0' }).click();
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await downloadPng(page, 'v03-no-hit-report');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '去算算违约金差额 →', exact: true }).click();
  await expect(page.locator('.calculator-source')).toContainText('未能确定单一场景');
  await noOverflow(page);
});

test('真正断网刷新后导入DOCX、生成PNG，不缓存私人数据', async ({ page, context }) => {
  await canvasAudit(page);
  await page.goto('/');
  await expect(page.locator('.offline-status')).toHaveText('离线已就绪');
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await page.locator('#contract-input').fill(secret);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.offline-status')).toHaveText('离线模式');
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await expect(page.locator('#contract-input')).toBeEmpty();
  await page.locator('input[type=file]').setInputFiles({ name: `${secret}.docx`, mimeType, buffer: docx(`房屋租赁合同 ${secret}\n押金可以任意扣除。`) });
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await downloadPng(page, 'v03-offline-report');
  const cached = await page.evaluate(async () => {
    const entries: { url: string; text: string }[] = [];
    for (const key of await caches.keys()) { const cache = await caches.open(key); for (const request of await cache.keys()) entries.push({ url: request.url, text: await (await cache.match(request))!.text() }); }
    return entries;
  });
  expect(cached.every(item => /\/(?:index\.html|favicon\.svg|assets\/[^/]+\.(?:js|css))$/.test(item.url))).toBe(true);
  expect(cached.every(item => !item.text.includes(secret) && !item.url.includes('PRIVATE_V03'))).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await context.setOffline(false);
});
