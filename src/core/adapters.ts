import { DATA_PREFIX } from './constants';
import type { ChatbotAdapter, HistoryItem } from './types';

const titleSelector = [
  '[data-testid*="conversation"]',
  '[data-testid*="history"]',
  '[data-testid*="chat"]',
  '[title]',
  'span',
  'p',
  'div',
].join(',');

const rowActionSelector = [
  'button',
  '[role="button"]',
  '[aria-haspopup="menu"]',
  '[aria-label*="menu" i]',
  '[aria-label*="more" i]',
  '[aria-label*="option" i]',
  '[aria-label*="action" i]',
  '[aria-label*="conversation" i]',
  '[aria-label*="chat" i]',
  '[aria-label*="更多" i]',
  '[data-testid*="menu" i]',
  '[data-testid*="more" i]',
  '[data-testid*="option" i]',
  '[data-testid*="action" i]',
].join(',');

function normalizedText(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, '').trim().toLowerCase();
}

function shouldIgnoreTitleText(text: string): boolean {
  const normalized = normalizeComparableText(text);
  if (!normalized) return true;
  if (/^(19|20)\d{2}([-/.]?\d{1,2})?$/.test(normalized)) return true;
  return [
    'newchat',
    'newconversation',
    'newthread',
    'settings',
    'logout',
    'login',
    'upgrade',
    'help',
    'search',
    'newtask',
    'explore',
    'discover',
    'apps',
    'tools',
    'plugins',
    'community',
    'chats',
    'projects',
    'newproject',
    'artifacts',
    'code',
    'coder',
    'customize',
    'recents',
    'today',
    'yesterday',
    'allchats',
    'allconversations',
    'slides',
    'docs',
    'deepresearch',
    'websites',
    'sheets',
    'agentswarm',
    'kimicode',
    'kimiclaw',
    'chathistory',
    'mimoclaw',
    'mimochat',
    'maxhermes',
    'maxclaw',
    'skills',
    '新对话',
    '新建对话',
    '开启新对话',
    '新建任务',
    'ai创作',
    '更多',
    '设置',
    '登录',
    '退出登录',
    '帮助',
    '搜索',
    '发现',
    '探索',
    '应用',
    '插件',
    '工具',
    '社区',
    '项目',
    '新项目',
    '所有对话',
    '今天',
    '昨天',
    '资产',
    '专家',
    '探索专家',
    '任务记录',
    '新会话',
    '历史',
    '历史记录',
    'skills技能',
    'minimax实验室',
  ].includes(normalized);
}

function cleanPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/g, '');
  return trimmed || '/';
}

function parseHref(href: string | undefined, base: string): URL | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base);
  } catch {
    return undefined;
  }
}

function hostMatches(hostname: string, host: string): boolean {
  const clean = hostname.toLowerCase();
  return clean === host || clean.endsWith(`.${host}`);
}

function isElement(value: unknown): value is HTMLElement {
  return value !== null && typeof value === 'object' && 'nodeType' in value && (value as Node).nodeType === 1;
}

function closestLinkActionRow(link: HTMLElement): HTMLElement | undefined {
  let current = link.parentElement;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    if (current === current.ownerDocument.body || current === current.ownerDocument.documentElement) break;
    const textLength = normalizedText(current).length;
    if (textLength < 2 || textLength > 260) continue;
    if (current.querySelectorAll('a[href], [role="link"]').length !== 1) continue;
    if (!current.querySelector(rowActionSelector)) continue;
    return current;
  }
  return undefined;
}

