import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth))).toBeLessThanOrEqual(page.viewportSize()!.width);
}
async function moduleTab(page: Page, name: string) {
  await page.getByRole('tablist', { name: '产品模块', exact: true }).getByRole('tab', { name, exact: true }).click();
}
async function aboveHeader(page: Page, selector: string) {
  const position = await page.locator(selector).evaluate(element => ({
    top: element.getBoundingClientRect().top,
    header: document.querySelector('.brand-header')!.getBoundingClientRect().bottom,
  }));
  expect(position.top).toBeGreaterThanOrEqual(position.header);
}
async function downloadText(page: Page, button: RegExp, path: string) {
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const download = await ready;
  await download.saveAs(path);
  return readFile(path, 'utf8');
}

test('v0.4 单句扫描、手动场景贯通计算/协商/报告、静态筛选与科普', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.version')).toHaveText('v0.4');
  await expect(page.getByRole('button', { name: '全部风险', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '清除筛选', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '筛选高危，3处' }).click();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.risk-card')).toHaveCount(6);
  await expect(page.getByRole('button', { name: '清除筛选', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  const input = page.locator('#contract-input');
  for (const [text, id] of [
    ['押金概不退还。', 'rental-deposit'],
    ['提前退租扣除3个月租金。', 'rental-penalty'],
    ['离职须赔偿培训费8000元。', 'internship-training'],
    ['一经售出不退不换。', 'fitness-refund'],
    ['最终解释权归甲方所有。', 'fitness-interpretation'],
  ]) {
    await input.fill(text);
    await expect(page.locator(`[id$="-${id}"].risk-card`)).toHaveCount(1);
  }
  await input.fill('离职须赔偿培训费8000元。');
  await page.getByLabel('合同场景', { exact: true }).selectOption('rental');
  await expect(page.locator('.risk-card')).toHaveCount(0);
  await page.getByLabel('合同场景', { exact: true }).selectOption('internship');
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await page.getByText('为什么换个说法可能会漏报？', { exact: true }).click();
  await expect(page.locator('.rule-literacy')).toHaveAttribute('open', '');
  await expect(page.locator('.rule-literacy')).toContainText('保证款用于覆盖退出安排');
  await page.getByRole('button', { name: '去算算违约金差额 →', exact: true }).click();
  await expect(page.getByRole('tab', { name: '实习 / 试用期离职', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.calculator-source')).toContainText('并非自动提取金额');
  await page.getByRole('button', { name: '去协商与导出 →', exact: true }).click();
  await expect(page.locator('#communication-text')).toHaveValue(/HR您好/);
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await expect(page.locator('.report-preview img')).toHaveAttribute('alt', /实习.*高危1处/);
  await page.keyboard.press('Escape');
  await moduleTab(page, '合同 X 光');
  await expect(input).toHaveValue('离职须赔偿培训费8000元。');
  await expect(page.locator('#scan-scenario')).toHaveValue('internship');
  expect(errors).toEqual([]);
});

test('自定义标题内存编辑、转义下载、选择不重置、PNG白名单完全隔离', async ({ page, context }) => {
  const secret = 'PRIVATE_V04_李同学_长江路99号_88001234';
  const title = `<img src=x onerror=alert(1)>${secret}`;
  await page.addInitScript(() => {
    const drawn: string[] = []; Object.assign(window, { __drawn: drawn });
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof original>) { drawn.push(args[0]); return original.apply(this, args); };
  });
  await page.goto('/');
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await page.locator('#contract-input').fill('第一条 扣除全部押金。\n第二条 提前退租扣除3个月租金。');
  await page.locator('#scan-scenario').selectOption('rental');
  await moduleTab(page, '协商与导出');
  await expect(page.locator('#export-title')).toHaveValue('我的合同');
  await page.locator('.selection-item input').first().uncheck();
  await page.locator('#export-title').fill(title);
  await expect(page.locator('.selection-item input:checked')).toHaveCount(1);
  await expect(page.locator('#communication-text')).toHaveValue(new RegExp(secret));
  await moduleTab(page, '违约金计算器'); await moduleTab(page, '协商与导出');
  await expect(page.locator('#export-title')).toHaveValue(title);
  await expect(page.locator('.selection-item input:checked')).toHaveCount(1);
  const html = await downloadText(page, /修订合同 · HTML/, '.verification/v04-title-contract.html');
  const md = await downloadText(page, /协商清单 · Markdown/, '.verification/v04-title-list.md');
  expect(html).toContain('&lt;img'); expect(html).not.toContain('<img'); expect(html).toContain(secret);
  expect(md).toContain('&lt;img'); expect(md).not.toContain('<img');
  const exported = await context.newPage();
  const external: string[] = []; exported.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
  try {
    await exported.setContent(html);
    await expect(exported.locator('h1')).toHaveText(title);
    expect(external).toEqual([]);
  } finally { await exported.close(); }
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await expect.poll(() => page.locator('.report-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(960);
  const png = await page.locator('.report-preview img').evaluate(async (img: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())));
  await page.keyboard.press('Escape');
  await page.locator('#export-title').fill('另一个仅用于私人文档的标题');
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await expect.poll(() => page.locator('.report-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(960);
  expect(await page.locator('.report-preview img').evaluate(async (img: HTMLImageElement) => Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())))).toEqual(png);
  const drawn = await page.evaluate(() => (window as unknown as { __drawn: string[] }).__drawn.join('\n'));
  expect(drawn).not.toMatch(/PRIVATE_V04|李同学|长江路|88001234|另一个|onerror/);
  expect(drawn).toContain('v0.4');
  await page.screenshot({ path: '.verification/v04-safe-report.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.locator('#export-title').fill('   ');
  await expect(page.locator('#communication-text')).toHaveValue(/《我的合同》/);
  await page.locator('#export-title').fill('长标题'.repeat(60));
  expect((await page.locator('#export-title').inputValue()).length).toBe(80);
  await noOverflow(page);
  await page.reload(); await moduleTab(page, '合同 X 光');
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await expect(page.locator('#contract-input')).toBeEmpty();
  await expect(page.locator('#scan-scenario')).toHaveValue('auto');
  await moduleTab(page, '协商与导出');
  await expect(page.locator('#export-title')).toHaveValue('我的合同');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
});

for (const width of [1440, 375]) test(`${width}px 吸顶导航、双向定位与长标题无遮挡`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1040 });
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('.brand-header')).toHaveCSS('position', 'sticky');
  expect((await page.locator('.brand-header').boundingBox())!.y).toBe(0);
  await moduleTab(page, '违约金计算器');
  await page.locator('#vacancy-number').scrollIntoViewIfNeeded();
  await aboveHeader(page, width === 375 ? '.mobile-calculation-summary' : '.calculator-results');
  await page.screenshot({ path: `.verification/v04-sticky-calculator-${width}.png`, animations: 'disabled' });
  await moduleTab(page, '合同 X 光');
  await page.locator('#mark-clause-3-rental-deposit').click();
  await expect(page.locator('#risk-clause-3-rental-deposit')).toHaveClass(/expanded/);
  await aboveHeader(page, '#risk-clause-3-rental-deposit');
  if (width === 375) await aboveHeader(page, '#mobile-view-switch');
  await page.getByRole('button', { name: '定位原文', exact: true }).click();
  await aboveHeader(page, '#mark-clause-3-rental-deposit');
  await noOverflow(page);
  await page.screenshot({ path: `.verification/v04-review-${width}.png`, animations: 'disabled' });
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await page.locator('#contract-input').fill('扣除全部押金。');
  await moduleTab(page, '协商与导出');
  await page.locator('#export-title').fill('用于验证不会横向溢出的长标题'.repeat(6));
  await noOverflow(page);
  await page.screenshot({ path: `.verification/v04-title-${width}.png`, fullPage: true, animations: 'disabled' });
});

test('v0.4 真正离线单句/场景/标题导出，缓存不含私有状态', async ({ page, context }) => {
  const secret = 'PRIVATE_V04_OFFLINE_TITLE';
  await page.goto('/'); await expect(page.locator('.offline-status')).toHaveText('离线已就绪');
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.offline-status')).toHaveText('离线模式');
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await page.locator('#contract-input').fill('退卡扣除30%手续费。');
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await page.locator('#scan-scenario').selectOption('fitness');
  await moduleTab(page, '协商与导出'); await page.locator('#export-title').fill(secret);
  const html = await downloadText(page, /修订合同 · HTML/, '.verification/v04-offline-title.html');
  expect(html).toContain(secret);
  await page.getByRole('button', { name: '导出体检卡（PNG）', exact: true }).click();
  await expect.poll(() => page.locator('.report-preview img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(960);
  const cached = await page.evaluate(async () => {
    const entries: { url: string; text: string }[] = [];
    for (const name of await caches.keys()) { const cache = await caches.open(name); for (const req of await cache.keys()) entries.push({ url: req.url, text: await (await cache.match(req))!.text() }); }
    return entries;
  });
  expect(cached.length).toBeGreaterThanOrEqual(4);
  expect(cached.every(item => /\/(?:index\.html|favicon\.svg|assets\/[^/]+\.(?:js|css))$/.test(item.url))).toBe(true);
  expect(cached.some(item => item.text.includes(secret) || item.url.includes(secret))).toBe(false);
  expect(new URL(page.url()).search).toBe('?module=negotiate');
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await context.setOffline(false);
});

test('Open Graph 分享文案及禁用JavaScript兜底', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /ClauseLens.*条款透视镜/);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /不上传合同.*不构成正式法律意见/);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  try {
    const plain = await context.newPage(); await plain.goto('http://127.0.0.1:4174/');
    await expect(plain.locator('noscript')).toBeVisible();
    await expect(plain.locator('noscript p')).toContainText('需要启用 JavaScript');
    await noOverflow(plain);
  } finally { await context.close(); }
});
