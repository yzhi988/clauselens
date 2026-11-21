import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth)).toBe(true);
}
async function moduleTab(page: Page, name: string) { await page.getByRole('tablist', { name: '产品模块', exact: true }).getByRole('tab', { name, exact: true }).click(); }
async function download(page: Page, name: RegExp, path: string) {
  const ready = page.waitForEvent('download'); await page.getByRole('button', { name }).click();
  const file = await ready; await file.saveAs(path); expect(await file.failure()).toBeNull();
  return readFile(path, 'utf8');
}

test('计算器三场景金额、适用前提、滑块及跨模块默认参数', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '去算算差额 →', exact: true }).click();
  await expect(page).toHaveURL(/module=calculator/);
  await expect(page.locator('#rent-number')).toHaveValue('1800');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥10,260');
  await expect(page.locator('.comparison:visible')).toContainText('¥12,600');
  await page.locator('#rent-number').fill('2000');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥11,200');
  await page.getByRole('slider', { name: '月租金滑块', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#rent-number')).toHaveValue('2050');
  await page.locator('#penalty-basis').selectOption('rent-multiple');
  await expect(page.locator('#rent-multiple-number')).toHaveValue('2');
  await page.locator('#remaining-number').fill('0');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥0');
  await expect(page.locator('.formula-note:visible')).toContainText('不包含欠租');
  await noOverflow(page);
  await page.getByRole('button', { name: '恢复示例', exact: true }).click();
  await page.screenshot({ path: '.verification/calculator-desktop.png', fullPage: true, animations: 'disabled' });

  await page.getByRole('tab', { name: '实习 / 试用期离职', exact: true }).click();
  await expect(page.locator('.difference-block output:visible')).toHaveText('先确认适用前提');
  await page.locator('#relationship').selectOption('labor');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥10,000');
  await page.getByRole('checkbox', { name: /确有符合第22条/ }).check();
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥5,000');
  await page.locator('#service-total-number').fill('0');
  await expect(page.locator('.difference-block output:visible')).toHaveText('先确认适用前提');
  await page.locator('#relationship').selectOption('non-labor');
  await expect(page.locator('.difference-block output:visible')).toHaveText('先确认适用前提');
  await noOverflow(page);

  await page.getByRole('tab', { name: '健身年卡退费', exact: true }).click();
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥2,160');
  await page.locator('#card-fee-number').fill('20');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥432');
  await expect(page.locator('.comparison:visible')).toContainText('¥1,728');
  await page.locator('#card-total-number').fill('1');
  await expect(page.locator('#card-used-number')).toHaveValue('1');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥0');
  await moduleTab(page, '合同 X 光');
  await page.getByRole('tab', { name: '健身年卡', exact: true }).click();
  await page.getByRole('button', { name: '去算算差额 →', exact: true }).click();
  await expect(page.locator('#card-price-number')).toHaveValue('2880');
  await expect(page.locator('#card-fee-number')).toHaveValue('100');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥2,160');
  expect(errors).toEqual([]);
});