function closestRow(element: HTMLElement): HTMLElement {
  const link = element.closest<HTMLElement>('a[href], [role="link"]') ?? element;
  const actionRow = closestLinkActionRow(link);
  if (actionRow) return actionRow;
  const containers = Array.from(
    link.closest<HTMLElement>('body')?.querySelectorAll<HTMLElement>(
      'li, [role="treeitem"], [role="listitem"], [data-testid], [data-qa], [aria-label*="conversation" i], [aria-label*="chat" i], [class*="conversation"], [class*="history-item"], [class*="chat-item"], [class*="thread-item"], [class*="session-item"]',
    ) ?? [],
  ).filter((container) => container.contains(link));
  const container =
    containers
      .sort((left, right) => {
        const leftTextLength = normalizedText(left).length;
        const rightTextLength = normalizedText(right).length;
        return leftTextLength - rightTextLength;
      })
      .find((candidate) => {
        const textLength = normalizedText(candidate).length;
        return textLength >= 2 && textLength <= 260 && Boolean(candidate.querySelector('a[href], [role="link"], button, [role="button"]'));
      }) ?? link.closest<HTMLElement>('li, [role="treeitem"], [role="listitem"], [data-testid], [data-qa]');
  return container?.querySelector('a[href], [role="link"], button, [role="button"]') ? container : link;
}

function chooseTitleElement(anchor: HTMLElement): HTMLElement {
  const titleAttrElement = anchor.querySelector<HTMLElement>('[title]');
  if (titleAttrElement && normalizedText(titleAttrElement).length > 0 && !hasNonTitleChild(titleAttrElement)) {
    return titleAttrElement;
  }

  const candidates = Array.from(anchor.querySelectorAll<HTMLElement>(titleSelector))
    .filter((candidate) => {
      const controlAncestor = candidate.closest<HTMLElement>('button, [role="button"]');
      if (controlAncestor && controlAncestor !== anchor) return false;
      if (candidate.closest('svg')) return false;
      if (isActionElement(candidate)) return false;
      if (isMediaElement(candidate)) return false;
      if (hasNonTitleChild(candidate)) return false;
      const text = normalizedText(candidate);
      return text.length >= 2 && text.length <= 180;
    })
    .sort((left, right) => {
      const leftText = normalizedText(left);
      const rightText = normalizedText(right);
      return leftText.length - rightText.length;
    });

  const candidate = candidates[0];
  if (candidate) return candidate;
  return candidate ?? ensureTextOnlyElement(anchor);
}

function isMediaElement(element: HTMLElement): boolean {
  if (isChatVeilParticleElement(element)) return false;
  const className = typeof element.className === 'string' ? element.className : '';
  return (
    ['IMG', 'SVG', 'CANVAS', 'PICTURE', 'VIDEO'].includes(element.tagName) ||
    element.getAttribute('role') === 'img' ||
    /\b(icon|avatar)\b/i.test(className)
  );
}

function isChatVeilParticleElement(element: Element): boolean {
  return element.getAttribute(`data-${DATA_PREFIX}-particle-layer`) === 'true';
}

function hasMediaChild(element: HTMLElement): boolean {
  return Array.from(element.querySelectorAll('img, svg, canvas, picture, video, [role="img"], .icon, [class*="icon"], [class*="avatar"]')).some(
    (child) => !isChatVeilParticleElement(child),
  );
}

function isActionElement(element: HTMLElement): boolean {
  return element.matches(rowActionSelector);
}

function hasActionChild(element: HTMLElement): boolean {
  return Boolean(element.querySelector(rowActionSelector));
}

function hasNonTitleChild(element: HTMLElement): boolean {
  return hasMediaChild(element) || hasActionChild(element);
}

function isProfileOrAccountRow(row: HTMLElement): boolean {
  const marker = [
    row.className,
    row.id,
    row.getAttribute('data-testid'),
    row.getAttribute('data-qa'),
    row.getAttribute('aria-label'),
  ]
    .join(' ')
    .toLowerCase();
  const text = normalizedText(row).toLowerCase();
  return (
    /\b(user|profile|account|avatar|workspace|sidebar-user|footer)\b/.test(marker) ||
    Boolean(row.closest('footer, [class*="footer" i], [class*="account" i], [class*="profile" i], [class*="user" i]')) ||
    (hasMediaChild(row) && /\b(pro|free|team|account|profile|个人|账号)\b/i.test(text))
  );
}

