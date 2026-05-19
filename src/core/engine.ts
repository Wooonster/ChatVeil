import { DATA_PREFIX, MAX_CUSTOM_MASK_LENGTH, STYLE_ID } from './constants';
import { defaultAdapters, selectAdapter } from './adapters';
import { hashStableKey } from './hash';
import { canRunOnHost, getSiteStatus, setUnlockedKey } from './settings';
import type { ChatbotAdapter, EngineOptions, HistoryItem, MaskSettings, SettingsStorage } from './types';

interface BoundEngineItem {
  host: string;
  hashedKey: string;
  title: HTMLElement;
}

const MENU_ACTION_LABEL = 'Pin title unmasked';
const MENU_UNPIN_LABEL = 'Unpin title mask';
const MENU_CONTEXT_TTL_MS = 30_000;

const MENU_ITEM_TEXT_PATTERN =
  /^(select|share|rename|edit name|edit chat name|move to project|add to project|move|pin chat|pin to top|pin|unpin|star|unstar|favorite|archive|delete|remove|remove from recents|duplicate|copy|copy link|download|export|选择|分享|重命名|编辑名称|编辑对话名|移动|移至项目|置顶|固定|取消置顶|归档|存档|删除|移除|复制|复制链接|下载)$/i;
const MENU_CONTAINER_TEXT_PATTERN =
  /(select|share|rename|edit name|edit chat name|pin chat|pin to top|star|favorite|archive|delete|remove|move to project|add to project|copy|download|选择|分享|重命名|编辑名称|编辑对话名|置顶|固定|归档|删除|移除|移动|移至项目|复制|下载)/i;

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="option"], button, [role="button"], li, div';

const MENU_CONTROL_SELECTOR =
  'button, [role="button"], [aria-haspopup="menu"], [data-testid*="menu" i], [data-testid*="more" i], [data-testid*="option" i], [data-testid*="action" i], [aria-label*="menu" i], [aria-label*="more" i], [aria-label*="option" i], [aria-label*="action" i], [aria-label*="overflow" i], [aria-label*="conversation" i], [aria-label*="chat" i], [aria-label*="更多" i]';

function normalizeMenuText(text: string): string {
  return text.replace(/[\uE000-\uF8FF]/g, '').replace(/\s+/g, ' ').trim();
}

