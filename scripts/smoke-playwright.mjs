import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const bundlePath = new URL('../dist/userscript/chatveil.user.js', import.meta.url);
const script = await readFile(bundlePath, 'utf8');

const defaultSettings = {
  version: 1,
  enabledHosts: {},
  customHosts: [],
  maskStyle: 'dissolve',
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
      const particleLayer = element.querySelector('[data-chatveil-particle-layer="true"]');
      return {
        text: element.textContent?.trim(),
        state: element.dataset.chatveilState,
        styleMode: element.dataset.chatveilStyle,
        transition: element.dataset.chatveilTransition,
        maskText: element.dataset.chatveilMaskText,
        color: style.color,
        webkitTextFillColor: style.webkitTextFillColor,
        afterColor: afterStyle.color,
        afterContent: afterStyle.content,
        afterOpacity: afterStyle.opacity,
        afterBackgroundColor: afterStyle.backgroundColor,
        afterBackgroundImage: afterStyle.backgroundImage,
        hasParticleLayer: Boolean(particleLayer),
        particleDisplay: particleLayer ? getComputedStyle(particleLayer).display : '',
        particleCount: particleLayer?.querySelectorAll('circle').length ?? 0,
        particleRingCount: particleLayer?.querySelectorAll('circle[fill="none"]').length ?? 0,
        particleNodeCount: particleLayer?.querySelectorAll('circle, rect, line').length ?? 0,
        particleRectCount: particleLayer?.querySelectorAll('rect').length ?? 0,
        particleLineCount: particleLayer?.querySelectorAll('line').length ?? 0,
        particlePathCount: particleLayer?.querySelectorAll('path').length ?? 0,
        particleGroupCount: particleLayer?.querySelectorAll('g').length ?? 0,
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
  assert(old?.styleMode === 'dissolve', 'Default mask style should be dissolve.');
  assert(old.color === 'rgba(0, 0, 0, 0)' || old.webkitTextFillColor === 'rgba(0, 0, 0, 0)', 'Masked text should be visually transparent.');
  assert(old.hasParticleLayer, 'Dissolve mask should render the SVG particle layer.');
  assert(old.particleDisplay !== 'none', 'Dissolve particle layer should be visible while masked.');
  assert(old.particleNodeCount >= 80, 'Dissolve particle layer should contain a thin but substantial particle cloud.');

  await page.locator('text=Private research notes').hover();
  await page.waitForFunction(() => {
    const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
      (element) => element.textContent?.trim() === 'Private research notes',
    );
    return target?.dataset.chatveilTransition === 'revealing' && target?.dataset.chatveilState === 'masked';
  });
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
    return target?.dataset.chatveilTransition === 'remasking' && target?.dataset.chatveilState === 'visible';
  });
  await page.waitForFunction(() => {
    const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
      (element) => element.textContent?.trim() === 'Private research notes',
    );
    return target?.dataset.chatveilState === 'masked';
  });
  await page.evaluate(() => {
    window.__chatveilMenuCallback?.();
  });
  for (const style of ['constellation', 'ripple', 'ember']) {
    await page.selectOption('#chatveil-userscript-panel select[name="style"]', style);
    await page.waitForFunction(
      (expectedStyle) => {
        const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
          (element) => element.textContent?.trim() === 'Private research notes',
        );
        const particleLayer = target?.querySelector('[data-chatveil-particle-layer="true"]');
        if (target?.dataset.chatveilStyle !== expectedStyle || !particleLayer || getComputedStyle(particleLayer).display === 'none') return false;
        if (expectedStyle === 'constellation') {
          return particleLayer.querySelectorAll('path').length >= 10 && particleLayer.querySelectorAll('g').length >= 3;
        }
        if (expectedStyle === 'ripple') return particleLayer.querySelectorAll('rect').length >= 50;
        if (expectedStyle === 'ember') {
          return (
            particleLayer.querySelectorAll('circle').length >= 60 &&
            particleLayer.querySelectorAll('circle[fill="none"]').length >= 25 &&
            particleLayer.querySelectorAll('rect').length === 0 &&
            particleLayer.querySelectorAll('line').length === 0
          );
        }
        return true;
      },
      style,
    );
    const [dynamicState] = (await titleStates(page)).filter((state) => state.text === 'Private research notes');
    assert((dynamicState?.particleNodeCount ?? 0) + (dynamicState?.particlePathCount ?? 0) >= 40, `${style} mask should render a substantial dynamic SVG layer.`);
    if (style === 'constellation') {
      assert(dynamicState.particlePathCount >= 10, 'Constellation mask should include curved connector paths.');
      assert(dynamicState.particleGroupCount >= 3, 'Constellation mask should include star glyph nodes.');
    }
    if (style === 'ripple') assert(dynamicState.particleRectCount >= 50, 'Ripple mask should include dash particles.');
    if (style === 'ember') {
      assert(dynamicState.particleCount >= 60, 'Ember mask should include a soft circular particle field.');
      assert(dynamicState.particleRingCount >= 25, 'Ember mask should include breathing ring particles.');
      assert(dynamicState.particleRectCount === 0, 'Ember mask should not render rectangular particles.');
      assert(dynamicState.particleLineCount === 0, 'Ember mask should not render line particles.');
    }
  }
  await page.selectOption('#chatveil-userscript-panel select[name="style"]', 'skeleton');
  await page.waitForFunction(() => {
    const target = Array.from(document.querySelectorAll('[data-chatveil-title="true"]')).find(
      (element) => element.textContent?.trim() === 'Private research notes',
    );
    return target?.dataset.chatveilStyle === 'skeleton';
  });
  await page.locator('button[aria-haspopup="menu"]').dispatchEvent('pointerdown');
  await page.evaluate(() => {
	    const menu = document.createElement('div');
	    menu.setAttribute('role', 'menu');
	    menu.style.cssText = 'position:absolute;top:80px;left:260px;width:220px;padding:8px;background:white;box-shadow:0 8px 30px rgba(0,0,0,.16);';
	    menu.innerHTML = `
      <style>
        [role="menu"] button[role="menuitem"]:not([data-chatveil-menu-action]) {
          box-sizing: border-box; display: flex; align-items: center; gap: 9px;
          width: 100%; height: 38px; padding: 6px 14px; border: 0; border-radius: 8px;
          font: 500 13px/20px Arial, sans-serif; color: rgb(42, 43, 44); background: transparent;
        }
        [role="menu"] .native-icon { width: 18px; height: 18px; flex: none; }
      </style>
      <div role="group"><button role="menuitem"><svg class="native-icon" viewBox="0 0 24 24"><path d="M4 4h12v12H4z"/></svg><span>Rename</span></button><button role="menuitem">Unpin</button><button role="menuitem">Lock chat</button></div>
      <hr><div role="group"><button role="menuitem">Share</button></div>
      <hr><div role="group"><button role="menuitem">Archive</button><button role="menuitem">Delete</button></div>
      <hr><button role="menuitem">Move to project</button>
    `;
    document.body.append(menu);
  });
  await page.waitForSelector('[data-chatveil-menu-action="true"]');
  assert(await page.locator('[data-chatveil-menu-action="true"] + [role="menuitem"]').textContent() === 'Unpin', 'Title action should appear next to Unpin in the grouped menu.');
  const alignment = await page.evaluate(() => {
    const action = document.querySelector('[data-chatveil-menu-action="true"]');
    const native = Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent?.trim() === 'Rename');
    const customLabel = action?.querySelector('span:last-child');
    const nativeLabel = native?.querySelector('span');
    const customIcon = action?.querySelector('svg');
    const nativeIcon = native?.querySelector('svg');
    if (!action || !native || !customLabel || !nativeLabel || !customIcon || !nativeIcon) return null;
    return {
      labelOffset: customLabel.getBoundingClientRect().left - nativeLabel.getBoundingClientRect().left,
      iconOffset: customIcon.getBoundingClientRect().left - nativeIcon.getBoundingClientRect().left,
      fontSize: getComputedStyle(customLabel).fontSize,
      nativeFontSize: getComputedStyle(nativeLabel).fontSize,
      iconSize: customIcon.getBoundingClientRect().width,
      nativeIconSize: nativeIcon.getBoundingClientRect().width,
      height: action.getBoundingClientRect().height,
      nativeHeight: native.getBoundingClientRect().height,
    };
  });
  assert(alignment && Math.abs(alignment.labelOffset) <= 1 && Math.abs(alignment.iconOffset) <= 1, 'Menu label and icon should align with the native item.');
  assert(alignment.fontSize === alignment.nativeFontSize && alignment.iconSize === alignment.nativeIconSize && Math.abs(alignment.height - alignment.nativeHeight) <= 1, 'Menu typography, icon size, and height should match the native item.');
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

  console.log('Playwright smoke passed: dissolve default, dynamic styles, hover reveal, userscript style switch, menu pin, and character mode.');
} finally {
  await browser.close();
}