function ensureTextOnlyElement(row: HTMLElement, forceWrapper = false): HTMLElement {
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length < 2 || text.length > 180) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const controlAncestor = parent.closest<HTMLElement>('button, [role="button"]');
      if (!forceWrapper && controlAncestor && controlAncestor !== row) return NodeFilter.FILTER_REJECT;
      if (parent.closest('svg, [aria-hidden="true"], [role="img"], script, style')) return NodeFilter.FILTER_REJECT;
      if (isActionElement(parent)) return NodeFilter.FILTER_REJECT;
      if (hasNonTitleChild(parent) && normalizedText(parent) === text) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNode = walker.nextNode();
  if (!textNode?.parentNode) return row;
  const parent = textNode.parentElement;
  if (!forceWrapper && parent && parent.childNodes.length === 1 && !hasNonTitleChild(parent)) {
    return parent;
  }

  const wrapper = row.ownerDocument.createElement('span');
  wrapper.dataset.chatveilTextWrapper = 'true';
  textNode.parentNode.insertBefore(wrapper, textNode);
  wrapper.append(textNode);
  return wrapper;
}

function hasActiveMarker(element: HTMLElement): boolean {
  const marker = [
    element.getAttribute('aria-current'),
    element.getAttribute('data-active'),
    element.getAttribute('data-current'),
    element.getAttribute('data-selected'),
    element.className,
  ]
    .join(' ')
    .toLowerCase();
  return /\b(page|true|active|current|selected)\b/.test(marker);
}

function isCurrentByHref(item: HistoryItem, location: Pick<Location, 'href' | 'pathname' | 'origin'>): boolean {
  if (hasActiveMarker(item.row) || hasActiveMarker(item.title)) return true;
  const url = parseHref(item.href, location.href);
  if (!url || url.origin !== location.origin) return false;
  return cleanPath(url.pathname) === cleanPath(location.pathname);
}

function stableKeyFromHref(item: HistoryItem, location: Pick<Location, 'href' | 'origin' | 'pathname'>, index: number): string {
  const href = parseHref(item.href, location.href);
  if (href) return `${href.origin}${cleanPath(href.pathname)}`;
  const text = normalizedText(item.title).toLowerCase();
  return `${location.origin}${cleanPath(location.pathname)}#${item.source ?? 'item'}:${index}:${text}`;
}

function stableKeyFromDeepSeek(item: HistoryItem, location: Pick<Location, 'href' | 'origin' | 'pathname'>, index: number): string {
  const id =
    item.row.getAttribute('data-conversation-id') ??
    item.row.getAttribute('data-chat-id') ??
    item.row.getAttribute('data-session-id') ??
    item.row.getAttribute('data-id');
  if (id) return `${location.origin}/deepseek/${id}`;
  return stableKeyFromHref(item, location, index);
}

function itemsFromAnchors(root: ParentNode, predicate: (url: URL, anchor: HTMLAnchorElement) => boolean, source: string): HistoryItem[] {
  return itemsFromAnchorsInContainers([root], root, predicate, source);
}