function createVisibilityIcon(document: Document, visible: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const eye = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  eye.setAttribute('d', 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z');
  const pupil = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pupil.setAttribute('cx', '12');
  pupil.setAttribute('cy', '12');
  pupil.setAttribute('r', '2.5');
  svg.append(eye, pupil);

  if (!visible) {
    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    slash.setAttribute('d', 'M4 4l16 16');
    svg.append(slash);
  }
  return svg;
}

function isIconOnlyMenuControl(control: HTMLElement): boolean {
  const text = (control.textContent ?? '').replace(/\s+/g, '').trim();
  const rect = control.getBoundingClientRect();
  const compact = rect.width === 0 || rect.height === 0 || (rect.width <= 48 && rect.height <= 48);
  const className = typeof control.className === 'string' ? control.className : '';
  return text.length <= 2 && compact && (Boolean(control.querySelector('svg')) || /inline-flex|items-center|justify-center|icon/i.test(className));
}

function isLikelyMenuControl(control: HTMLElement): boolean {
  const marker = [
    control.textContent,
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.getAttribute('data-testid'),
    control.getAttribute('aria-haspopup'),
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return /(\.\.\.|…|⋯|⋮|︙|···|more|menu|option|action|overflow|conversation|chat|更多|操作|菜单)/i.test(marker);
}

function isJsdomDocument(document: Document): boolean {
  return /jsdom/i.test(document.defaultView?.navigator.userAgent ?? '');
}

function ownerDocument(root: Document | HTMLElement): Document {
  return root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : (root as HTMLElement).ownerDocument;
}

function documentRoot(root: Document | HTMLElement): ParentNode {
  return root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root;
}

function setDataset(element: HTMLElement, name: string, value: string): void {
  element.dataset[`${DATA_PREFIX}${name}`] = value;
}

function deleteDataset(element: HTMLElement, name: string): void {
  delete element.dataset[`${DATA_PREFIX}${name}`];
}

function maskTextFor(text: string, pattern: string): string {
  const patternCharacters = Array.from(pattern.trim()).slice(0, MAX_CUSTOM_MASK_LENGTH);
  const fallbackPattern = patternCharacters.length > 0 ? patternCharacters : ['•'];
  const targetCount = Math.min(MAX_CUSTOM_MASK_LENGTH, Math.max(4, Array.from(text.trim()).length));
  const output: string[] = [];
  while (output.length < targetCount) {
    output.push(...fallbackPattern);
  }
  return output.slice(0, targetCount).join('');
}

function buildStyle(): string {
  return `
[data-${DATA_PREFIX}-title="true"] {
  position: relative !important;
  isolation: isolate !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"] {
  color: transparent !important;
  text-shadow: none !important;
  -webkit-text-fill-color: transparent !important;
  caret-color: transparent !important;
  text-overflow: clip !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"]::after {
  content: "";
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  top: 50% !important;
  height: 0.8em !important;
  min-width: 3.5em !important;
  transform: translateY(-50%) !important;
  border-radius: 999px !important;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0.38), rgba(203, 213, 225, 0.56), rgba(148, 163, 184, 0.38)) !important;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.16) !important;
  pointer-events: none !important;
  z-index: 1 !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="characters"]::after {
  content: attr(data-${DATA_PREFIX}-mask-text) !important;
  top: 0 !important;
  height: auto !important;
  min-width: 0 !important;
  transform: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  color: rgba(71, 85, 105, 0.78) !important;
  -webkit-text-fill-color: rgba(71, 85, 105, 0.78) !important;
  opacity: 0.72 !important;
  letter-spacing: 0 !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="blur"] {
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
  filter: blur(5px) !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="blur"]::after {
  display: none !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="visible"] {
  filter: none !important;
}
[data-${DATA_PREFIX}-title-clip="true"][data-${DATA_PREFIX}-clip-state="masked"] {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-overflow: clip !important;
}
[data-${DATA_PREFIX}-menu-action="true"] {
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  width: 100% !important;
  min-height: 40px !important;
  border: 0 !important;
  border-radius: 6px !important;
  padding: 8px 12px !important;
  color: inherit !important;
  background: transparent !important;
  font: inherit !important;
  text-align: left !important;
  cursor: pointer !important;
}
[data-${DATA_PREFIX}-menu-action="true"]:hover,
[data-${DATA_PREFIX}-menu-action="true"]:focus-visible {
  background: rgba(148, 163, 184, 0.14) !important;
  outline: none !important;
}
[data-${DATA_PREFIX}-menu-action-icon="true"] {
  display: inline-flex !important;
  width: 20px !important;
  flex: 0 0 20px !important;
  align-items: center !important;
  justify-content: center !important;
  color: inherit !important;
}
[data-${DATA_PREFIX}-menu-action-icon="true"] svg {
  width: 18px !important;
  height: 18px !important;
  display: block !important;
}
`;
}

export class MaskEngine {
  private readonly root: Document | HTMLElement;
  private readonly document: Document;
  private readonly location: Pick<Location, 'href' | 'origin' | 'hostname' | 'pathname'>;
  private readonly storage: SettingsStorage;
  private readonly adapters: ChatbotAdapter[];
  private readonly clock: () => number;
  private readonly onError?: (error: unknown) => void;
  private readonly rowBindings = new WeakMap<HTMLElement, BoundEngineItem>();
  private readonly boundRows = new WeakSet<HTMLElement>();
  private readonly activeRevealKeys = new Set<string>();
  private readonly documentMenuListener = (event: Event) => {
    this.rememberMenuRowFromDocument(event);
  };
  private lastMenuRow?: HTMLElement;
  private lastMenuRowAt = 0;
  private observer?: MutationObserver;
  private settings?: MaskSettings;
  private refreshQueued = false;
  private stopped = false;

  constructor(options: EngineOptions) {
    this.root = options.root;
    this.document = ownerDocument(options.root);
    this.location = options.location;
    this.storage = options.storage;
    this.adapters = options.adapters ?? defaultAdapters;
    this.clock = options.clock ?? (() => Date.now());
    this.onError = options.onError;
  }

  async start(): Promise<void> {
    try {
      this.stopped = false;
      this.injectStyle();
      this.settings = await this.storage.getSettings();
      await this.rescan();
      if (this.stopped) return;
      this.observer = new MutationObserver((records) => {
        if (this.shouldRefreshForMutations(records)) this.queueRefresh();
      });
      this.observer.observe(documentRoot(this.root), {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'aria-current', 'data-active', 'data-current', 'data-selected', 'class'],
        attributeOldValue: true,
      });
      this.document.addEventListener('pointerdown', this.documentMenuListener, true);
      this.document.addEventListener('click', this.documentMenuListener, true);
      this.document.addEventListener('contextmenu', this.documentMenuListener, true);
    } catch (error) {
      this.handleError(error);
    }
  }

  stop(): void {
    this.stopped = true;
    this.observer?.disconnect();
    this.observer = undefined;
    this.document.removeEventListener('pointerdown', this.documentMenuListener, true);
    this.document.removeEventListener('click', this.documentMenuListener, true);
    this.document.removeEventListener('contextmenu', this.documentMenuListener, true);
    this.clearMarkedTitles();
  }

  async refresh(): Promise<void> {
    if (this.stopped) return;
    try {
      this.settings = await this.storage.getSettings();
      await this.rescan();
    } catch (error) {
      this.handleError(error);
    }
  }

  async setSettings(settings: MaskSettings): Promise<void> {
    if (this.stopped) return;
    try {
      this.settings = settings;
      await this.storage.setSettings(settings);
      await this.rescan();
    } catch (error) {
      this.handleError(error);
    }
  }

  private queueRefresh(): void {
    if (this.stopped || this.refreshQueued) return;
    this.refreshQueued = true;
    this.document.defaultView?.setTimeout(() => {
      if (this.stopped) return;
      this.refreshQueued = false;
      void this.refresh();
    }, 60);
  }

  private shouldRefreshForMutations(records: MutationRecord[]): boolean {
    const stateClassPattern = /\b(active|current|selected|open|expanded)\b/i;
    const elementCtor = this.document.defaultView?.HTMLElement;
    for (const record of records) {
      if (record.type === 'childList') {
        const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
        if (
          changedNodes.some(
            (node) => !elementCtor || !(node instanceof elementCtor) || !node.matches(`[data-${DATA_PREFIX}-menu-action="true"]`),
          )
        ) {
          return true;
        }
        continue;
      }
      if (record.type !== 'attributes') continue;
      if (record.attributeName !== 'class') return true;
      const target = record.target;
      if (!elementCtor || !(target instanceof elementCtor)) return true;
      const before = record.oldValue ?? '';
      const after = typeof target.className === 'string' ? target.className : '';
      if (stateClassPattern.test(before) || stateClassPattern.test(after)) return true;
      if (target.closest(`[data-${DATA_PREFIX}-row="true"], [data-${DATA_PREFIX}-title="true"]`)) continue;
      return true;
    }
    return false;
  }

  private injectStyle(): void {
    if (this.document.getElementById(STYLE_ID)) return;
    const style = this.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = buildStyle();
    this.document.documentElement.append(style);
  }

  private clearMarkedTitles(): void {
    for (const element of Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-title="true"]`))) {
      deleteDataset(element, 'Title');
      deleteDataset(element, 'State');
      deleteDataset(element, 'Style');
      deleteDataset(element, 'MaskText');
      deleteDataset(element, 'Current');
      this.clearTitleClip(element);
    }
    for (const element of Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-row="true"]`))) {
      deleteDataset(element, 'Row');
      deleteDataset(element, 'Key');
    }
  }

  private async rescan(): Promise<void> {
    if (this.stopped) return;
    const settings = this.settings ?? (await this.storage.getSettings());
    this.settings = settings;
    const status = getSiteStatus(settings, this.location.hostname);
    if (!status.enabled || !canRunOnHost(settings, this.location.hostname)) {
      this.clearMarkedTitles();
      return;
    }

    const adapter = selectAdapter(this.adapters, this.location);
    if (!adapter) {
      this.clearMarkedTitles();
      return;
    }

    const now = this.clock();
    const temporaryShowAll = (settings.showAllUntilByHost[status.host] ?? 0) > now;
    const unlocked = new Set(settings.unlockedKeysByHost[status.host] ?? []);
    const seenTitles = new Set<HTMLElement>();
    const items = adapter.findHistoryItems(documentRoot(this.root));

    await Promise.all(
      items.map(async (item, index) => {
        const rawKey = adapter.getStableKey(item, this.location, index);
        const hashedKey = await hashStableKey(`${status.host}:${adapter.id}:${rawKey}`);
        const isCurrent = adapter.isCurrent(item, this.location);
        const isVisible = isCurrent || temporaryShowAll || unlocked.has(hashedKey) || this.activeRevealKeys.has(hashedKey);
        this.applyMaskState(item, settings, hashedKey, isCurrent, isVisible);
        seenTitles.add(item.title);
      }),
    );

    for (const element of Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-title="true"]`))) {
      if (!seenTitles.has(element)) {
        deleteDataset(element, 'Title');
        deleteDataset(element, 'State');
        deleteDataset(element, 'Style');
        deleteDataset(element, 'MaskText');
        deleteDataset(element, 'Current');
        this.clearTitleClip(element);
      }
    }
    this.injectMenuAction(status.host);
  }

  private applyMaskState(
    item: HistoryItem,
    settings: MaskSettings,
    hashedKey: string,
    isCurrent: boolean,
    isVisible: boolean,
  ): void {
    setDataset(item.row, 'Row', 'true');
    setDataset(item.row, 'Key', hashedKey);
    setDataset(item.title, 'Title', 'true');
    setDataset(item.title, 'Current', String(isCurrent));
    setDataset(item.title, 'State', isVisible ? 'visible' : 'masked');
    setDataset(item.title, 'Style', settings.maskStyle);
    setDataset(item.title, 'MaskText', maskTextFor(item.title.textContent ?? '', settings.customMaskChar));
    this.applyTitleClipState(item.title, isVisible ? 'visible' : 'masked');
    this.rowBindings.set(item.row, {
      host: this.location.hostname.toLowerCase(),
      hashedKey,
      title: item.title,
    });
    this.bindRow(item.row);
  }

  private bindRow(row: HTMLElement): void {
    if (this.boundRows.has(row)) return;
    this.boundRows.add(row);
    row.addEventListener('pointerenter', () => {
      this.revealRow(row);
    });
    row.addEventListener('pointerleave', () => {
      this.maskRow(row);
    });
    row.addEventListener('focusin', () => {
      this.revealRow(row);
    });
    row.addEventListener('focusout', () => {
      this.maskRow(row);
    });
    row.addEventListener(
      'pointerdown',
      (event) => {
        this.rememberMenuRow(row, event);
      },
      true,
    );
    row.addEventListener(
      'click',
      (event) => {
        this.rememberMenuRow(row, event);
      },
      true,
    );
    row.addEventListener('contextmenu', () => {
      this.rememberMenuRowFor(row);
    });
    row.addEventListener('click', (event) => {
      if (event.detail !== 3) return;
      event.preventDefault();
      event.stopPropagation();
      void this.toggleUnlock(row);
    });
  }

  private revealRow(row: HTMLElement): void {
    if (this.stopped) return;
    const binding = this.rowBindings.get(row);
    if (!binding) return;
    this.activeRevealKeys.add(binding.hashedKey);
    this.setBoundTitleState(binding, 'visible');
  }

  private maskRow(row: HTMLElement): void {
    if (this.stopped) return;
    const binding = this.rowBindings.get(row);
    if (!binding) return;
    this.activeRevealKeys.delete(binding.hashedKey);
    this.setBoundTitleState(binding, this.shouldKeepBoundTitleVisible(binding) ? 'visible' : 'masked');
  }

  private setBoundTitleState(binding: BoundEngineItem, state: 'visible' | 'masked'): void {
    if (!this.document.documentElement.contains(binding.title)) return;
    setDataset(binding.title, 'State', state);
    this.applyTitleClipState(binding.title, state);
  }

  private shouldKeepBoundTitleVisible(binding: BoundEngineItem): boolean {
    if (binding.title.dataset[`${DATA_PREFIX}Current`] === 'true') return true;
    if (this.activeRevealKeys.has(binding.hashedKey)) return true;
    const settings = this.settings;
    if (!settings) return false;
    if ((settings.showAllUntilByHost[binding.host] ?? 0) > this.clock()) return true;
    return new Set(settings.unlockedKeysByHost[binding.host] ?? []).has(binding.hashedKey);
  }

  private applyTitleClipState(title: HTMLElement, state: 'visible' | 'masked'): void {
    const parent = title.parentElement;
    if (!parent || !this.isTitleClipParent(title, parent)) {
      this.clearTitleClip(title);
      return;
    }
    setDataset(parent, 'TitleClip', 'true');
    setDataset(parent, 'ClipState', state);
  }

  private clearTitleClip(title: HTMLElement): void {
    const parent = title.parentElement;
    if (!parent || parent.dataset[`${DATA_PREFIX}TitleClip`] !== 'true') return;
    deleteDataset(parent, 'TitleClip');
    deleteDataset(parent, 'ClipState');
  }

  private isTitleClipParent(title: HTMLElement, parent: HTMLElement): boolean {
    if (title.dataset.chatveilTextWrapper !== 'true') return false;
    if (parent.querySelector('button, [role="button"], img, svg, canvas, picture, video, [role="img"]')) return false;
    const className = typeof parent.className === 'string' ? parent.className : '';
    return /\b(flex-?1|min-w-0|w-full|truncate|text-ellipsis|line-clamp|overflow-hidden)\b/i.test(className);
  }

  private async toggleUnlock(row: HTMLElement): Promise<void> {
    if (this.stopped) return;
    const binding = this.rowBindings.get(row);
    const settings = this.settings;
    if (!binding || !settings) return;
    const host = binding.host;
    const current = new Set(settings.unlockedKeysByHost[host] ?? []);
    const shouldUnlock = !current.has(binding.hashedKey);
    const next = setUnlockedKey(settings, host, binding.hashedKey, shouldUnlock);
    await this.setSettings(next);
  }

  private rememberMenuRow(row: HTMLElement, event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>(MENU_CONTROL_SELECTOR);
    if (!control || !row.contains(control) || (!isLikelyMenuControl(control) && !isIconOnlyMenuControl(control))) return;
    this.rememberMenuRowFor(row);
  }

  private rememberMenuRowFromDocument(event: Event): void {
    if (this.stopped) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>(MENU_CONTROL_SELECTOR);
    if (!control || (!isLikelyMenuControl(control) && !isIconOnlyMenuControl(control))) return;
    const row = this.findRowForMenuControl(control);
    if (row) this.rememberMenuRowFor(row);
  }

  private rememberMenuRowFor(row: HTMLElement): void {
    this.lastMenuRow = row;
    this.lastMenuRowAt = this.clock();
    this.queueMenuRefresh();
  }

  private queueMenuRefresh(): void {
    this.queueRefresh();
    for (const delay of [90, 240]) {
      this.document.defaultView?.setTimeout(() => {
        if (!this.stopped) this.queueRefresh();
      }, delay);
    }
  }

  private findRowForMenuControl(control: HTMLElement): HTMLElement | undefined {
    const ancestor = control.closest<HTMLElement>(`[data-${DATA_PREFIX}-row="true"]`);
    if (ancestor && this.rowBindings.has(ancestor)) return ancestor;

    const rows = Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-row="true"]`)).filter((row) =>
      this.rowBindings.has(row),
    );
    if (rows.length === 0) return undefined;

    const controlRect = control.getBoundingClientRect();
    const controlCenterY = controlRect.top + controlRect.height / 2;
    const controlCenterX = controlRect.left + controlRect.width / 2;
    let best: { row: HTMLElement; score: number } | undefined;
    for (const row of rows) {
      const rowRect = row.getBoundingClientRect();
      const rowCenterY = rowRect.top + rowRect.height / 2;
      const rowCenterX = rowRect.left + rowRect.width / 2;
      const verticalDistance =
        controlCenterY >= rowRect.top - 12 && controlCenterY <= rowRect.bottom + 12
          ? 0
          : Math.abs(controlCenterY - rowCenterY);
      if (verticalDistance > 64 && rowRect.height > 0) continue;
      const horizontalDistance = Math.min(
        Math.abs(controlRect.left - rowRect.left),
        Math.abs(controlRect.left - rowRect.right),
        Math.abs(controlRect.right - rowRect.right),
        Math.abs(controlCenterX - rowCenterX),
      );
      const score = verticalDistance * 10 + horizontalDistance;
      if (!best || score < best.score) best = { row, score };
    }
    return best?.row;
  }

  private injectMenuAction(host: string): void {
    const menus = this.findMenus();
    if (host === 'z.ai' || host.endsWith('.z.ai')) {
      this.cleanupMenuActions([]);
      return;
    }

    const menu = this.chooseActionMenu(menus);
    if (!menu) {
      this.cleanupMenuActions([]);
      return;
    }

    const row = this.resolveMenuRow(menu);
    if (!row) {
      this.cleanupMenuActions(menus);
      return;
    }

    const binding = this.rowBindings.get(row);
    const settings = this.settings;
    if (!binding || !settings) {
      this.cleanupMenuActions(menus);
      return;
    }

    this.cleanupMenuActions([menu]);
    const unlocked = new Set(settings.unlockedKeysByHost[host] ?? []).has(binding.hashedKey);
    const actions = this.directMenuActions(menu);
    const existing = actions.find((action): action is HTMLButtonElement => action instanceof HTMLButtonElement);
    for (const action of actions) {
      if (action !== existing) action.remove();
    }
    if (existing) {
      this.updateMenuAction(existing, row, unlocked);
      this.positionMenuAction(menu, existing);
      return;
    }

    const action = this.createMenuAction(row, unlocked);
    this.positionMenuAction(menu, action);
  }

  private resolveMenuRow(menu: HTMLElement): HTMLElement | undefined {
    const row = this.lastMenuRow;
    if (row && this.document.documentElement.contains(row) && this.rowBindings.has(row) && this.clock() - this.lastMenuRowAt <= MENU_CONTEXT_TTL_MS) {
      return row;
    }
    return this.findNearestRowForMenu(menu);
  }

  private findNearestRowForMenu(menu: HTMLElement): HTMLElement | undefined {
    const rows = Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-row="true"]`)).filter((row) =>
      this.rowBindings.has(row),
    );
    if (rows.length === 0) return undefined;

    const menuRect = menu.getBoundingClientRect();
    if (menuRect.width <= 0 && menuRect.height <= 0) return undefined;
    const menuAnchorY = menuRect.top;
    const menuAnchorX = menuRect.left;
    let best: { row: HTMLElement; score: number } | undefined;
    for (const row of rows) {
      const rowRect = row.getBoundingClientRect();
      if (rowRect.width <= 0 && rowRect.height <= 0) continue;
      const rowCenterY = rowRect.top + rowRect.height / 2;
      const verticalDistance = Math.abs(menuAnchorY - rowCenterY);
      if (verticalDistance > 140) continue;
      const horizontalDistance = Math.min(
        Math.abs(menuAnchorX - rowRect.right),
        Math.abs(menuAnchorX - rowRect.left),
        Math.abs(menuAnchorX - (rowRect.left + rowRect.width / 2)),
      );
      const score = verticalDistance * 10 + horizontalDistance;
      if (!best || score < best.score) best = { row, score };
    }
    return best?.row;
  }

  private createMenuAction(row: HTMLElement, unlocked: boolean): HTMLButtonElement {
    const action = this.document.createElement('button');
    action.type = 'button';
    action.setAttribute('role', 'menuitem');
    setDataset(action, 'MenuAction', 'true');
    const icon = this.document.createElement('span');
    setDataset(icon, 'MenuActionIcon', 'true');
    const label = this.document.createElement('span');
    action.append(icon, label);
    this.updateMenuAction(action, row, unlocked);
    return action;
  }

  private updateMenuAction(action: HTMLButtonElement, row: HTMLElement, unlocked: boolean): void {
    const icon = action.querySelector<HTMLElement>(`[data-${DATA_PREFIX}-menu-action-icon="true"]`);
    icon?.replaceChildren(createVisibilityIcon(this.document, !unlocked));
    const label = action.querySelector('span:last-child');
    if (label) label.textContent = unlocked ? MENU_UNPIN_LABEL : MENU_ACTION_LABEL;
    action.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const binding = this.rowBindings.get(row);
      const settings = this.settings;
      if (!binding || !settings) return;
      const isUnlocked = new Set(settings.unlockedKeysByHost[binding.host] ?? []).has(binding.hashedKey);
      this.updateMenuAction(action, row, !isUnlocked);
      void this.toggleUnlock(row)
        .then(() => {
          if (!this.stopped) this.injectMenuAction(binding.host);
        })
        .catch((error: unknown) => {
          this.handleError(error);
        });
    };
  }

  private findMenus(): HTMLElement[] {
    const menus = new Set<HTMLElement>(this.findPopoverMenuBodies());
    const items = Array.from(this.document.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)).filter((element) => {
      if (element.closest(`[data-${DATA_PREFIX}-menu-action="true"]`)) return false;
      return MENU_ITEM_TEXT_PATTERN.test(normalizeMenuText(element.textContent ?? ''));
    });
    for (const item of items) {
      const menu = this.findMenuContainer(item);
      if (menu) menus.add(menu);
    }
    return Array.from(menus);
  }

  private findPopoverMenuBodies(): HTMLElement[] {
    const popovers = Array.from(
      this.document.querySelectorAll<HTMLElement>(
        '[class*="z-popover"], [class*="popover" i], [data-radix-popper-content-wrapper], [data-floating-ui-portal], [data-headlessui-portal]',
      ),
    );
    const menus: HTMLElement[] = [];
    for (const popover of popovers) {
      const candidates = [
        popover,
        ...Array.from(
          popover.querySelectorAll<HTMLElement>(
            '[role="menu"], [class*="overflow-y-auto"], [class*="min-h-0"], [class*="rounded"], [class*="p-1"]',
          ),
        ),
      ];
      for (const candidate of candidates) {
        if (menus.includes(candidate)) continue;
        if (this.hasDirectMenuShape(candidate) && this.isEligibleMenuContainer(candidate)) menus.push(candidate);
      }
    }
    return menus;
  }

  private hasDirectMenuShape(menu: HTMLElement): boolean {
    const directItems = Array.from(menu.children).filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) return false;
      if (child.matches(`[data-${DATA_PREFIX}-menu-action="true"]`)) return false;
      return child.matches('[role="menuitem"], [role="option"], button, [role="button"]');
    });
    if (directItems.length < 2) return false;
    return directItems.some((item) => MENU_ITEM_TEXT_PATTERN.test(normalizeMenuText(item.textContent ?? ''))) && MENU_CONTAINER_TEXT_PATTERN.test(menu.textContent ?? '');
  }

  private chooseActionMenu(menus: HTMLElement[]): HTMLElement | undefined {
    return (
      menus.find((menu) => Boolean(this.findMenuItemByText(menu, /^(pin chat|pin to top|pin|置顶|固定)$/i))) ??
      menus.find((menu) => Boolean(this.findMenuItemByText(menu, /^(delete|remove|删除|移除)$/i))) ??
      menus[0]
    );
  }

  private directMenuActions(menu: HTMLElement): HTMLElement[] {
    return Array.from(menu.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.matches(`[data-${DATA_PREFIX}-menu-action="true"]`),
    );
  }

  private positionMenuAction(menu: HTMLElement, action: HTMLElement): void {
    const pinItem = this.findMenuItemByText(menu, /^(pin chat|pin to top|pin|置顶|固定)$/i);
    const destructiveItem = this.findMenuItemByText(menu, /^(delete|remove|删除|移除)$/i);
    const insertBefore = pinItem ?? destructiveItem;
    if (insertBefore?.parentElement === menu) {
      if (action.nextElementSibling !== insertBefore) menu.insertBefore(action, insertBefore);
      return;
    }
    if (action.parentElement !== menu || action.nextElementSibling) menu.append(action);
  }

  private findMenuContainer(item: HTMLElement): HTMLElement | undefined {
    let current = item.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (current === this.document.body || current === this.document.documentElement) break;
      if (current.matches('[role="menuitem"], [role="option"], button, [role="button"], li')) continue;
      if (current.matches(`[data-${DATA_PREFIX}-menu-action="true"]`) || current.closest(`[data-${DATA_PREFIX}-menu-action="true"]`)) {
        continue;
      }
      const text = current.textContent ?? '';
      const itemCount = Array.from(current.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)).filter((element) =>
        !element.closest(`[data-${DATA_PREFIX}-menu-action="true"]`) && MENU_ITEM_TEXT_PATTERN.test(normalizeMenuText(element.textContent ?? '')),
      ).length;
      const hasMenuShape = itemCount >= 2 && MENU_CONTAINER_TEXT_PATTERN.test(text);
      if ((hasMenuShape || current.getAttribute('role') === 'menu') && this.isEligibleMenuContainer(current)) return current;
    }
    return undefined;
  }

  private isEligibleMenuContainer(menu: HTMLElement): boolean {
    if (!this.document.documentElement.contains(menu)) return false;
    if (menu.matches('[role="menuitem"], [role="option"], button, [role="button"], li')) return false;
    if (menu.closest(`[data-${DATA_PREFIX}-title="true"], [data-${DATA_PREFIX}-row="true"]`)) return false;

    const style = this.document.defaultView?.getComputedStyle(menu);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    if (isJsdomDocument(this.document)) return true;
    if (!this.hasPopupMenuSignal(menu)) return false;

    const rect = menu.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.width > 720 || rect.height > 900) return false;
    const viewportWidth = this.document.defaultView?.innerWidth ?? 0;
    const viewportHeight = this.document.defaultView?.innerHeight ?? 0;
    if (viewportWidth > 0 && rect.width > viewportWidth * 0.8) return false;
    if (viewportHeight > 0 && rect.height > viewportHeight * 0.8) return false;
    return true;
  }

  private hasPopupMenuSignal(menu: HTMLElement): boolean {
    const popupSelector = [
      '[role="menu"]',
      '[role="listbox"]',
      '[data-radix-menu-content]',
      '[data-radix-popper-content-wrapper]',
      '[data-headlessui-portal]',
      '[data-floating-ui-portal]',
      '[data-popper-placement]',
      '[data-side][data-align]',
      '[class*="popover" i]',
      '[class*="dropdown" i]',
      '[class*="floating" i]',
      '[class*="portal" i]',
    ].join(',');
    if (menu.matches(popupSelector) || menu.closest(popupSelector)) return true;

    const marker = [
      menu.id,
      menu.className,
      menu.getAttribute('data-testid'),
      menu.getAttribute('data-radix-menu-content'),
      menu.getAttribute('data-popper-placement'),
    ]
      .join(' ')
      .toLowerCase();
    if (/\b(popover|dropdown|menu|popup|portal|floating|radix|headlessui|tooltip|tippy)\b/.test(marker)) return true;

    let current: HTMLElement | null = menu;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      if (current === this.document.body || current === this.document.documentElement) break;
      const style = this.document.defaultView?.getComputedStyle(current);
      if (!style) continue;
      const zIndex = Number.parseInt(style.zIndex, 10);
      const hasElevatedLayer = Number.isFinite(zIndex) && zIndex >= 10;
      const hasPopupPosition = style.position === 'fixed' || style.position === 'absolute';
      const hasPopupPaint = style.boxShadow !== 'none' || style.transform !== 'none';
      if (hasPopupPosition && (hasElevatedLayer || hasPopupPaint)) return true;
    }
    return false;
  }

  private cleanupMenuActions(validMenus: HTMLElement[]): void {
    const menus = new Set(validMenus);
    for (const action of Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-menu-action="true"]`))) {
      const menu = validMenus.find((candidate) => action.parentElement === candidate);
      if (!menu || !menus.has(menu)) action.remove();
    }
    for (const menu of validMenus) {
      const actions = this.directMenuActions(menu);
      const keep = actions[0];
      for (const action of actions.slice(1)) action.remove();
      if (keep) this.positionMenuAction(menu, keep);
    }
  }

  private findMenuItemByText(menu: HTMLElement, pattern: RegExp): HTMLElement | undefined {
    return Array.from(menu.children).find((child): child is HTMLElement => {
      return child instanceof HTMLElement && pattern.test(normalizeMenuText(child.textContent ?? ''));
    });
  }

  private handleError(error: unknown): void {
    this.onError?.(error);
  }
}

export function createMemoryStorage(initial?: Partial<MaskSettings>): SettingsStorage & { current(): MaskSettings } {
  let settings = {
    ...initial,
  } as MaskSettings;
  return {
    async getSettings() {
      return settings;
    },
    async setSettings(next) {
      settings = next;
    },
    current() {
      return settings;
    },
  };
}
