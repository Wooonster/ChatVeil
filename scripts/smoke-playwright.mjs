import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const bundlePath = new URL('../dist/userscript/chatveil.user.js', import.meta.url);
const script = await readFile(bundlePath, 'utf8');

const defaultSettings = {
  version: 1,
  enabledHosts: {},
  customHosts: [],
  maskStyle: 'skeleton',
  customMaskChar: '*',
  showAllUntilByHost: {},
  unlockedKeysByHost: {},
  syncEnabled: false,
};

const html = `<!doctype html>
<html>
  <body>
    <nav>
      <li><a href="/c/current"><span>Current title</span></a></li>
      <li>
        <a href="/c/old"><span>Private research notes</span></a>
        <button type="button" aria-haspopup="menu">More</button>
      </li>
    </nav>
  </body>
</html>`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function loadScenario(page, settings = defaultSettings) {
  await page.addInitScript((initialSettings) => {
    const store = {
      chatVeilSettings: initialSettings,
    };
    window.GM_getValue = (key, defaultValue) => (Object.hasOwn(store, key) ? store[key] : defaultValue);
    window.GM_setValue = (key, value) => {
      store[key] = value;
    };
    window.GM_registerMenuCommand = (_name, callback) => {
      window.__chatveilMenuCallback = callback;
    };
  }, settings);
  await page.route('https://chatgpt.com/c/current', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: html,
    }),
  );
  await page.goto('https://chatgpt.com/c/current');
  await page.addScriptTag({ content: script });
  await page.waitForSelector('[data-chatveil-title="true"]');
}

async function titleStates(page) {
  return page.$$eval('[data-chatveil-title="true"]', (elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      const afterStyle = getComputedStyle(element, '::after');
      return {
        text: element.textContent?.trim(),
        state: element.dataset.chatveilState,
        styleMode: element.dataset.chatveilStyle,
        maskText: element.dataset.chatveilMaskText,
        color: style.color,
        webkitTextFillColor: style.webkitTextFillColor,
        afterColor: afterStyle.color,
        afterContent: afterStyle.content,
      };
    }),
  );
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await loadScenario(page);
  let states = await titleStates(page);
  const current = states.find((state) => state.text === 'Current title');
  const old = states.find((state) => state.text === 'Private research notes');
  assert(current?.state === 'visible', 'Current title should remain visible.');
  assert(old?.state === 'masked', 'Non-current title should be masked.');
  assert(old.color === 'rgba(0, 0, 0, 0)' || old.webkitTextFillColor === 'rgba(0, 0, 0, 0)', 'Masked text should be visually transparent.');

  await page.locator('text=Private research notes').hover();
  await page.waitForFunction(() => {
    const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
      (element) => element.textContent?.trim() === 'Private research notes',
    );
    return target?.dataset.chatveilState === 'visible';
  });
  await page.mouse.move(500, 500);
  await page.waitForFunction(() => {
    const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
      (element) => element.textContent?.trim() === 'Private research notes',
    );
    return target?.dataset.chatveilState === 'masked';
  });
  await page.locator('button[aria-haspopup="menu"]').dispatchEvent('pointerdown');
  await page.evaluate(() => {
	    const menu = document.createElement('div');
	    menu.setAttribute('role', 'menu');
	    menu.style.cssText = 'position:absolute;top:80px;left:260px;width:220px;padding:8px;background:white;box-shadow:0 8px 30px rgba(0,0,0,.16);';
	    menu.innerHTML = `
      <button role="menuitem">Share</button>
      <button role="menuitem">Rename</button>
      <button role="menuitem">Pin chat</button>
      <button role="menuitem">Archive</button>
      <button role="menuitem">Delete</button>
    `;
    document.body.append(menu);
  });
  await page.waitForSelector('[data-chatveil-menu-action="true"]');
  await page.locator('[data-chatveil-menu-action="true"]').click();
  await page.waitForFunction(() => {
    const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
      (element) => element.textContent?.trim() === 'Private research notes',
    );
    return target?.dataset.chatveilState === 'visible';
  });

  const characterPage = await browser.newPage();
  await loadScenario(characterPage, {
    ...defaultSettings,
    maskStyle: 'characters',
    customMaskChar: '#',
  });
  states = await titleStates(characterPage);
  const characterMasked = states.find((state) => state.text === 'Private research notes');
  assert(characterMasked?.styleMode === 'characters', 'Character mask mode should apply.');
  assert(characterMasked?.maskText?.startsWith('#'), 'Character mask text should use the configured character.');
  assert(characterMasked?.afterContent?.includes('#'), 'Character mask pseudo-element should render configured characters.');
  assert(characterMasked?.afterColor !== 'rgba(0, 0, 0, 0)', 'Character mask pseudo-element should be visible.');

  console.log('Playwright smoke passed: masking, current title, hover reveal, menu pin, and character mode.');
} finally {
  await browser.close();
}