function itemsFromAnchorsInContainers(
  containers: ParentNode[],
  root: ParentNode,
  predicate: (url: URL, anchor: HTMLAnchorElement) => boolean,
  source: string,
): HistoryItem[] {
  const base = root.ownerDocument?.baseURI ?? globalThis.location?.href ?? 'https://example.test/';
  const seenRows = new Set<HTMLElement>();
  const seenAnchors = new Set<HTMLAnchorElement>();
  const output: HistoryItem[] = [];
  const anchors = containers.flatMap((container) => Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')));

  for (const anchor of anchors) {
    if (seenAnchors.has(anchor)) continue;
    seenAnchors.add(anchor);
    const url = parseHref(anchor.getAttribute('href') ?? anchor.href, base);
    if (!url || !predicate(url, anchor)) continue;
    const title = chooseTitleElement(anchor);
    const text = normalizedText(title);
    if (text.length < 2 || text.length > 180) continue;
    if (shouldIgnoreTitleText(text)) continue;
    const row = closestRow(anchor);
    if (seenRows.has(row)) continue;
    seenRows.add(row);
    output.push({ row, title, href: url.href, source });
  }

  return output;
}

function itemFromGenericLink(anchor: HTMLAnchorElement, source: string): HistoryItem | undefined {
  const title = chooseTitleElement(anchor);
  const text = normalizedText(title);
  if (text.length < 2 || text.length > 180) return undefined;
  if (shouldIgnoreTitleText(text)) return undefined;
  return { row: closestRow(anchor), title, href: anchor.href || anchor.getAttribute('href') || undefined, source };
}

function isLikelyChatHistoryUrl(url: URL): boolean {
  return (
    /^\/(a\/)?chat(\/s)?\/[^/]+/.test(url.pathname) ||
    /^\/(c|conversation|thread|session|chatroom)\/[^/]+/.test(url.pathname)
  );
}

function historyContainers(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'aside, nav, [role="navigation"], [data-sidebar], [class*="sidebar"], [class*="history"], [class*="conversation"], [class*="chat-list"], [class*="thread-list"], [class*="session-list"], [class*="task-list"], [class*="record-list"]',
    ),
  );
}

function isSidebarLikeContainer(element: HTMLElement): boolean {
  return Boolean(element.closest('aside, nav, [role="navigation"], [data-sidebar], [class*="sidebar"]'));
}

function sidebarHistoryContainers(root: ParentNode): HTMLElement[] {
  return historyContainers(root).filter(isSidebarLikeContainer);
}

function isLeftSidebarRow(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return true;
  const viewportWidth = element.ownerDocument.defaultView?.innerWidth ?? 0;
  if (viewportWidth <= 0) return true;
  const maxRight = Math.min(760, viewportWidth * 0.5);
  const maxWidth = Math.min(620, viewportWidth * 0.45);
  return rect.left >= -8 && rect.left <= Math.min(520, viewportWidth * 0.4) && rect.right <= maxRight && rect.width <= maxWidth;
}

function itemsFromSidebarAnchors(root: ParentNode, predicate: (url: URL, anchor: HTMLAnchorElement) => boolean, source: string): HistoryItem[] {
  return itemsFromAnchorsInContainers(sidebarHistoryContainers(root), root, predicate, source);
}

function itemFromClickableRow(row: HTMLElement, source: string): HistoryItem | undefined {
  const title = chooseTitleElement(row);
  const text = normalizedText(title);
  if (text.length < 2 || text.length > 180) return undefined;
  if (shouldIgnoreTitleText(text)) return undefined;
  const href = row.querySelector<HTMLAnchorElement>('a[href]')?.href ?? undefined;
  return { row, title, href, source };
}

function itemsFromClickableRows(root: ParentNode, source: string): HistoryItem[] {
  const seenRows = new Set<HTMLElement>();
  const output: HistoryItem[] = [];
  for (const container of historyContainers(root)) {
    if (!isElement(container)) continue;
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>(
        [
          '[data-conversation-id]',
          '[data-chat-id]',
          '[data-session-id]',
          '[class*="conversation-item"]',
          '[class*="history-item"]',
          '[class*="chat-item"]',
          '[class*="thread-item"]',
          '[class*="session-item"]',
          'li[role="button"]',
          '[role="listitem"][tabindex]',
          'div[tabindex]',
        ].join(','),
      ),
    );
    for (const row of candidates) {
      if (row.querySelector('input, textarea')) continue;
      const className = typeof row.className === 'string' ? row.className : '';
      const hasIdentity =
        row.hasAttribute('data-conversation-id') ||
        row.hasAttribute('data-chat-id') ||
        row.hasAttribute('data-session-id') ||
        /conversation|history|chat-item|thread|session|task|record/i.test(className);
      if (!hasIdentity) continue;
      const item = itemFromClickableRow(row, source);
      if (!item || seenRows.has(item.row)) continue;
      seenRows.add(item.row);
      output.push(item);
    }
  }
  return output;
}

