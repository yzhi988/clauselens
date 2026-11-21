import { expect, test, type Page } from '@playwright/test';

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
}

async function expectLocalOnly(page: Page) {
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  expect(urls.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
}

test('桌面默认结果、样本切换、双向定位、筛选、复制及隐私说明', async ({ page, context }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('.clause')).toHaveCount(12);
  await expect(page.locator('.risk-card')).toHaveCount(6);
  await expect(page.locator('.count-number')).toHaveText(['3', '2', '1']);
  await expect(page.locator('.risk-card.expanded')).toHaveAttribute('id', 'risk-clause-3-rental-deposit');
  // First visit exposes a real red term immediately, without an onboarding step.
  await expect(page.locator('#mark-clause-3-rental-deposit')).toBeInViewport();
  await expectNoOverflow(page);
  await page.screenshot({ path: '.verification/desktop.png', fullPage: true, animations: 'disabled' });

  await page.locator('#mark-clause-4-rental-penalty').click();
  await expect(page.locator('#risk-clause-4-rental-penalty')).toHaveClass(/expanded/);
  await expect(page.locator('#risk-clause-4-rental-penalty .risk-card-toggle')).toBeInViewport();
  await page.locator('#risk-clause-7-rental-wear .risk-card-toggle').click();
  await expect(page.locator('#mark-clause-7-rental-wear')).toBeFocused();
  await expect(page.locator('#mark-clause-7-rental-wear')).toBeInViewport();
  await page.getByRole('button', { name: '筛选高危，3处' }).click();
  await expect(page.locator('.risk-card')).toHaveCount(3);
  await page.locator('#mark-clause-5-rental-increase').click();
  await expect(page.locator('.risk-card')).toHaveCount(6);
  await expect(page.locator('#risk-clause-5-rental-increase')).toHaveClass(/expanded/);
  await page.getByRole('button', { name: '复制沟通话术', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制，可以去沟通了' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('本租期内不单方调价');

  for (const label of ['实习协议', '健身年卡', '租房合同']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.clause')).toHaveCount(12);
    await expect(page.locator('.risk-card')).toHaveCount(6);
    await expect(page.locator('.count-number')).toHaveText(['3', '2', '1']);
    if (label === '实习协议') await expect(page.locator('.internship-boundary')).toContainText('不当然构成劳动关系');
  }
  await page.locator('#mark-clause-6-rental-eviction').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#risk-clause-6-rental-eviction')).toHaveClass(/expanded/);
  await page.getByRole('button', { name: '隐私优先', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('合同内容不会发送');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expectLocalOnly(page);
  expect(runtimeErrors).toEqual([]);
});

test('375px 无横向溢出、原文与风险联动、粘贴、txt导入和错误反馈', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expectNoOverflow(page);
  await expect(page.locator('#mark-clause-3-rental-deposit')).toBeInViewport();
  await page.screenshot({ path: '.verification/mobile-original.png', fullPage: true, animations: 'disabled' });
  await page.locator('#mark-clause-3-rental-deposit').click();
  await expect(page.locator('.workspace')).toHaveClass(/mobile-risk/);
  await expect(page.locator('#risk-clause-3-rental-deposit')).toHaveClass(/expanded/);
  await expectNoOverflow(page);
  await page.screenshot({ path: '.verification/mobile-risk.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '定位原文', exact: true }).click();
  await expect(page.locator('.workspace')).toHaveClass(/mobile-document/);
  await expect(page.locator('#mark-clause-3-rental-deposit')).toBeInViewport();

  for (const label of ['实习协议', '健身年卡']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expectNoOverflow(page);
    await page.getByRole('button', { name: '风险解读 6' }).click();
    await expectNoOverflow(page);
  }
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  const input = page.getByLabel('粘贴合同正文', { exact: true });
  await input.fill('个人租房协议\n\n第一条 押金\n房东可以任意扣除押金，无需提供凭证。');
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await expect(page.locator('.count-number')).toHaveText(['1', '0', '0']);
  await expectNoOverflow(page);
  await input.fill('<img src=x onerror="window.__unsafe=true">房屋租赁合同。正常损耗无需承租人赔偿。');
  await expect(page.locator('.risk-card')).toHaveCount(0);
  expect(await page.evaluate(() => '__unsafe' in window)).toBe(false);
  await page.getByRole('button', { name: '风险解读 0' }).click();
  await expect(page.locator('.risk-summary')).toContainText('未命中不代表合同安全');

  await page.locator('input[type=file]').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('健身会员年卡协议\n\n第一条 退费\n本卡任何理由概不退费、不得转让。') });
  await expect(page.locator('.file-status')).toContainText('已在本地读取');
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await expect(input).toHaveValue(/健身会员/);
  await page.locator('input[type=file]').setInputFiles({ name: 'wrong.pdf', mimeType: 'application/pdf', buffer: Buffer.from('text') });
  await expect(page.locator('#input-error')).toContainText(/\.txt.*\.docx/);
  await expect(input).toHaveValue(/健身会员/);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(input).toBeEmpty();
  await expect(page.locator('.risk-card')).toHaveCount(0);
  await expectNoOverflow(page);
  await expectLocalOnly(page);
});

test('缓存完成后断网刷新，三样本与本地扫描完整可用且不持久化个人内容', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.offline-status')).toHaveText('离线已就绪', { timeout: 20_000 });
  const personal = 'PERSONAL_PRIVATE_SENTINEL 房屋租赁合同：押金可以任意扣除。';
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await page.getByLabel('粘贴合同正文', { exact: true }).fill(personal);
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.offline-status')).toHaveText('离线模式');
  await expect(page.locator('.clause')).toHaveCount(12);
  await expect(page.locator('.risk-card')).toHaveCount(6);
  for (const label of ['实习协议', '健身年卡', '租房合同']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.risk-card')).toHaveCount(6);
  }
  await page.getByRole('tab', { name: '粘贴我的合同' }).click();
  await expect(page.getByLabel('粘贴合同正文', { exact: true })).toBeEmpty();
  await page.getByLabel('粘贴合同正文', { exact: true }).fill('实习协议：甲方有权任意扣减实习补贴。');
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await page.locator('input[type=file]').setInputFiles({ name: 'offline.txt', mimeType: 'text/plain', buffer: Buffer.from('健身年卡：最终解释权归甲方所有。') });
  await expect(page.locator('.risk-card')).toHaveCount(1);
  await expect(page.locator('.count-number')).toHaveText(['0', '0', '1']);
  const cached = await page.evaluate(async () => {
    const entries: { url: string; body: string }[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) entries.push({ url: request.url, body: await (await cache.match(request))!.text() });
    }
    return entries;
  });
  expect(cached.length).toBeGreaterThanOrEqual(4);
  expect(cached.every(entry => /\/(?:index\.html|favicon\.svg|assets\/[^/]+\.(?:js|css))$/.test(entry.url))).toBe(true);
  expect(cached.every(entry => !entry.body.includes(personal) && !entry.url.includes('PERSONAL'))).toBe(true);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await expectLocalOnly(page);
  await context.setOffline(false);
});
