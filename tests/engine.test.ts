import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatGptAdapter,
  claudeAdapter,
  genericSidebarAdapter,
  minimaxAdapter,
  qwenAdapter,
} from '../src/core/adapters';
import { MaskEngine, createMemoryStorage } from '../src/core/engine';
import { normalizeSettings } from '../src/core/settings';

function click(element: HTMLElement, detail: number): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
}

function setRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  element.getBoundingClientRect = () =>
    ({
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      right: rect.right ?? 0,
      bottom: rect.bottom ?? 0,
      width: rect.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)),
      height: rect.height ?? Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0)),
      toJSON: () => ({}),
    }) as DOMRect;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('mask engine', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.stubGlobal('crypto', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('masks non-current titles without rewriting text and reveals the current conversation', async () => {
    document.body.innerHTML = `
      <nav>
        <a href="https://chatgpt.com/c/current"><span>Current title</span></a>
        <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chatgpt.com/c/current') as unknown as Location,
      storage,
      adapters: [chatGptAdapter],
    });

    await engine.start();

    const titles = Array.from(document.querySelectorAll<HTMLElement>('[data-chatveil-title="true"]'));
    expect(titles).toHaveLength(2);
    expect(titles[0].dataset.chatveilState).toBe('visible');
    expect(titles[1].dataset.chatveilState).toBe('masked');
    expect(titles[1].textContent).toBe('Private research notes');
  });

  it('accepts multi-character masks capped at 120 characters', async () => {
    document.body.innerHTML = `
      <nav>
        <a href="https://chatgpt.com/c/old"><span>${'Private research notes '.repeat(6)}</span></a>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings({ customMaskChar: 'ab'.repeat(70), maskStyle: 'characters' }));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chatgpt.com/c/current') as unknown as Location,
      storage,
      adapters: [chatGptAdapter],
    });

    await engine.start();
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilMaskText).toHaveLength(120);
    expect(title.dataset.chatveilMaskText?.startsWith('abab')).toBe(true);
    expect(storage.current().customMaskChar).toHaveLength(120);
  });

  it('reveals with a dissolve transition and remasks after the pointer leaves', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <nav>
          <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
        </nav>
      `;
      let scans = 0;
      const adapter = {
        ...chatGptAdapter,
        findHistoryItems(root: ParentNode) {
          scans += 1;
          return chatGptAdapter.findHistoryItems(root);
        },
      };
      const storage = createMemoryStorage(normalizeSettings(undefined));
      const engine = new MaskEngine({
        root: document,
        location: new URL('https://chatgpt.com/c/current') as unknown as Location,
        storage,
        adapters: [adapter],
      });

      await engine.start();
      const row = document.querySelector<HTMLElement>('a')!;
      const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
      expect(title.dataset.chatveilStyle).toBe('dissolve');
      expect(title.dataset.chatveilState).toBe('masked');
      expect(scans).toBe(1);

      row.dispatchEvent(new Event('pointerenter', { bubbles: true }));
      expect(title.dataset.chatveilState).toBe('masked');
      expect(title.dataset.chatveilTransition).toBe('revealing');
      expect(scans).toBe(1);

      await vi.advanceTimersByTimeAsync(720);
      expect(title.dataset.chatveilState).toBe('visible');
      expect(title.dataset.chatveilTransition).toBeUndefined();

      row.dispatchEvent(new Event('pointerleave', { bubbles: true }));
      expect(title.dataset.chatveilState).toBe('visible');
      expect(title.dataset.chatveilTransition).toBe('remasking');
      expect(scans).toBe(1);

      await vi.advanceTimersByTimeAsync(519);
      expect(title.dataset.chatveilState).toBe('visible');
      expect(title.dataset.chatveilTransition).toBe('remasking');

      await vi.advanceTimersByTimeAsync(1);
      expect(title.dataset.chatveilState).toBe('masked');
      expect(title.dataset.chatveilTransition).toBeUndefined();
      expect(scans).toBe(1);

      row.dispatchEvent(new Event('pointerenter', { bubbles: true }));
      row.dispatchEvent(new Event('pointerleave', { bubbles: true }));
      expect(title.dataset.chatveilState).toBe('masked');
      expect(title.dataset.chatveilTransition).toBe('remasking');
      row.dispatchEvent(new Event('pointerenter', { bubbles: true }));
      expect(title.dataset.chatveilState).toBe('masked');
      expect(title.dataset.chatveilTransition).toBe('revealing');
      await vi.advanceTimersByTimeAsync(720);
      expect(title.dataset.chatveilState).toBe('visible');
      expect(title.dataset.chatveilTransition).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let stale dissolve timers hide an unlocked title', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <nav>
          <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
        </nav>
      `;
      const storage = createMemoryStorage(normalizeSettings(undefined));
      const engine = new MaskEngine({
        root: document,
        location: new URL('https://chatgpt.com/c/current') as unknown as Location,
        storage,
        adapters: [chatGptAdapter],
      });

      await engine.start();
      const row = document.querySelector<HTMLElement>('a')!;
      const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
      row.dispatchEvent(new Event('pointerenter', { bubbles: true }));
      row.dispatchEvent(new Event('pointerleave', { bubbles: true }));
      expect(title.dataset.chatveilTransition).toBe('remasking');

      click(row, 3);
      await flushPromises();
      expect(title.dataset.chatveilState).toBe('visible');
      expect(title.dataset.chatveilTransition).toBeUndefined();

      await vi.advanceTimersByTimeAsync(600);
      expect(title.dataset.chatveilState).toBe('visible');
      expect(storage.current().unlockedKeysByHost['chatgpt.com']).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not remask current or show-all titles after hover ends', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <nav>
          <a href="https://chatgpt.com/c/current"><span>Current title</span></a>
          <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
        </nav>
      `;
      let now = 10_000;
      const storage = createMemoryStorage(
        normalizeSettings({
          showAllUntilByHost: {
            'chatgpt.com': now + 10_000,
          },
        }),
      );
      const engine = new MaskEngine({
        root: document,
        location: new URL('https://chatgpt.com/c/current') as unknown as Location,
        storage,
        adapters: [chatGptAdapter],
        clock: () => now,
      });

      await engine.start();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('a'));
      const titles = Array.from(document.querySelectorAll<HTMLElement>('[data-chatveil-title="true"]'));
      expect(titles.map((title) => title.dataset.chatveilState)).toEqual(['visible', 'visible']);

      for (const row of rows) {
        row.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        row.dispatchEvent(new Event('pointerleave', { bubbles: true }));
      }
      await vi.advanceTimersByTimeAsync(600);
      now += 1;
      expect(titles.map((title) => title.dataset.chatveilState)).toEqual(['visible', 'visible']);
      expect(titles.every((title) => title.dataset.chatveilTransition === undefined)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores hover-only class churn on already-bound rows', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <nav>
          <a class="group" href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
        </nav>
      `;
      let scans = 0;
      const adapter = {
        ...chatGptAdapter,
        findHistoryItems(root: ParentNode) {
          scans += 1;
          return chatGptAdapter.findHistoryItems(root);
        },
      };
      const storage = createMemoryStorage(normalizeSettings(undefined));
      const engine = new MaskEngine({
        root: document,
        location: new URL('https://chatgpt.com/c/current') as unknown as Location,
        storage,
        adapters: [adapter],
      });

      await engine.start();
      const row = document.querySelector<HTMLElement>('a')!;
      expect(scans).toBe(1);

      row.className = 'group is-hovered';
      await flushPromises();
      await vi.advanceTimersByTimeAsync(80);
      expect(scans).toBe(1);

      row.className = 'group active';
      await flushPromises();
      await vi.advanceTimersByTimeAsync(80);
      await flushPromises();
      expect(scans).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('triple-click toggles permanent unlock storage for the current host', async () => {
    document.body.innerHTML = `
      <nav>
        <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings({ maskStyle: 'skeleton' }));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chatgpt.com/c/current') as unknown as Location,
      storage,
      adapters: [chatGptAdapter],
    });

    await engine.start();
    const row = document.querySelector<HTMLElement>('a')!;
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilState).toBe('masked');

    click(row, 3);
    await flushPromises();
    expect(title.dataset.chatveilState).toBe('visible');
    expect(storage.current().unlockedKeysByHost['chatgpt.com']).toHaveLength(1);

    click(row, 3);
    await flushPromises();
    expect(title.dataset.chatveilState).toBe('masked');
    expect(storage.current().unlockedKeysByHost['chatgpt.com']).toHaveLength(0);
  });

  it('adds a menu action that pins the title unmasked', async () => {
    document.body.innerHTML = `
      <nav>
        <li>
          <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
          <button type="button" aria-haspopup="menu">More</button>
        </li>
      </nav>
    `;
    let now = 1_000;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chatgpt.com/c/current') as unknown as Location,
      storage,
      adapters: [chatGptAdapter],
      clock: () => now,
    });

    await engine.start();
    const menuTrigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilState).toBe('masked');

    menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button role="menuitem">Share</button>
      <button role="menuitem">Rename</button>
      <button role="menuitem">Pin chat</button>
      <button role="menuitem">Archive</button>
      <button role="menuitem">Delete</button>
    `;
    document.body.append(menu);
    await engine.refresh();
    await engine.refresh();

    const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-chatveil-menu-action="true"]'));
    expect(actions).toHaveLength(1);
    const action = actions[0];
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.querySelector('svg')).not.toBeNull();
    expect(action.nextElementSibling?.textContent).toBe('Pin chat');

    now += 6_000;
    await engine.refresh();
    const stableActions = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-chatveil-menu-action="true"]'));
    expect(stableActions).toHaveLength(1);
    expect(stableActions[0].nextElementSibling?.textContent).toBe('Pin chat');

    action.click();
    await flushPromises();
    expect(title.dataset.chatveilState).toBe('visible');
    expect(storage.current().unlockedKeysByHost['chatgpt.com']).toHaveLength(1);
    expect(action.textContent).toContain('Unpin title mask');

    action.click();
    await flushPromises();
    expect(title.dataset.chatveilState).toBe('masked');
    expect(storage.current().unlockedKeysByHost['chatgpt.com']).toHaveLength(0);
  });

  it('removes bad nested menu actions from ChatGPT move-to-project rows', async () => {
    document.body.innerHTML = `
      <nav>
        <li>
          <a href="https://chatgpt.com/c/old"><span>Private research notes</span></a>
          <button type="button" aria-haspopup="menu">More</button>
        </li>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chatgpt.com/c/current') as unknown as Location,
      storage,
      adapters: [chatGptAdapter],
    });

    await engine.start();
    document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <button role="menuitem">Share</button>
      <button role="menuitem">Rename</button>
      <div id="move-row" role="menuitem">
        <span>Move to project</span>
        <span>›</span>
        <button data-chatveil-menu-action="true">P Pin title unmasked</button>
      </div>
      <button data-chatveil-menu-action="true">P Pin title unmasked</button>
      <hr>
      <button data-chatveil-menu-action="true">P Pin title unmasked</button>
      <button role="menuitem">Pin chat</button>
      <button role="menuitem">Delete</button>
    `;
    document.body.append(menu);
    await engine.refresh();

    const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-chatveil-menu-action="true"]'));
    expect(actions).toHaveLength(1);
    expect(document.querySelector('#move-row [data-chatveil-menu-action="true"]')).toBeNull();
    expect(actions[0].parentElement).toBe(menu);
    expect(actions[0].nextElementSibling?.textContent).toBe('Pin chat');
  });

  it('adds the same menu action on generic supported chatbot sites', async () => {
    document.body.innerHTML = `
      <aside>
        <li>
          <a href="https://chat.mistral.ai/chat/old"><span>Mistral private title</span></a>
          <button type="button" aria-label="More actions">More</button>
        </li>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chat.mistral.ai/chat/current') as unknown as Location,
      storage,
      adapters: [genericSidebarAdapter],
    });

    await engine.start();
    const menuTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilState).toBe('masked');

    menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.innerHTML = `
      <button role="menuitem">Share</button>
      <button role="menuitem">Rename</button>
      <button role="menuitem">Delete</button>
    `;
    document.body.append(menu);
    await engine.refresh();

    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    action.click();
    await flushPromises();
    expect(title.dataset.chatveilState).toBe('visible');
    expect(storage.current().unlockedKeysByHost['chat.mistral.ai']).toHaveLength(1);
  });

  it('recognizes Kimi-style edit/pin/delete menus', async () => {
    document.body.innerHTML = `
      <aside>
        <li>
          <a href="https://kimi.moonshot.cn/chat/old"><span>Kimi private title</span></a>
          <button type="button" aria-label="More actions">More</button>
        </li>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://kimi.moonshot.cn/chat/current') as unknown as Location,
      storage,
      adapters: [genericSidebarAdapter],
    });

    await engine.start();
    const menuTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
    menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.innerHTML = `
      <button role="menuitem">Edit Chat Name</button>
      <button role="menuitem">Pin to top</button>
      <button role="menuitem">Delete</button>
    `;
    document.body.append(menu);
    await engine.refresh();

    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.nextElementSibling?.textContent).toBe('Pin to top');
  });

  it('adds the menu action on Claude when the options button sits outside the title link', async () => {
    document.body.innerHTML = `
      <nav>
        <div class="flex group relative">
          <a href="https://claude.ai/chat/old"><span>Claude private title</span></a>
          <button type="button" aria-label="Open conversation options">...</button>
        </div>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://claude.ai/chat/current') as unknown as Location,
      storage,
      adapters: [claudeAdapter],
    });

    await engine.start();
    const menuTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="Open conversation options"]')!;
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilState).toBe('masked');

    menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <div role="menuitem">Rename</div>
      <div role="menuitem">Add to project</div>
      <div role="menuitem">Delete</div>
    `;
    document.body.append(menu);
    await engine.refresh();

    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.nextElementSibling?.textContent).toBe('Delete');

    action.click();
    await flushPromises();
    expect(title.dataset.chatveilState).toBe('visible');
    expect(storage.current().unlockedKeysByHost['claude.ai']).toHaveLength(1);
  });

  it('masks Claude Code truncate title elements directly instead of leaving a parent ellipsis', async () => {
    document.body.innerHTML = `
      <nav>
        <div class="flex group relative">
          <a href="https://claude.ai/chat/old">
            <span class="min-w-0 flex-1 truncate text-sm">Analyzing paper architecture with many details</span>
          </a>
          <button type="button" aria-label="Open conversation options">...</button>
        </div>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings({ maskStyle: 'skeleton' }));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://claude.ai/chat/current') as unknown as Location,
      storage,
      adapters: [claudeAdapter],
    });

    await engine.start();
    const row = document.querySelector<HTMLElement>('[data-chatveil-row="true"]')!;
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilTextWrapper).toBeUndefined();
    expect(title.className).toContain('truncate');
    expect(title.dataset.chatveilState).toBe('masked');

    row.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    expect(title.dataset.chatveilState).toBe('visible');

    row.dispatchEvent(new Event('pointerleave', { bubbles: true }));
    expect(title.dataset.chatveilState).toBe('masked');
  });

  it('adds the Claude Code menu action from an unlabeled icon button inside the Base UI popover body', async () => {
    document.body.innerHTML = `
      <nav>
        <div class="flex group relative">
          <a href="https://claude.ai/chat/old"><span>Claude Code private title</span></a>
          <button id="cc-menu" class="inline-flex items-center justify-center relative isolate shrink-0">
            <svg aria-hidden="true"></svg>
          </button>
        </div>
      </nav>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://claude.ai/chat/current') as unknown as Location,
      storage,
      adapters: [claudeAdapter],
    });

    await engine.start();
    document.querySelector<HTMLButtonElement>('#cc-menu')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const popover = document.createElement('div');
    popover.className = 'z-popover';
    popover.innerHTML = `
      <div class="min-h-0 overflow-y-auto rounded-[inherit] p-1">
        <div role="menuitem"><span>&#xE0E7;</span><span>Star</span></div>
        <div role="menuitem"><span>&#xE064;</span><span>Rename</span></div>
        <div role="menuitem"><span>&#xE0C9;</span><span>Add to project</span></div>
        <div role="menuitem"><span>&#xE101;</span><span>Delete</span></div>
      </div>
    `;
    document.body.append(popover);
    await engine.refresh();

    const menuBody = document.querySelector<HTMLElement>('.min-h-0')!;
    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.parentElement).toBe(menuBody);
    expect(action.nextElementSibling?.textContent).toContain('Delete');
  });

  it('infers the Claude Code row from the open Base UI popover when the menu-click event is missed', async () => {
    document.body.innerHTML = `
      <nav>
        <div id="cc-row" class="flex group relative">
          <a href="https://claude.ai/chat/old">
            <span class="min-w-0 flex-1 truncate text-sm">Claude Code private title</span>
          </a>
          <button id="cc-menu" class="inline-flex items-center justify-center relative isolate shrink-0">
            <svg aria-hidden="true"></svg>
          </button>
        </div>
      </nav>
      <div class="z-popover">
        <div id="cc-menu-body" class="min-h-0 overflow-y-auto rounded-[inherit] p-1">
          <div id="base-ui-_r_ch_" class="cds-reset flex w-full items-center gap-xs px-md py-[calc(var(--spacing)*1.5)]" role="menuitem"><span>&#xE0E7;</span><span>Star</span></div>
          <div class="cds-reset flex w-full items-center gap-xs px-md py-[calc(var(--spacing)*1.5)]" role="menuitem"><span>&#xE064;</span><span>Rename</span></div>
          <div class="cds-reset flex w-full items-center gap-xs px-md py-[calc(var(--spacing)*1.5)]" role="menuitem"><span>&#xE0C9;</span><span>Add to project</span></div>
          <div class="cds-reset flex w-full items-center gap-xs px-md py-[calc(var(--spacing)*1.5)]" role="menuitem"><span>&#xE101;</span><span>Delete</span></div>
        </div>
      </div>
    `;
    setRect(document.querySelector<HTMLElement>('#cc-row')!, { left: 4, top: 366, right: 550, bottom: 429, width: 546, height: 63 });
    setRect(document.querySelector<HTMLElement>('#cc-menu-body')!, {
      left: 240,
      top: 448,
      right: 394,
      bottom: 593,
      width: 154,
      height: 145,
    });
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://claude.ai/chat/current') as unknown as Location,
      storage,
      adapters: [claudeAdapter],
    });

    await engine.start();

    const menuBody = document.querySelector<HTMLElement>('#cc-menu-body')!;
    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.parentElement).toBe(menuBody);
    expect(action.nextElementSibling?.textContent).toContain('Delete');
  });

  it('does not inject menu actions into page content from hover-only rows', async () => {
    document.body.innerHTML = `
      <nav>
        <a href="https://chatgpt.com/c/old"><span>ChatGPT hovered title</span></a>
      </nav>
      <main>
        <div role="menu">
          <button role="menuitem">Share</button>
          <button role="menuitem">Copy</button>
          <button role="menuitem">Download</button>
        </div>
        <button data-chatveil-menu-action="true">P Pin title unmasked</button>
      </main>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chatgpt.com/c/current') as unknown as Location,
      storage,
      adapters: [chatGptAdapter],
    });

    await engine.start();
    const row = document.querySelector<HTMLElement>('[data-chatveil-row="true"]')!;
    row.dispatchEvent(new Event('pointerenter'));
    await flushPromises();
    await engine.refresh();

    expect(document.querySelector('[data-chatveil-menu-action="true"]')).toBeNull();
  });

  it('associates a detached ellipsis button with the nearest masked row', async () => {
    document.body.innerHTML = `
      <nav>
        <a id="detached-row" href="https://claude.ai/chat/old"><span>Claude detached menu title</span></a>
      </nav>
      <button id="detached-menu">⋮</button>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://claude.ai/chat/current') as unknown as Location,
      storage,
      adapters: [claudeAdapter],
    });

    await engine.start();
    const row = document.querySelector<HTMLElement>('#detached-row')!;
    const menuTrigger = document.querySelector<HTMLButtonElement>('#detached-menu')!;
    setRect(row, { left: 10, top: 100, right: 300, bottom: 140, width: 290, height: 40 });
    setRect(menuTrigger, { left: 310, top: 104, right: 340, bottom: 134, width: 30, height: 30 });

    menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <div role="menuitem">Select</div>
      <div role="menuitem">Edit name</div>
      <div role="menuitem">Delete</div>
    `;
    document.body.append(menu);
    await engine.refresh();

    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.nextElementSibling?.textContent).toBe('Delete');
  });

  it('does not run on Xiaomi MiMO while support is disabled', async () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>MiMo Claw Free Trial</div>
        <div>MiMo Chat</div>
        <div>History</div>
        <div>New conversation</div>
        <div class="history-row">
          <span>程序员风安慰失恋猫咪代码指南</span>
          <button type="button">⋮</button>
        </div>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://aistudio.xiaomimimo.com/chat/current') as unknown as Location,
      storage,
    });

    await engine.start();
    expect(document.querySelector('[data-chatveil-title="true"]')).toBeNull();
    expect(document.querySelector('[data-chatveil-menu-action="true"]')).toBeNull();
  });

  it('masks MiniMax on the agent.minimaxi.com host', async () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div class="record-list">
          <button>任务记录⌄</button>
          <button class="plain-record">
            <span class="truncate mr-[8px] flex-1">Arena 分数</span>
          </button>
          <button class="plain-record">
            <span class="truncate mr-[8px] flex-1">你好</span>
          </button>
        </div>
        <div class="sidebar-footer">
          <span class="avatar">FW</span>
          <span>FANGZHOU WANG Pro</span>
        </div>
      </aside>
      <main class="conversation">
        <div>好的，我已收到您的请求，正在处理中。</div>
        <button class="plain-record">
          <span class="truncate mr-[8px] flex-1">Chatbot Arena leaderboard 2026 latest scores ranking</span>
        </button>
      </main>
    `;
    for (const row of Array.from(document.querySelectorAll<HTMLElement>('aside .plain-record'))) {
      setRect(row, { left: 20, top: 800, right: 390, bottom: 840, width: 370, height: 40 });
    }
    setRect(document.querySelector<HTMLElement>('main .plain-record')!, {
      left: 640,
      top: 600,
      right: 1800,
      bottom: 640,
      width: 1160,
      height: 40,
    });
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://agent.minimaxi.com/chat?id=399550672560997') as unknown as Location,
      storage,
      adapters: [minimaxAdapter],
    });

    await engine.start();
    const titles = Array.from(document.querySelectorAll<HTMLElement>('[data-chatveil-title="true"]'));
    expect(titles.map((title) => title.textContent?.trim())).toEqual(['Arena 分数', '你好']);
    expect(titles.every((title) => title.dataset.chatveilState === 'masked')).toBe(true);
    expect(titles.every((title) => title.className.includes('truncate'))).toBe(true);
    expect(document.querySelector('main [data-chatveil-title="true"]')).toBeNull();
    expect(document.querySelector('.sidebar-footer [data-chatveil-title="true"]')).toBeNull();
  });

  it('masks Qwen plain rows and injects into Chinese div menus', async () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>新建对话</div>
        <div>搜索对话</div>
        <div>社区</div>
        <div>Coder</div>
        <div>项目</div>
        <div>所有对话</div>
        <div>今天</div>
        <div>新建对话</div>
        <div>2025</div>
        <div class="conversation-row">
          <span>传染病预测模型与方法综述</span>
          <button type="button">⋮</button>
        </div>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chat.qwen.ai/c/current') as unknown as Location,
      storage,
      adapters: [qwenAdapter],
    });

    await engine.start();
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilState).toBe('masked');

    const menuTrigger = document.querySelector<HTMLButtonElement>('button')!;
    menuTrigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const menu = document.createElement('div');
    menu.innerHTML = `
      <div>置顶</div>
      <div>重命名</div>
      <div>复制</div>
      <div>归档</div>
      <div>分享</div>
      <div>下载</div>
      <div>移至项目</div>
      <div>删除</div>
    `;
    document.body.append(menu);
    await engine.refresh();

    const action = document.querySelector<HTMLButtonElement>('[data-chatveil-menu-action="true"]')!;
    expect(action.textContent).toContain('Pin title unmasked');
    expect(action.nextElementSibling?.textContent).toBe('置顶');
  });

  it('keeps a trailing Qwen ellipsis button outside the masked title element', async () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>所有对话</div>
        <div>今天</div>
        <div class="conversation-row">
          <span>
            传染病预测模型与方法综述
            <button type="button" aria-label="More actions">•••</button>
          </span>
        </div>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chat.qwen.ai/c/current') as unknown as Location,
      storage,
      adapters: [qwenAdapter],
    });

    await engine.start();
    const title = document.querySelector<HTMLElement>('[data-chatveil-title="true"]')!;
    expect(title.dataset.chatveilState).toBe('masked');
    expect(title.dataset.chatveilTextWrapper).toBe('true');
    expect(title.textContent?.trim()).toBe('传染病预测模型与方法综述');
    expect(title.querySelector('button, [role="button"], img, svg')).toBeNull();
    expect(document.querySelector('button')?.textContent).toBe('•••');
  });

  it('does not run on Z.ai/GLM while support is disabled', async () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>Chat</div>
        <div>Agent</div>
        <div>New Chat</div>
        <div>2025</div>
        <button class="conversation-row">
          <div class="text-left self-center min-w-0 w-full truncate leading-5">OCR Error Handling 📚</div>
        </button>
        <button class="conversation-row">SFT-GRPO模型优化</button>
        <div class="sidebar-user"><span>Wonster Wayne</span></div>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://chat.z.ai/') as unknown as Location,
      storage,
    });

    await engine.start();
    document.querySelector<HTMLElement>('[aria-label="More actions"]')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await engine.refresh();
    expect(document.querySelector('[data-chatveil-title="true"]')).toBeNull();
    expect(document.querySelector('[data-chatveil-menu-action="true"]')).toBeNull();
  });

  it('runs generic sidebar masking only after a custom host is enabled', async () => {
    document.body.innerHTML = `
      <aside>
        <a href="https://bot.example/thread/one"><span>Other bot title</span></a>
      </aside>
    `;
    const storage = createMemoryStorage(normalizeSettings(undefined));
    const engine = new MaskEngine({
      root: document,
      location: new URL('https://bot.example/thread/two') as unknown as Location,
      storage,
      adapters: [genericSidebarAdapter],
    });

    await engine.start();
    expect(document.querySelector('[data-chatveil-title="true"]')).toBeNull();

    await engine.setSettings(normalizeSettings({ customHosts: ['bot.example'], enabledHosts: { 'bot.example': true } }));
    expect(document.querySelector<HTMLElement>('[data-chatveil-title="true"]')?.dataset.chatveilState).toBe('masked');
  });
});