function isLikelyPlainHistoryRow(row: HTMLElement, text: string): boolean {
  if (row.querySelector('input, textarea, select')) return false;
  if (isProfileOrAccountRow(row)) return false;
  if (row.matches('aside, nav, section, main, header, footer')) return false;
  if (row.querySelectorAll('a[href], button, [role="button"]').length > 1) return false;
  if (/^(history|recents|chat history|all chats|all conversations|today|yesterday|任务记录|历史|历史记录|所有对话|今天|昨天)$/i.test(text)) {
    return false;
  }
  if (/^(19|20)\d{2}([-/.]\d{1,2})?$/.test(text.trim())) return false;
  const childTexts = Array.from(row.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .filter((child) => !isActionElement(child) && !isMediaElement(child) && !hasMediaChild(child))
    .map((child) => normalizedText(child))
    .filter((childText) => childText.length >= 2);
  if (childTexts.length >= 2) return false;
  return true;
}

function itemsFromLabeledPlainRows(root: ParentNode, source: string, labelPattern: RegExp): HistoryItem[] {
  const output: HistoryItem[] = [];
  const seenTexts = new Set<string>();
  const containers = sidebarHistoryContainers(root);
  for (const container of containers) {
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>('button, div, li, [role="button"], [role="listitem"], [data-testid], [data-qa], [class*="item"], [class*="row"], [class*="task"], [class*="record"]'),
    );
    const label = candidates.find((candidate) => labelPattern.test(normalizedText(candidate)));
    if (!label) continue;
    if (containers.some((other) => other !== container && container.contains(other) && other.contains(label))) continue;
    for (const row of candidates) {
      if (!(label.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (source === 'minimax' && !isLeftSidebarRow(row)) continue;
      const text = normalizedText(row);
      if (text.length < 2 || text.length > 180) continue;
      if (shouldIgnoreTitleText(text)) continue;
      if (!isLikelyPlainHistoryRow(row, text)) continue;
      const key = normalizeComparableText(text);
      if (seenTexts.has(key)) continue;
      const item = itemFromClickableRow(row, source);
      if (!item) continue;
      seenTexts.add(key);
      output.push(item);
    }
  }
  return output;
}

export const chatGptAdapter: ChatbotAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',
  matches(location) {
    return hostMatches(location.hostname, 'chatgpt.com');
  },
  findHistoryItems(root) {
    return itemsFromAnchors(
      root,
      (url) => url.hostname.endsWith('chatgpt.com') && /^\/(c|g)\/[^/]+/.test(url.pathname),
      'chatgpt',
    );
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const claudeAdapter: ChatbotAdapter = {
  id: 'claude',
  name: 'Claude',
  matches(location) {
    return hostMatches(location.hostname, 'claude.ai');
  },
  findHistoryItems(root) {
    return itemsFromAnchors(root, (url) => url.hostname.endsWith('claude.ai') && /^\/chat\/[^/]+/.test(url.pathname), 'claude');
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const qwenAdapter: ChatbotAdapter = {
  id: 'qwen',
  name: 'Qwen',
  matches(location) {
    return hostMatches(location.hostname, 'qwen.ai');
  },
  findHistoryItems(root) {
    const anchorItems = itemsFromAnchors(
      root,
      (url) => url.hostname.endsWith('qwen.ai') && /^\/(chat|c)\/[^/]+/.test(url.pathname),
      'qwen',
    );
    const seenRows = new Set(anchorItems.map((item) => item.row));
    const rowItems = itemsFromLabeledPlainRows(root, 'qwen', /^(all chats|all conversations|today|yesterday|所有对话|今天|昨天|(19|20)\d{2}([-/.]\d{1,2})?)$/i).filter(
      (item) => !seenRows.has(item.row),
    );
    return [...anchorItems, ...rowItems];
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const deepSeekAdapter: ChatbotAdapter = {
  id: 'deepseek',
  name: 'DeepSeek',
  matches(location) {
    return hostMatches(location.hostname, 'chat.deepseek.com');
  },
  findHistoryItems(root) {
    const anchorItems = itemsFromAnchors(
      root,
      (url) => url.hostname.endsWith('chat.deepseek.com') && isLikelyChatHistoryUrl(url),
      'deepseek',
    );
    const seenRows = new Set(anchorItems.map((item) => item.row));
    const rowItems = itemsFromClickableRows(root, 'deepseek').filter((item) => !seenRows.has(item.row));
    return [...anchorItems, ...rowItems];
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromDeepSeek,
};

export const minimaxAdapter: ChatbotAdapter = {
  id: 'minimax',
  name: 'MiniMax',
  matches(location) {
    return (
      hostMatches(location.hostname, 'minimax.io') ||
      hostMatches(location.hostname, 'agent.minimax.com') ||
      hostMatches(location.hostname, 'agent.minimaxi.com')
    );
  },
  findHistoryItems(root) {
    const anchorItems = itemsFromSidebarAnchors(
      root,
      (url) =>
        (url.hostname.endsWith('minimax.io') || url.hostname.endsWith('minimax.com') || url.hostname.endsWith('minimaxi.com')) &&
        (/^\/(chat|conversation|thread|task)\b/.test(url.pathname) || url.searchParams.has('id')),
      'minimax',
    ).filter((item) => isLeftSidebarRow(item.row));
    const seenRows = new Set(anchorItems.map((item) => item.row));
    const rowItems = itemsFromLabeledPlainRows(root, 'minimax', /^(任务记录|task records?\b|task history\b|history\b)/i).filter(
      (item) => !seenRows.has(item.row),
    );
    return [...anchorItems, ...rowItems];
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const xiaomiAdapter: ChatbotAdapter = {
  id: 'xiaomi',
  name: 'Xiaomi MiMO',
  matches() {
    return false;
  },
  findHistoryItems() {
    return [];
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const zAiAdapter: ChatbotAdapter = {
  id: 'zai',
  name: 'Z.ai',
  matches() {
    return false;
  },
  findHistoryItems() {
    return [];
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const genericSidebarAdapter: ChatbotAdapter = {
  id: 'generic',
  name: 'Generic chatbot sidebar',
  matches() {
    return true;
  },
  findHistoryItems(root) {
    const containers = historyContainers(root);
    const seenRows = new Set<HTMLElement>();
    const output: HistoryItem[] = [];
    for (const container of containers) {
      if (!isElement(container)) continue;
      for (const anchor of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const parsed = parseHref(anchor.getAttribute('href') ?? anchor.href, root.ownerDocument?.baseURI ?? globalThis.location?.href ?? 'https://example.test/');
        if (parsed && !isLikelyChatHistoryUrl(parsed) && !/\/(chat|conversation|thread|session)\b/.test(parsed.pathname)) continue;
        const item = itemFromGenericLink(anchor, 'generic');
        if (!item || seenRows.has(item.row)) continue;
        seenRows.add(item.row);
        output.push(item);
      }
    }
    for (const item of itemsFromClickableRows(root, 'generic')) {
      if (seenRows.has(item.row)) continue;
      seenRows.add(item.row);
      output.push(item);
    }
    return output;
  },
  isCurrent: isCurrentByHref,
  getStableKey: stableKeyFromHref,
};

export const defaultAdapters: ChatbotAdapter[] = [
  chatGptAdapter,
  claudeAdapter,
  qwenAdapter,
  deepSeekAdapter,
  minimaxAdapter,
  genericSidebarAdapter,
];

export function selectAdapter(
  adapters: ChatbotAdapter[],
  location: Pick<Location, 'hostname' | 'href' | 'pathname'>,
): ChatbotAdapter | undefined {
  return adapters.find((adapter) => adapter.id !== 'generic' && adapter.matches(location)) ?? genericSidebarAdapter;
}