test('协商默认勾选、两语气、复制、完整安全下载与状态保留', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?module=negotiate');
  await expect(page.locator('.selection-item input:checked')).toHaveCount(5);
  await expect(page.locator('.redline-clause')).toHaveCount(5);
  await expect(page.locator('#communication-text')).toHaveValue(/房东您好/);
  const gentle = await page.locator('#communication-text').inputValue();
  await page.getByRole('tab', { name: '坚定底线版', exact: true }).click();
  await expect(page.locator('#communication-text')).toHaveValue(/书面修改要求/);
  expect(await page.locator('#communication-text').inputValue()).not.toEqual(gentle);
  await page.getByRole('button', { name: '复制全文', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await page.locator('#communication-text').inputValue());
  await noOverflow(page);
  await page.screenshot({ path: '.verification/negotiation-desktop.png', fullPage: true, animations: 'disabled' });
  const html = await download(page, /修订合同 · HTML/, '.verification/修订对照合同.html');
  const md = await download(page, /协商清单 · Markdown/, '.verification/协商清单.md');
  expect(html).toContain('协商草案 · 未达成合意');
  expect(html.match(/<section class="clause(?: clause-selected)?">/g)).toHaveLength(12);
  expect(html.match(/<del>/g)).toHaveLength(5);
  expect(html).not.toMatch(/<script|<iframe|<img|<link\s|\ssrc=/i);
  expect(md).toContain('坚定底线版');
  const exported = await context.newPage();
  await exported.setContent(html);
  await expect(exported.locator('.clause')).toHaveCount(12);
  await exported.screenshot({ path: '.verification/export-print-preview.png', animations: 'disabled' });
  await exported.pdf({ path: '.verification/修订对照打印检查.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await exported.close();

  await page.locator('.selection-item input').first().uncheck();
  await moduleTab(page, '违约金计算器'); await moduleTab(page, '协商与导出');
  await expect(page.locator('.selection-item input:checked')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: '坚定底线版', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(page.getByRole('button', { name: '复制全文', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /修订合同 · HTML/ })).toBeDisabled();
  await expect(page.locator('#communication-text')).toBeEmpty();
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await expect(page.locator('.selection-item input:checked')).toHaveCount(6);
  await moduleTab(page, '合同 X 光');
  await page.getByRole('tab', { name: '实习协议', exact: true }).click();
  await moduleTab(page, '协商与导出');
  await expect(page.locator('.selection-item input:checked')).toHaveCount(5);
  await expect(page.locator('#communication-text')).toHaveValue(/HR您好/);
});

test('375px 导航、自然行内高亮、全部计算场景与协商导出无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '产品模块', exact: true })).toBeVisible();
  expect(await page.locator('.text-mark').evaluateAll(elements => elements.every(element => element.tagName === 'SPAN' && getComputedStyle(element).display === 'inline'))).toBe(true);
  expect(await page.locator('.text-mark').evaluateAll(elements => elements.some(element => element.getClientRects().length > 1))).toBe(true);
  await page.locator('#mark-clause-3-rental-deposit').focus(); await page.keyboard.press('Space');
  await expect(page.locator('.workspace')).toHaveClass(/mobile-risk/);
  await page.getByRole('button', { name: '去算算差额 →', exact: true }).click();
  await expect(page.locator('#rent-number')).toHaveValue('1800');
  await noOverflow(page);
  await expect(page.locator('.mobile-calculation-summary')).toBeInViewport();
  await page.locator('#vacancy-number').scrollIntoViewIfNeeded();
  await expect(page.locator('.mobile-calculation-summary')).toBeInViewport();
  await page.locator('#vacancy-number').fill('2');
  await expect(page.locator('.mobile-calculation-summary strong')).toHaveText('¥7,920');
  await page.getByRole('button', { name: '恢复示例', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '.verification/calculator-mobile.png', fullPage: true, animations: 'disabled' });
  for (const label of ['实习 / 试用期离职', '健身年卡退费']) {
    await page.getByRole('tab', { name: label, exact: true }).click(); await noOverflow(page);
  }
  await page.getByRole('tab', { name: '实习 / 试用期离职', exact: true }).click();
  await page.locator('#relationship').selectOption('labor');
  await page.getByRole('checkbox', { name: /确有符合第22条/ }).check(); await noOverflow(page);
  await moduleTab(page, '协商与导出'); await noOverflow(page);
  await page.screenshot({ path: '.verification/negotiation-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('tab', { name: '坚定底线版', exact: true }).click(); await noOverflow(page);
});

test('断网刷新三个模块、计算与双格式下载可用且私人数据不持久化', async ({ page, context }) => {
  await page.goto('/?module=calculator');
  await expect(page.locator('.offline-status')).toHaveText('离线已就绪', { timeout: 20000 });
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.offline-status')).toHaveText('离线模式');
  await page.locator('#rent-number').fill('2400');
  await expect(page.locator('.difference-block output:visible')).toHaveText('¥13,080');
  await moduleTab(page, '合同 X 光'); await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  const privateText = 'PRIVATE_V02_SENTINEL 第一条 押金\n房东可以任意扣除押金，无需提供凭证。';
  await page.getByLabel('粘贴合同正文', { exact: true }).fill(privateText);
  await moduleTab(page, '协商与导出');
  await expect(page.locator('.selection-item input:checked')).toHaveCount(1);
  const html = await download(page, /修订合同 · HTML/, '.verification/offline-contract.html');
  const md = await download(page, /协商清单 · Markdown/, '.verification/offline-negotiation.md');
  expect(html).toContain('PRIVATE_V02_SENTINEL'); expect(md).toContain('协商清单');
  expect(await page.evaluate(async () => {
    const stored = { local: localStorage.length, session: sessionStorage.length, databases: await indexedDB.databases(), leaked: false };
    for (const name of await caches.keys()) { const cache = await caches.open(name); for (const request of await cache.keys()) {
      if ((await (await cache.match(request))!.text()).includes('PRIVATE_V02_SENTINEL') || request.url.includes('PRIVATE_V02_SENTINEL')) stored.leaked = true;
    } }
    return stored;
  })).toEqual({ local: 0, session: 0, databases: [], leaked: false });
  expect(new URL(page.url()).search).toBe('?module=negotiate');
  await page.reload();
  await expect(page.locator('.current-contract')).toContainText('高校周边');
  await moduleTab(page, '合同 X 光'); await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await expect(page.getByLabel('粘贴合同正文', { exact: true })).toBeEmpty();
  await context.setOffline(false);
});

test('用户HTML及Markdown注入在原文、修订与下载中保持文本', async ({ page, context }) => {
  await page.goto('/'); await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  const malicious = '第一条 押金\n房东可以任意扣除押金，无需提供凭证。<script>window.__injected=true</script><img src="https://invalid.example/x" onerror="window.__injected=true">![图片](https://invalid.example/pixel)\n\n第二条 签署\n双方确认各执一份。';
  await page.getByLabel('粘贴合同正文', { exact: true }).fill(malicious); await moduleTab(page, '协商与导出');
  await expect(page.locator('.redline-original del')).toContainText('<script>');
  const html = await download(page, /修订合同 · HTML/, '.verification/escaped-contract.html');
  const md = await download(page, /协商清单 · Markdown/, '.verification/escaped-negotiation.md');
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(md).not.toContain('![图片](');
  const exported = await context.newPage(); const externalRequests: string[] = [];
  exported.on('request', request => { if (request.url().startsWith('http')) externalRequests.push(request.url()); });
  await exported.setContent(html); expect(await exported.evaluate(() => '__injected' in window)).toBe(false);
  await expect(exported.locator('.clause')).toHaveCount(2); expect(externalRequests).toEqual([]); await exported.close();
  expect(await page.evaluate(() => '__injected' in window)).toBe(false);
  const requests = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});
