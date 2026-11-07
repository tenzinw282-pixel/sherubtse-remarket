const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const session = require('express-session');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createApp } = require('../app');

test('marketplace: responsive layouts, keyboard focus and WCAG scans', { timeout: 180000 }, async () => {
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const productId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const secret = 'isolated-browser-fixture-secret-not-used-in-production';
  const store = new session.MemoryStore();
  let mockRole='student';
  const pool = { query: async sql => {
    if(sql.includes('clock_timestamp()'))return {rows:[{now:new Date()}]};
    if (sql.includes('FROM users')) return { rows: [{ id: userId, full_name: 'Test student', email:'student@example.test',role: mockRole, email_verified_at: new Date() }] };
    if (sql.includes('FROM categories')) return { rows: [{ id: 1, name: 'Textbooks' }] };
    if (sql.includes('FROM products')) return { rows: [{ id: productId, seller_id:userId,moderation_status:'approved',status:'available',selling_type:'fixed',title: 'Test textbook', price: '100.00', condition: 'Good', description: 'A synthetic listing used only inside the browser test fixture.', seller_name: 'Test student' }] };
    return { rows: [], rowCount: 0 };
  } };
  const emptyQuery=()=>({sort(){return this;},limit(){return this;},lean:async()=>[]});
  const communityModels={Conversation:{find:emptyQuery},Notification:{find:emptyQuery,countDocuments:async()=>0},Message:{find:emptyQuery}};
  const { app } = createApp({ config: { NODE_ENV: 'test', SESSION_SECRET: secret }, pool, mongo: {}, sessionStore: store,communityModels,
    services: { mail: {}, images: {} } });
  const server = http.createServer(app);
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'), headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/api/notifications/unread',route=>route.fulfill({json:{count:0}}));
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.name));
    const output = path.join(__dirname, '../artifacts/design-system');
    await fs.mkdir(output, { recursive: true });
    async function check(route, width) {
      await page.setViewportSize({ width, height: 950 });
      const response = await page.goto(origin + route);
      assert.ok([200, 404].includes(response.status()), `${route}: expected rendered page`);
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#main-content').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route} overflows at ${width}px`);
      assert.ok(await page.evaluate(() => document.fonts.check('16px Inter')), 'Inter loads locally');
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], `${route} accessibility at ${width}px`);
    }
    await page.goto(origin+'/login');
    const password=page.locator('#password');
    await password.fill('fixture-only-password');
    await page.getByRole('button',{name:'Show password',exact:true}).click();
    assert.equal(await password.getAttribute('type'),'text');
    assert.equal(await page.getByRole('button',{name:'Hide password',exact:true}).getAttribute('aria-pressed'),'true');
    assert.ok(await password.evaluate(input=>input.value==='fixture-only-password'));
    await page.getByRole('button',{name:'Hide password',exact:true}).press('Space');
    assert.equal(await password.getAttribute('type'),'password');
    assert.equal(await page.locator('.nav-links a[aria-current="page"]').getAttribute('href'),'/login');
    assert.equal(await page.locator('#main-content').evaluate(element=>getComputedStyle(element).animationName),'page-enter');
    await page.goto(origin+'/register');
    await page.getByRole('button',{name:'Show confirm password',exact:true}).click();
    assert.equal(await page.locator('#confirmPassword').getAttribute('type'),'text');
    assert.equal(await page.locator('#password').getAttribute('type'),'password');
    await page.getByRole('button',{name:'Hide confirm password',exact:true}).click();
    for (const width of [320, 375, 768, 1024, 1440]) {
      for (const route of ['/', '/marketplace','/auctions','/register', '/login', '/terms', '/missing',`/users/${userId}`]) await check(route, width);
      await page.goto(origin + '/');
      if (width === 375 || width === 1440) await page.screenshot({ path: path.join(output, `home-${width}.png`), fullPage: true });
    }
    await page.goto(origin + '/login');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Skip to content');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.btn-primary').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.equal(await page.locator('#main-content').evaluate(element=>getComputedStyle(element).animationName),'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 640, height: 450 });
    await page.goto(origin + '/register');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Registration reflows with 200% root text size');
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    const sid = 'isolated-ui-test-session';
    await new Promise((resolve, reject) => store.set(sid, { cookie: { maxAge: 3600000 }, userId, pendingUserId: userId }, error => error ? reject(error) : resolve()));
    const signature = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
    await context.addCookies([{ name: 'remarket.sid', value: encodeURIComponent(`s:${sid}.${signature}`), url: origin }]);
    for (const width of [320, 375, 768, 1024, 1440]) {
      for (const route of ['/sell', '/verify-email', `/products/${productId}`,'/dashboard','/dashboard/listings','/profile','/messages','/notifications','/dashboard/purchases','/dashboard/sales','/dashboard/bids','/dashboard/won-auctions','/dashboard/favorites']) await check(route, width);
    }
    mockRole='admin';
    await page.goto(origin+'/dashboard/listings');
    assert.equal(await page.locator('.workspace-nav a[aria-current="page"]').getAttribute('href'),'/dashboard/listings');
    await page.goto(origin+'/admin/users');
    assert.equal(await page.locator('.admin-sidebar a[aria-current="page"]').getAttribute('href'),'/admin/users');
    for(const width of [320,375,768,1024,1440])for(const route of ['/admin','/admin/users','/admin/approvals','/admin/products','/admin/categories','/admin/announcements'])await check(route,width);
    assert.deepEqual(pageErrors, [], 'No browser JavaScript errors');
    await context.close();
    console.log('Checked 135 page/viewport combinations, keyboard focus, reduced motion and 200% text reflow; screenshots saved in artifacts/design-system.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
