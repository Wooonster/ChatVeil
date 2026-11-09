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

type DynamicMaskStyle = Extract<MaskSettings['maskStyle'], 'dissolve' | 'constellation' | 'ripple' | 'ember'>;
type DynamicParticleShape = 'dot' | 'node' | 'star' | 'dash' | 'ring' | 'mote';

interface DynamicParticle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  phase: number;
  speed: number;
  hop: number;
  length: number;
  angle: number;
  shape: DynamicParticleShape;
  scatterX: number;
  scatterY: number;
  element: SVGElement;
  lineElement?: SVGElement;
}

interface DynamicAnimationTarget {
  animationFrame(now: number): boolean;
  frameInterval(): number;
}

const MENU_ACTION_LABEL = 'Pin title unmasked';
const MENU_UNPIN_LABEL = 'Unpin title mask';
const MENU_CONTEXT_TTL_MS = 30_000;
const DISSOLVE_REVEAL_MS = 720;
const DISSOLVE_REMASK_MS = 520;
const DISSOLVE_IDLE_FRAME_MS = 34;
const DISSOLVE_VIEWPORT_MARGIN_PX = 180;
const DYNAMIC_MASK_STYLES: DynamicMaskStyle[] = ['dissolve', 'constellation', 'ripple', 'ember'];

type TitleTransition = 'revealing' | 'remasking';

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

function createTitlePinIcon(document: Document, pinAction: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const letters = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  letters.setAttribute('d', 'M4.5 4.5v14.5M4.5 14.5a4 4 0 1 0 8 0a4 4 0 1 0-8 0M15 10.5V19m0-4.5c0-2.4 1.4-4 3.8-4');
  svg.append(letters);

  if (!pinAction) {
    const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    slash.setAttribute('d', 'M3.5 3.5l17 17');
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

function setDataset(element: HTMLElement | SVGElement, name: string, value: string): void {
  element.dataset[`${DATA_PREFIX}${name}`] = value;
}

function deleteDataset(element: HTMLElement | SVGElement, name: string): void {
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

function dissolveSeedFor(hashedKey: string): string {
  const hex = hashedKey.replace(/^sha256:/, '').slice(0, 8);
  const seed = Number.parseInt(hex || '0', 16);
  return String(Number.isFinite(seed) ? seed % 6 : 0);
}

function numericSeedFor(hashedKey: string): number {
  const hex = hashedKey.replace(/^sha256:/, '').slice(0, 8);
  const seed = Number.parseInt(hex || '1f2e3d4c', 16);
  return Number.isFinite(seed) ? seed >>> 0 : 0x1f2e3d4c;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutQuart(value: number): number {
  return 1 - Math.pow(1 - value, 4);
}

function createRandom(seed: number): () => number {
  let state = seed || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let output = state;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function isDynamicMaskStyle(maskStyle: MaskSettings['maskStyle'] | undefined): maskStyle is DynamicMaskStyle {
  return DYNAMIC_MASK_STYLES.includes(maskStyle as DynamicMaskStyle);
}

class DynamicMaskScheduler {
  private readonly window: Window;
  private readonly targets = new Set<DynamicAnimationTarget>();
  private readonly lastFrameByTarget = new WeakMap<DynamicAnimationTarget, number>();
  private frameId?: number;

  constructor(window: Window) {
    this.window = window;
  }

  add(target: DynamicAnimationTarget): void {
    this.targets.add(target);
    this.schedule();
  }

  delete(target: DynamicAnimationTarget): void {
    this.targets.delete(target);
    this.lastFrameByTarget.delete(target);
    if (this.targets.size === 0 && this.frameId !== undefined) {
      this.window.cancelAnimationFrame(this.frameId);
      this.frameId = undefined;
    }
  }

  private schedule(): void {
    if (this.frameId !== undefined || this.targets.size === 0) return;
    this.frameId = this.window.requestAnimationFrame((now) => {
      this.frameId = undefined;
      for (const target of Array.from(this.targets)) {
        const lastFrame = this.lastFrameByTarget.get(target) ?? 0;
        if (now - lastFrame < target.frameInterval()) continue;
        this.lastFrameByTarget.set(target, now);
        if (!target.animationFrame(now)) this.delete(target);
      }
      this.schedule();
    });
  }
}

const dynamicSchedulers = new WeakMap<Window, DynamicMaskScheduler>();

function dynamicSchedulerFor(window: Window): DynamicMaskScheduler {
  const existing = dynamicSchedulers.get(window);
  if (existing) return existing;
  const scheduler = new DynamicMaskScheduler(window);
  dynamicSchedulers.set(window, scheduler);
  return scheduler;
}

class DynamicMaskOverlay implements DynamicAnimationTarget {
  private readonly title: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly group: SVGGElement;
  private readonly random: () => number;
  private maskStyle: DynamicMaskStyle;
  private particles: DynamicParticle[] = [];
  private mode: 'idle' | 'revealing' | 'remasking' | 'hidden' = 'hidden';
  private startedAt = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private lastSyncAt = 0;
  private cachedColor = '';
  private nextColorRefreshAt = 0;
  private viewportVisible = false;
  private intersectionObserver?: IntersectionObserver;

  constructor(title: HTMLElement, seed: number, maskStyle: DynamicMaskStyle) {
    this.title = title;
    this.random = createRandom(seed);
    this.maskStyle = maskStyle;
    this.svg = title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.group = title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.append(this.group);
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('focusable', 'false');
    setDataset(this.svg, 'ParticleLayer', 'true');
    Object.assign(this.svg.style, {
      position: 'absolute',
      left: '-0.1em',
      right: '-0.1em',
      top: '-0.42em',
      bottom: '-0.38em',
      width: 'calc(100% + 0.2em)',
      height: 'calc(100% + 0.8em)',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '1',
    });
    title.append(this.svg);
    setDataset(title, 'ParticleLayer', 'true');
    this.viewportVisible = this.isNearViewport();
    this.observeViewport();
  }

  setStyle(maskStyle: DynamicMaskStyle): void {
    if (this.maskStyle === maskStyle) return;
    this.maskStyle = maskStyle;
    this.width = 0;
    this.height = 0;
    this.group.replaceChildren();
    this.particles = [];
  }

  dispose(): void {
    this.stop();
    this.intersectionObserver?.disconnect();
    this.group.replaceChildren();
    this.particles = [];
    this.svg.remove();
    deleteDataset(this.title, 'ParticleLayer');
  }

  idle(): void {
    this.mode = 'idle';
    this.startedAt = this.now();
    if (!this.viewportVisible) {
      this.stop();
      this.group.replaceChildren();
      this.particles = [];
      return;
    }
    this.sync(true);
    this.draw(this.startedAt);
    this.start();
  }

  reveal(): void {
    this.mode = 'revealing';
    this.startedAt = this.now();
    this.viewportVisible = true;
    this.sync(true);
    this.draw(this.startedAt);
    this.start();
  }

  remask(): void {
    this.mode = 'remasking';
    this.startedAt = this.now();
    this.viewportVisible = true;
    this.sync(true);
    this.draw(this.startedAt);
    this.start();
  }

  hide(): void {
    this.mode = 'hidden';
    this.stop();
    this.svg.style.display = 'none';
  }

  animationFrame(now: number): boolean {
    if (this.mode === 'hidden') return false;
    if (!this.viewportVisible && this.mode === 'idle') return false;
    this.draw(now);
    return this.viewportVisible || this.mode !== 'idle';
  }

  frameInterval(): number {
    return this.mode === 'idle' ? DISSOLVE_IDLE_FRAME_MS : 0;
  }

  private start(): void {
    this.svg.style.display = '';
    const window = this.title.ownerDocument.defaultView;
    if (!window) return;
    if (this.prefersReducedMotion()) {
      this.draw();
      return;
    }
    if (!this.viewportVisible && this.mode === 'idle') return;
    dynamicSchedulerFor(window).add(this);
  }

  private stop(): void {
    const window = this.title.ownerDocument.defaultView;
    if (window) dynamicSchedulerFor(window).delete(this);
  }

  private now(): number {
    return this.title.ownerDocument.defaultView?.performance.now() ?? Date.now();
  }

  private sync(force = false, timestamp = this.now()): void {
    const now = timestamp;
    if (!force && this.particles.length > 0 && now - this.lastSyncAt < 220) return;
    this.lastSyncAt = now;
    const rect = this.title.getBoundingClientRect();
    const width = Math.max(24, rect.width);
    const height = Math.max(24, rect.height * 1.85);
    const dpr = this.title.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    if (Math.abs(width - this.width) < 1 && Math.abs(height - this.height) < 1 && dpr === this.dpr && this.particles.length > 0) {
      return;
    }

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.style.width = `${width}px`;
    this.svg.style.height = `${height}px`;
    this.particles = this.createParticles(width, height);
    this.nextColorRefreshAt = 0;
  }

  private createParticles(width: number, height: number): DynamicParticle[] {
    this.group.replaceChildren();
    if (this.maskStyle === 'constellation') return this.createConstellationParticles(width, height);
    if (this.maskStyle === 'ripple') return this.createRippleParticles(width, height);
    if (this.maskStyle === 'ember') return this.createEmberParticles(width, height);
    return this.createDissolveParticles(width, height);
  }

  private createDissolveParticles(width: number, height: number): DynamicParticle[] {
    const count = Math.round(clamp(width / 1.22, 96, 288));
    const centerY = height / 2;
    const rowGap = clamp(height * 0.27, 6, 10);
    const amplitude = clamp(height * 0.04, 0.7, 1.85);
    const particles: DynamicParticle[] = [];
    for (let index = 0; index < count; index += 1) {
      const progress = count === 1 ? 0 : (index + this.random() * 0.82) / count;
      const density = this.textDensityAt(progress);
      const wave = Math.sin(progress * Math.PI * 3 + this.random() * 0.7) + Math.cos(progress * Math.PI * 5.4) * 0.28;
      const laneRoll = this.random();
      const laneOffset = laneRoll < 0.38 ? -rowGap / 2 : laneRoll < 0.76 ? rowGap / 2 : (this.random() - 0.5) * rowGap * 0.7;
      const x = progress * width + Math.sin(progress * Math.PI * 8.5) * 1.2 + (this.random() - 0.5) * 7;
      const y = centerY + laneOffset + wave * amplitude + (this.random() - 0.5) * (2.8 + density * 2.6);
      const fromCenter = x - width / 2;
      const direction = Math.abs(fromCenter) < 1 ? (this.random() > 0.5 ? 1 : -1) : Math.sign(fromCenter);
      const circle = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('vector-effect', 'non-scaling-stroke');
      this.group.append(circle);
      particles.push({
        x,
        y,
        radius: (0.28 + this.random() * 0.62) * (0.68 + density * 0.28),
        alpha: (0.24 + this.random() * 0.5) * (0.32 + density * 0.62),
        phase: this.random() * Math.PI * 2,
        speed: 0.007 + this.random() * 0.013,
        hop: 0.72 + this.random() * 2.05,
        length: 0,
        angle: 0,
        shape: 'dot',
        scatterX: direction * (16 + this.random() * 62) + (this.random() - 0.5) * 12,
        scatterY: (y - centerY) * 0.85 + (this.random() - 0.5) * 38,
        element: circle,
      });
    }
    return particles;
  }

  private createConstellationParticles(width: number, height: number): DynamicParticle[] {
    const count = Math.round(clamp(width / 2.35, 42, 132));
    const centerY = height / 2;
    const rowGap = clamp(height * 0.28, 6.5, 11);
    const chainSize = 5;
    const chainCount = Math.ceil(count / chainSize);
    const chains = Array.from({ length: chainCount }, (_, chain) => ({
      lane: ([-0.58, -0.12, 0.42, 0.08] as const)[chain % 4] + (this.random() - 0.5) * 0.22,
      arc: clamp(height * (0.045 + this.random() * 0.07), 0.9, 3.8) * (this.random() > 0.48 ? 1 : -1),
      lean: (this.random() - 0.5) * 5.8,
      wave: (this.random() - 0.5) * 2.2,
      phase: this.random() * Math.PI * 2,
      starTail: this.random() > 0.46,
    }));
    const particles: DynamicParticle[] = [];
    for (let index = 0; index < count; index += 1) {
      const chain = Math.floor(index / chainSize);
      const local = index % chainSize;
      const chainShape = chains[chain];
      const progress = count === 1 ? 0 : (index + 0.34 + this.random() * 0.28) / count;
      const density = this.textDensityAt(progress);
      const laneOffset = (chainShape?.lane ?? 0) * rowGap;
      const localProgress = local / (chainSize - 1);
      const arc = Math.sin(localProgress * Math.PI) * (chainShape?.arc ?? 0);
      const lean = (localProgress - 0.5) * (chainShape?.lean ?? 0);
      const wave = Math.sin(progress * Math.PI * 2.4 + (chainShape?.phase ?? 0)) * (chainShape?.wave ?? 0);
      const x = progress * width + lean + Math.sin(chain * 1.7 + (chainShape?.phase ?? 0)) * 1.4 + (this.random() - 0.5) * 2.1;
      const y = centerY + laneOffset - arc + wave + (this.random() - 0.5) * (1 + density);
      const fromCenter = x - width / 2;
      const direction = Math.abs(fromCenter) < 1 ? (this.random() > 0.5 ? 1 : -1) : Math.sign(fromCenter);
      const line = local > 0 ? this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path') : undefined;
      if (line) {
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('fill', 'none');
        this.group.append(line);
      }
      const isStar = local === 0 || (local === chainSize - 1 && Boolean(chainShape?.starTail));
      const element = isStar ? this.createStarNode() : this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
      element.setAttribute('vector-effect', 'non-scaling-stroke');
      this.group.append(element);
      particles.push({
        x,
        y,
        radius: (isStar ? 1.35 + this.random() * 0.58 : 0.62 + this.random() * 0.74) * (0.76 + density * 0.22),
        alpha: (isStar ? 0.62 + this.random() * 0.3 : 0.28 + this.random() * 0.44) * (0.58 + density * 0.38),
        phase: this.random() * Math.PI * 2,
        speed: 0.0022 + this.random() * 0.0046,
        hop: 0.22 + this.random() * 0.64,
        length: 1,
        angle: -18 + this.random() * 36,
        shape: isStar ? 'star' : 'node',
        scatterX: direction * (18 + this.random() * 56) + Math.sin(progress * Math.PI * 4) * 9,
        scatterY: (y - centerY) * 0.9 + (this.random() - 0.5) * 34,
        element,
        lineElement: line,
      });
    }
    return particles;
  }

  private createStarNode(): SVGGElement {
    const group = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
    const halo = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('cx', '0');
    halo.setAttribute('cy', '0');
    halo.setAttribute('r', '2.35');
    halo.setAttribute('fill', 'none');
    halo.setAttribute('stroke', 'currentColor');
    halo.setAttribute('stroke-width', '0.24');
    halo.setAttribute('opacity', '0.36');
    const core = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    core.setAttribute('d', 'M0 -3.1 L0.74 -0.74 L3.1 0 L0.74 0.74 L0 3.1 L-0.74 0.74 L-3.1 0 L-0.74 -0.74 Z');
    core.setAttribute('stroke', 'none');
    const horizontal = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
    horizontal.setAttribute('x1', '-4.25');
    horizontal.setAttribute('x2', '4.25');
    horizontal.setAttribute('y1', '0');
    horizontal.setAttribute('y2', '0');
    const vertical = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
    vertical.setAttribute('x1', '0');
    vertical.setAttribute('x2', '0');
    vertical.setAttribute('y1', '-4.25');
    vertical.setAttribute('y2', '4.25');
    for (const ray of [horizontal, vertical]) {
      ray.setAttribute('stroke', 'currentColor');
      ray.setAttribute('stroke-width', '0.34');
      ray.setAttribute('opacity', '0.54');
      ray.setAttribute('stroke-linecap', 'round');
      ray.setAttribute('vector-effect', 'non-scaling-stroke');
    }
    group.append(halo, horizontal, vertical, core);
    return group;
  }

  private createRippleParticles(width: number, height: number): DynamicParticle[] {
    const count = Math.round(clamp(width / 2.05, 56, 168));
    const centerY = height / 2;
    const rowGap = clamp(height * 0.26, 6, 10.5);
    const laneOffsets = [-0.62, 0.08, 0.74];
    const particles: DynamicParticle[] = [];
    for (let index = 0; index < count; index += 1) {
      const progress = count === 1 ? 0 : (index + this.random() * 0.62) / count;
      const density = this.textDensityAt(progress);
      const lane = index % laneOffsets.length;
      const laneOffset = laneOffsets[lane] * rowGap;
      const x = progress * width + (this.random() - 0.5) * 3.4;
      const y =
        centerY +
        laneOffset +
        Math.sin(progress * Math.PI * 3.2 + lane * 0.76) * clamp(height * 0.044, 0.7, 1.9) +
        (this.random() - 0.5) * (1.1 + density * 1.2);
      const rect = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('vector-effect', 'non-scaling-stroke');
      this.group.append(rect);
      particles.push({
        x,
        y,
        radius: (0.42 + this.random() * 0.52) * (0.74 + density * 0.26),
        alpha: (0.18 + this.random() * 0.42) * (0.42 + density * 0.58),
        phase: this.random() * Math.PI * 2,
        speed: 0.0038 + this.random() * 0.008,
        hop: 0.32 + this.random() * 0.82,
        length: (4.2 + this.random() * 5.8) * (0.82 + density * 0.28),
        angle: (this.random() - 0.5) * 5.2,
        shape: 'dash',
        scatterX: (this.random() - 0.5) * 42 + Math.sin(progress * Math.PI * 2) * 12,
        scatterY: (laneOffset >= 0 ? 1 : -1) * (10 + this.random() * 26) + (this.random() - 0.5) * 9,
        element: rect,
      });
    }
    return particles;
  }

  private createEmberParticles(width: number, height: number): DynamicParticle[] {
    const count = Math.round(clamp(width / 1.42, 74, 220));
    const centerY = height / 2;
    const rowGap = clamp(height * 0.29, 6.5, 11.5);
    const lanes = [-0.64, -0.18, 0.28, 0.72];
    const particles: DynamicParticle[] = [];
    for (let index = 0; index < count; index += 1) {
      const progress = count === 1 ? 0 : (index + this.random() * 0.82) / count;
      const density = this.textDensityAt(progress);
      const roll = this.random();
      const shape: DynamicParticleShape = roll < 0.58 ? 'ring' : 'mote';
      const lane = lanes[index % lanes.length] + (this.random() - 0.5) * 0.16;
      const plume = Math.sin(progress * Math.PI * 4.1 + lane * 1.7 + this.random() * 0.8);
      const x = progress * width + Math.sin(progress * Math.PI * 5.2) * 1.6 + (this.random() - 0.5) * 5.8;
      const y =
        centerY +
        lane * rowGap +
        plume * clamp(height * 0.052, 0.9, 2.35) +
        Math.sin(progress * Math.PI * 2.8 + this.random()) * clamp(height * 0.03, 0.5, 1.25) +
        (this.random() - 0.5) * (1.8 + density * 1.2);
      const element = this.title.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
      element.setAttribute('vector-effect', 'non-scaling-stroke');
      if (shape === 'ring') {
        element.setAttribute('stroke', 'currentColor');
        element.setAttribute('fill', 'none');
      } else {
        element.setAttribute('stroke', 'none');
      }
      this.group.append(element);
      const fromCenter = x - width / 2;
      const direction = Math.abs(fromCenter) < 1 ? (this.random() > 0.5 ? 1 : -1) : Math.sign(fromCenter);
      particles.push({
        x,
        y,
        radius: (shape === 'ring' ? 0.82 + this.random() * 1.08 : 0.32 + this.random() * 0.58) * (0.72 + density * 0.26),
        alpha: (shape === 'ring' ? 0.18 + this.random() * 0.34 : 0.2 + this.random() * 0.4) * (0.44 + density * 0.52),
        phase: this.random() * Math.PI * 2,
        speed: 0.0048 + this.random() * 0.0105,
        hop: (shape === 'ring' ? 0.7 + this.random() * 1.8 : 0.5 + this.random() * 1.5) * (0.86 + density * 0.22),
        length: (shape === 'ring' ? 2.6 + this.random() * 3.8 : 1.4 + this.random() * 2.6) * (0.82 + density * 0.22),
        angle: this.random() * Math.PI * 2,
        shape,
        scatterX: direction * (18 + this.random() * 48) + Math.cos(progress * Math.PI * 4 + lane) * 10,
        scatterY: (y - centerY) * 0.46 + Math.sin(progress * Math.PI * 3 + lane) * 14 - (shape === 'ring' ? 8 + this.random() * 18 : 5 + this.random() * 14),
        element,
      });
    }
    return particles;
  }

  private textDensityAt(progress: number): number {
    const characters = Array.from((this.title.textContent ?? '').trim());
    if (characters.length < 4) return 1;
    const index = clamp(Math.floor(progress * characters.length), 0, characters.length - 1);
    const window = characters.slice(Math.max(0, index - 1), Math.min(characters.length, index + 2));
    if (window.every((character) => /\s/.test(character))) return 0.18;
    if (window.some((character) => /\s/.test(character))) return 0.48;
    if (/[.,:;!?，。！？、]/.test(characters[index] ?? '')) return 0.68;
    return 1;
  }

  private draw(timestamp = this.now()): void {
    this.sync(false, timestamp);
    const elapsed = timestamp - this.startedAt;
    const duration = this.mode === 'revealing' ? DISSOLVE_REVEAL_MS : this.mode === 'remasking' ? DISSOLVE_REMASK_MS : 1;
    const progress = clamp(elapsed / duration, 0, 1);
    const eased = easeOutQuart(progress);
    const idleTime = timestamp;

    const color = this.particleColor(idleTime);
    this.group.setAttribute('fill', color);
    this.group.style.color = color;
    if (this.maskStyle === 'constellation') {
      this.drawConstellation(idleTime, eased);
      return;
    }
    if (this.maskStyle === 'ripple') {
      this.drawRipple(idleTime, eased);
      return;
    }
    if (this.maskStyle === 'ember') {
      this.drawEmber(idleTime, eased);
      return;
    }
    this.drawDissolve(idleTime, eased);
  }

  private transitionScalars(eased: number): { scatter: number; alphaScale: number; radiusScale: number } {
    if (this.mode === 'revealing') {
      return {
        scatter: eased,
        alphaScale: Math.pow(1 - eased, 0.72),
        radiusScale: 1 + eased * 0.45,
      };
    }
    if (this.mode === 'remasking') {
      const scatter = 1 - eased;
      return {
        scatter,
        alphaScale: Math.max(0.18, eased),
        radiusScale: 1 + scatter * 0.42,
      };
    }
    return { scatter: 0, alphaScale: 1, radiusScale: 1 };
  }

  private drawDissolve(idleTime: number, eased: number): void {
    const { scatter, alphaScale, radiusScale } = this.transitionScalars(eased);
    for (const particle of this.particles) {
      const wave = Math.sin(idleTime * particle.speed + particle.phase);
      const drift = Math.cos(idleTime * particle.speed * 0.58 + particle.phase);
      const shimmer = Math.sin(idleTime * particle.speed * 2.35 + particle.phase * 0.7);
      const jitterX = wave * 1.12 + drift * 0.52;
      const jitterY = drift * 0.78 - Math.max(0, wave) * particle.hop + shimmer * 0.24;
      const x = particle.x + jitterX + particle.scatterX * scatter;
      const y = particle.y + jitterY + particle.scatterY * scatter;
      const alpha = particle.alpha * alphaScale * (0.9 + shimmer * 0.1);
      if (alpha <= 0.015) {
        particle.element.setAttribute('opacity', '0');
        continue;
      }
      particle.element.setAttribute('cx', x.toFixed(2));
      particle.element.setAttribute('cy', y.toFixed(2));
      particle.element.setAttribute('r', (particle.radius * radiusScale * (1 + shimmer * 0.045)).toFixed(2));
      particle.element.setAttribute('opacity', alpha.toFixed(3));
    }
  }

  private drawConstellation(idleTime: number, eased: number): void {
    const { scatter, alphaScale, radiusScale } = this.transitionScalars(eased);
    const positions: { x: number; y: number; alpha: number }[] = [];
    for (const particle of this.particles) {
      const orbit = Math.sin(idleTime * particle.speed + particle.phase);
      const counter = Math.cos(idleTime * particle.speed * 0.72 + particle.phase);
      const pulse = Math.sin(idleTime * particle.speed * 1.8 + particle.phase);
      const x = particle.x + orbit * 0.72 + counter * 0.32 + particle.scatterX * scatter;
      const y = particle.y + counter * 0.62 - Math.max(0, orbit) * particle.hop * 0.42 + particle.scatterY * scatter;
      const alpha = particle.alpha * alphaScale * (0.88 + pulse * 0.12);
      positions.push({ x, y, alpha });
      if (alpha <= 0.015) {
        particle.element.setAttribute('opacity', '0');
        particle.lineElement?.setAttribute('opacity', '0');
        continue;
      }
      if (particle.shape === 'star') {
        const starScale = radiusScale * (0.68 + Math.max(0, pulse) * 0.12);
        particle.element.setAttribute(
          'transform',
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(particle.angle + orbit * 7).toFixed(2)}) scale(${starScale.toFixed(2)})`,
        );
      } else {
        particle.element.setAttribute('cx', x.toFixed(2));
        particle.element.setAttribute('cy', y.toFixed(2));
        particle.element.setAttribute('r', (particle.radius * radiusScale * (1 + pulse * 0.055)).toFixed(2));
      }
      particle.element.setAttribute('opacity', alpha.toFixed(3));
    }
    for (let index = 1; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      if (!particle.lineElement) continue;
      const previous = positions[index - 1];
      const current = positions[index];
      if (!previous || !current || previous.alpha <= 0.02 || current.alpha <= 0.02) {
        particle.lineElement.setAttribute('opacity', '0');
        continue;
      }
      const bow = (particle.angle / 18) * (1 - scatter * 0.56);
      const midX = (previous.x + current.x) / 2;
      const midY = (previous.y + current.y) / 2 - bow;
      const lineAlpha = Math.min(previous.alpha, current.alpha) * 0.22 * (1 - scatter * 0.86);
      particle.lineElement.setAttribute(
        'd',
        `M ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${current.x.toFixed(2)} ${current.y.toFixed(2)}`,
      );
      particle.lineElement.setAttribute('stroke-width', (0.24 + particle.radius * 0.08).toFixed(2));
      particle.lineElement.setAttribute('opacity', Math.max(0, lineAlpha).toFixed(3));
    }
  }

  private drawRipple(idleTime: number, eased: number): void {
    const { scatter, alphaScale, radiusScale } = this.transitionScalars(eased);
    for (const particle of this.particles) {
      const wave = Math.sin(idleTime * particle.speed + particle.phase + particle.x * 0.018);
      const cross = Math.cos(idleTime * particle.speed * 0.65 + particle.phase);
      const shimmer = Math.sin(idleTime * particle.speed * 2.1 + particle.phase);
      const x = particle.x + cross * 0.52 + particle.scatterX * scatter;
      const y = particle.y + wave * (1.05 + particle.hop * 0.22) + particle.scatterY * scatter;
      const dashWidth = particle.length * (1 + Math.max(0, wave) * 0.12 + scatter * 0.2);
      const dashHeight = particle.radius * radiusScale * (1.05 + shimmer * 0.05);
      const alpha = particle.alpha * alphaScale * (0.82 + Math.max(0, shimmer) * 0.14);
      if (alpha <= 0.015) {
        particle.element.setAttribute('opacity', '0');
        continue;
      }
      particle.element.setAttribute('x', (x - dashWidth / 2).toFixed(2));
      particle.element.setAttribute('y', (y - dashHeight / 2).toFixed(2));
      particle.element.setAttribute('width', dashWidth.toFixed(2));
      particle.element.setAttribute('height', dashHeight.toFixed(2));
      particle.element.setAttribute('rx', (dashHeight / 2).toFixed(2));
      particle.element.setAttribute('opacity', alpha.toFixed(3));
      particle.element.setAttribute('transform', `rotate(${(particle.angle + wave * 1.8).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})`);
    }
  }

  private drawEmber(idleTime: number, eased: number): void {
    const { scatter, alphaScale, radiusScale } = this.transitionScalars(eased);
    for (const particle of this.particles) {
      const breath = Math.sin(idleTime * particle.speed + particle.phase);
      const counter = Math.cos(idleTime * particle.speed * 0.68 + particle.phase * 1.42);
      const pulse = Math.sin(idleTime * particle.speed * 1.7 + particle.phase * 0.74);
      const swirl = Math.sin(idleTime * particle.speed * 0.38 + particle.angle);
      const x = particle.x + counter * 0.58 + swirl * 0.38 + particle.scatterX * scatter;
      const y =
        particle.y -
        Math.max(0, breath) * particle.hop * (particle.shape === 'ring' ? 0.44 : 0.58) +
        pulse * (particle.shape === 'ring' ? 0.2 : 0.28) +
        particle.scatterY * scatter;
      const expand = 1 + scatter * (particle.shape === 'ring' ? 1.18 : 0.62);
      const alpha = particle.alpha * alphaScale * (0.72 + Math.max(0, pulse) * 0.24 + Math.max(0, breath) * 0.08);
      if (alpha <= 0.015) {
        particle.element.setAttribute('opacity', '0');
        continue;
      }
      particle.element.setAttribute('cx', x.toFixed(2));
      particle.element.setAttribute('cy', y.toFixed(2));
      particle.element.setAttribute('r', (particle.radius * radiusScale * expand * (1 + Math.max(0, pulse) * 0.12)).toFixed(2));
      if (particle.shape === 'ring') {
        particle.element.setAttribute('stroke-width', (0.22 + particle.radius * 0.16 + scatter * 0.08).toFixed(2));
      }
      particle.element.setAttribute('opacity', alpha.toFixed(3));
    }
  }

  private particleColor(now: number): string {
    if (this.cachedColor && now < this.nextColorRefreshAt) return this.cachedColor;
    this.cachedColor = this.resolveParticleColor();
    this.nextColorRefreshAt = now + 250;
    return this.cachedColor;
  }

  private resolveParticleColor(): string {
    const window = this.title.ownerDocument.defaultView;
    const isVisibleColor = (value: string | undefined) =>
      Boolean(value && !/transparent|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(value));
    let current: Element | null = this.title;
    while (window && current) {
      const color = window.getComputedStyle(current).color;
      if (isVisibleColor(color)) return color;
      current = current.parentElement;
    }
    return window?.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'rgba(226, 232, 240, 0.82)'
      : 'rgba(17, 24, 39, 0.88)';
  }

  private prefersReducedMotion(): boolean {
    return this.title.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private observeViewport(): void {
    const window = this.title.ownerDocument.defaultView;
    if (!window || !('IntersectionObserver' in window)) return;
    this.intersectionObserver = new window.IntersectionObserver(
      ([entry]) => {
        this.viewportVisible = Boolean(entry?.isIntersecting);
        if (this.viewportVisible && this.mode !== 'hidden') {
          this.sync(true);
          this.draw(this.now());
          this.start();
          return;
        }
        if (this.mode === 'idle') {
          this.stop();
          this.group.replaceChildren();
          this.particles = [];
        }
      },
      {
        root: null,
        rootMargin: `${DISSOLVE_VIEWPORT_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );
    this.intersectionObserver.observe(this.title);
  }

  private isNearViewport(): boolean {
    const window = this.title.ownerDocument.defaultView;
    if (!window) return true;
    const rect = this.title.getBoundingClientRect();
    const margin = DISSOLVE_VIEWPORT_MARGIN_PX;
    return rect.bottom >= -margin && rect.top <= window.innerHeight + margin && rect.right >= -margin && rect.left <= window.innerWidth + margin;
  }
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
  opacity: 0.72;
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
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"] {
  color: inherit !important;
  -webkit-text-fill-color: transparent !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="constellation"],
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="ripple"],
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="ember"] {
  color: inherit !important;
  -webkit-text-fill-color: transparent !important;
  filter: none !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"] {
  color: inherit !important;
  -webkit-text-fill-color: transparent !important;
  filter: none !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="constellation"][data-${DATA_PREFIX}-transition="revealing"],
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="ripple"][data-${DATA_PREFIX}-transition="revealing"],
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="ember"][data-${DATA_PREFIX}-transition="revealing"] {
  color: inherit !important;
  -webkit-text-fill-color: transparent !important;
  filter: none !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"] {
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
  filter: none !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="constellation"][data-${DATA_PREFIX}-transition="remasking"],
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="ripple"][data-${DATA_PREFIX}-transition="remasking"],
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="ember"][data-${DATA_PREFIX}-transition="remasking"] {
  color: inherit !important;
  -webkit-text-fill-color: currentColor !important;
  filter: none !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"]::after,
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::after,
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::after {
  content: "" !important;
  position: absolute !important;
  left: -0.04em !important;
  right: -0.04em !important;
  top: -0.22em !important;
  bottom: -0.2em !important;
  height: auto !important;
  min-height: 1.38em !important;
  min-width: 3.5em !important;
  transform: translate3d(0, 0, 0) scale(1);
  border-radius: 2px !important;
  color: color-mix(in srgb, currentColor 98%, transparent) !important;
  background-color: transparent !important;
  background-image:
    radial-gradient(circle at 4% 28%, currentColor 0 1px, transparent 1.38px),
    radial-gradient(circle at 9% 62%, currentColor 0 0.72px, transparent 1.06px),
    radial-gradient(circle at 14% 44%, currentColor 0 1.18px, transparent 1.54px),
    radial-gradient(circle at 19% 78%, currentColor 0 0.8px, transparent 1.14px),
    radial-gradient(circle at 25% 35%, currentColor 0 0.94px, transparent 1.3px),
    radial-gradient(circle at 31% 58%, currentColor 0 1.14px, transparent 1.5px),
    radial-gradient(circle at 36% 22%, currentColor 0 0.68px, transparent 1.02px),
    radial-gradient(circle at 42% 72%, currentColor 0 1.04px, transparent 1.4px),
    radial-gradient(circle at 48% 48%, currentColor 0 0.78px, transparent 1.12px),
    radial-gradient(circle at 54% 30%, currentColor 0 1.16px, transparent 1.52px),
    radial-gradient(circle at 59% 82%, currentColor 0 0.74px, transparent 1.08px),
    radial-gradient(circle at 65% 54%, currentColor 0 0.96px, transparent 1.32px),
    radial-gradient(circle at 71% 38%, currentColor 0 1.22px, transparent 1.58px),
    radial-gradient(circle at 77% 68%, currentColor 0 0.78px, transparent 1.12px),
    radial-gradient(circle at 83% 25%, currentColor 0 1.06px, transparent 1.42px),
    radial-gradient(circle at 89% 57%, currentColor 0 0.7px, transparent 1.04px),
    radial-gradient(circle at 95% 42%, currentColor 0 0.98px, transparent 1.34px) !important;
  background-size: 62px 1.42em !important;
  background-position: 0 0;
  box-shadow: none !important;
  mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%) !important;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8%, #000 92%, transparent 100%) !important;
  opacity: 0.98;
  pointer-events: none !important;
  z-index: 1 !important;
  mix-blend-mode: normal !important;
  filter: contrast(1.18) saturate(0);
  animation: chatveil-dissolve-hop-a 1120ms cubic-bezier(0.45, 0, 0.2, 1) infinite alternate !important;
  will-change: opacity, transform, background-position, filter !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"]::before,
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::before,
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::before {
  content: "" !important;
  position: absolute !important;
  left: -0.06em !important;
  right: -0.06em !important;
  top: -0.24em !important;
  bottom: -0.18em !important;
  min-height: 1.38em !important;
  min-width: 3.5em !important;
  color: color-mix(in srgb, currentColor 78%, transparent) !important;
  background-color: transparent !important;
  background-image:
    radial-gradient(circle at 3% 52%, currentColor 0 0.54px, transparent 0.86px),
    radial-gradient(circle at 10% 25%, currentColor 0 0.64px, transparent 0.98px),
    radial-gradient(circle at 16% 75%, currentColor 0 0.46px, transparent 0.78px),
    radial-gradient(circle at 23% 43%, currentColor 0 0.58px, transparent 0.92px),
    radial-gradient(circle at 29% 66%, currentColor 0 0.7px, transparent 1.04px),
    radial-gradient(circle at 35% 34%, currentColor 0 0.5px, transparent 0.82px),
    radial-gradient(circle at 41% 86%, currentColor 0 0.6px, transparent 0.94px),
    radial-gradient(circle at 48% 56%, currentColor 0 0.46px, transparent 0.78px),
    radial-gradient(circle at 55% 21%, currentColor 0 0.62px, transparent 0.96px),
    radial-gradient(circle at 61% 73%, currentColor 0 0.52px, transparent 0.84px),
    radial-gradient(circle at 68% 45%, currentColor 0 0.66px, transparent 1px),
    radial-gradient(circle at 74% 82%, currentColor 0 0.5px, transparent 0.82px),
    radial-gradient(circle at 81% 36%, currentColor 0 0.58px, transparent 0.92px),
    radial-gradient(circle at 88% 63%, currentColor 0 0.48px, transparent 0.8px),
    radial-gradient(circle at 96% 30%, currentColor 0 0.54px, transparent 0.88px) !important;
  background-size: 54px 1.5em !important;
  background-position: 9px 0;
  border-radius: 2px !important;
  opacity: 0.84;
  pointer-events: none !important;
  z-index: 1 !important;
  mix-blend-mode: normal !important;
  filter: contrast(1.1) saturate(0);
  mask-image: linear-gradient(90deg, transparent 0, #000 7%, #000 93%, transparent 100%) !important;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 7%, #000 93%, transparent 100%) !important;
  animation: chatveil-dissolve-hop-b 860ms cubic-bezier(0.4, 0, 0.22, 1) infinite alternate-reverse !important;
  will-change: opacity, transform, background-position, filter !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="1"]::after {
  background-size: 81px 1.2em !important;
  background-position: 11px -1px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="1"]::before {
  background-size: 66px 1.12em !important;
  background-position: 3px 1px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="2"]::after {
  background-size: 70px 1.16em !important;
  background-position: -8px 2px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="2"]::before {
  background-size: 59px 1.18em !important;
  background-position: 15px -2px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="3"]::after {
  background-size: 87px 1.19em !important;
  background-position: 18px 1px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="3"]::before {
  background-size: 71px 1.1em !important;
  background-position: -6px 2px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="4"]::after {
  background-size: 76px 1.22em !important;
  background-position: 6px -3px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="4"]::before {
  background-size: 64px 1.13em !important;
  background-position: 21px 1px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="5"]::after {
  background-size: 83px 1.17em !important;
  background-position: -13px 2px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-seed="5"]::before {
  background-size: 68px 1.16em !important;
  background-position: 8px -2px;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::after {
  animation: chatveil-dissolve-scatter-a ${DISSOLVE_REVEAL_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::before {
  animation: chatveil-dissolve-scatter-b ${DISSOLVE_REVEAL_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::after {
  animation: chatveil-dissolve-gather-a ${DISSOLVE_REMASK_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::before {
  animation: chatveil-dissolve-gather-b ${DISSOLVE_REMASK_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards !important;
}
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-particle-layer="true"]::after,
[data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-particle-layer="true"]::before {
  display: none !important;
}
[data-${DATA_PREFIX}-title="true"] > [data-${DATA_PREFIX}-particle-layer="true"] {
  color: inherit !important;
  contain: layout paint style !important;
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
  gap: var(--chatveil-menu-gap, 6px) !important;
  width: 100% !important;
  min-height: var(--chatveil-menu-height, 40px) !important;
  box-sizing: border-box !important;
  border: 0 !important;
  border-radius: var(--chatveil-menu-radius, 6px) !important;
  padding: var(--chatveil-menu-padding, 8px 10px) !important;
  color: var(--chatveil-menu-color, inherit) !important;
  background: transparent !important;
  font-family: var(--chatveil-menu-font-family, inherit) !important;
  font-size: var(--chatveil-menu-font-size, inherit) !important;
  font-style: var(--chatveil-menu-font-style, inherit) !important;
  font-weight: var(--chatveil-menu-font-weight, inherit) !important;
  line-height: var(--chatveil-menu-line-height, inherit) !important;
  letter-spacing: var(--chatveil-menu-letter-spacing, normal) !important;
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
  width: var(--chatveil-menu-icon-size, 20px) !important;
  flex: 0 0 var(--chatveil-menu-icon-size, 20px) !important;
  align-items: center !important;
  justify-content: center !important;
  color: inherit !important;
}
[data-${DATA_PREFIX}-menu-action-icon="true"] svg {
  display: block !important;
  width: var(--chatveil-menu-glyph-size, 16px) !important;
  height: var(--chatveil-menu-glyph-size, 16px) !important;
  min-width: var(--chatveil-menu-glyph-size, 16px) !important;
  min-height: var(--chatveil-menu-glyph-size, 16px) !important;
  max-width: var(--chatveil-menu-glyph-size, 16px) !important;
  max-height: var(--chatveil-menu-glyph-size, 16px) !important;
  flex: none !important;
}
@keyframes chatveil-dissolve-hop-a {
  0% {
    opacity: 0.9;
    background-position: 0 0;
    transform: translate3d(0, 0, 0) scale(1);
  }
  18% {
    opacity: 0.96;
    background-position: 3px -1px;
    transform: translate3d(0.3px, -0.7px, 0) scale(1.01);
  }
  39% {
    opacity: 0.86;
    background-position: -2px 2px;
    transform: translate3d(-0.4px, 0.5px, 0) scale(0.995);
  }
  64% {
    opacity: 0.98;
    background-position: 5px 1px;
    transform: translate3d(0.8px, -0.2px, 0) scale(1.006);
  }
  100% {
    opacity: 0.91;
    background-position: -1px -1px;
    transform: translate3d(0, 0.4px, 0) scale(1);
  }
}
@keyframes chatveil-dissolve-hop-b {
  0% {
    opacity: 0.62;
    background-position: 9px 0;
    transform: translate3d(0, 0, 0);
  }
  24% {
    opacity: 0.78;
    background-position: 5px 2px;
    transform: translate3d(-0.5px, -0.3px, 0);
  }
  52% {
    opacity: 0.54;
    background-position: 13px -2px;
    transform: translate3d(0.4px, 0.6px, 0);
  }
  78% {
    opacity: 0.74;
    background-position: 6px 3px;
    transform: translate3d(0.7px, -0.6px, 0);
  }
  100% {
    opacity: 0.66;
    background-position: 10px -1px;
    transform: translate3d(0, 0.2px, 0);
  }
}
@keyframes chatveil-dissolve-scatter-a {
  0% {
    opacity: 0.96;
    transform: translate3d(0, 0, 0) scale(1);
    background-position: 0 0;
    filter: contrast(1.18) saturate(0);
  }
  34% {
    opacity: 0.78;
    transform: translate3d(3px, -1px, 0) scaleX(1.018);
    background-position: 9px -3px;
    filter: blur(0.16px) contrast(1.32) saturate(0);
  }
  68% {
    opacity: 0.36;
    transform: translate3d(9px, -2px, 0) scaleX(1.04);
    background-position: 24px -6px;
    filter: blur(0.45px) contrast(1.5) saturate(0);
  }
  100% {
    opacity: 0;
    transform: translate3d(18px, -4px, 0) scaleX(1.075);
    background-position: 44px -10px;
    filter: blur(1.4px) contrast(1.82) saturate(0);
  }
}
@keyframes chatveil-dissolve-scatter-b {
  0% {
    opacity: 0.72;
    transform: translate3d(0, 0, 0) scale(1);
    background-position: 9px 0;
    filter: contrast(1.1) saturate(0);
  }
  42% {
    opacity: 0.52;
    transform: translate3d(-4px, 2px, 0) scaleX(1.025);
    background-position: -3px 4px;
    filter: blur(0.2px) contrast(1.32) saturate(0);
  }
  100% {
    opacity: 0;
    transform: translate3d(-14px, 5px, 0) scaleX(1.08);
    background-position: -22px 8px;
    filter: blur(1px) contrast(1.7) saturate(0);
  }
}
@keyframes chatveil-dissolve-gather-a {
  0% {
    opacity: 0;
    transform: translate3d(14px, -4px, 0) scaleX(1.07);
    background-position: 40px -9px;
    filter: blur(1.1px) contrast(1.65) saturate(0);
  }
  38% {
    opacity: 0.42;
    transform: translate3d(7px, -2px, 0) scaleX(1.035);
    background-position: 22px -5px;
    filter: blur(0.42px) contrast(1.42) saturate(0);
  }
  72% {
    opacity: 0.82;
    transform: translate3d(2px, -0.4px, 0) scaleX(1.012);
    background-position: 6px -2px;
    filter: blur(0.12px) contrast(1.26) saturate(0);
  }
  100% {
    opacity: 0.95;
    transform: translate3d(0, 0, 0) scale(1);
    background-position: 0 0;
    filter: contrast(1.18) saturate(0);
  }
}
@keyframes chatveil-dissolve-gather-b {
  0% {
    opacity: 0;
    transform: translate3d(-12px, 5px, 0) scaleX(1.06);
    background-position: -18px 8px;
    filter: blur(0.9px) contrast(1.5) saturate(0);
  }
  55% {
    opacity: 0.36;
    transform: translate3d(-5px, 2px, 0) scaleX(1.024);
    background-position: -7px 4px;
    filter: blur(0.25px) contrast(1.28) saturate(0);
  }
  100% {
    opacity: 0.72;
    transform: translate3d(0, 0, 0) scale(1);
    background-position: 9px 0;
    filter: contrast(1.1) saturate(0);
  }
}
@media (prefers-color-scheme: dark) {
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"]::before,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::before,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::before {
    color: color-mix(in srgb, currentColor 76%, transparent) !important;
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-state="masked"][data-${DATA_PREFIX}-style="dissolve"]::before,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::before,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::before {
    animation: none !important;
    transition: opacity 120ms ease !important;
  }
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="revealing"]::before {
    opacity: 0 !important;
  }
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::after,
  [data-${DATA_PREFIX}-title="true"][data-${DATA_PREFIX}-style="dissolve"][data-${DATA_PREFIX}-transition="remasking"]::before {
    opacity: 0.9 !important;
  }
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
  private readonly titleTransitionTimers = new WeakMap<HTMLElement, number>();
  private readonly dynamicOverlays = new WeakMap<HTMLElement, DynamicMaskOverlay>();
  private readonly activeRevealKeys = new Set<string>();
  private readonly documentMenuListener = (event: Event) => {
    this.rememberMenuRowFromDocument(event);
  };
  private lastMenuRow?: HTMLElement;
  private lastMenuRowAt = 0;
  private lastMenuTrigger?: HTMLElement;
  private associatedMenu?: HTMLElement;
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
      await this.rescan();
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
    this.cleanupMenuActions([]);
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
    const domElementCtor = this.document.defaultView?.Element;
    if (!domElementCtor) return false;
    for (const record of records) {
      if (record.type === 'childList') {
        const target = record.target;
        if (target instanceof domElementCtor && target.closest(`[data-${DATA_PREFIX}-particle-layer="true"], [data-${DATA_PREFIX}-menu-action="true"]`)) continue;
        const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
        if (
          changedNodes.some(
            (node) => !(node instanceof domElementCtor) || !node.matches(`[data-${DATA_PREFIX}-menu-action="true"], [data-${DATA_PREFIX}-particle-layer="true"]`),
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
      deleteDataset(element, 'Seed');
      this.clearTitleTransition(element);
      this.removeDynamicOverlay(element);
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
      this.cleanupMenuActions([]);
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
        deleteDataset(element, 'Seed');
        this.clearTitleTransition(element);
        this.removeDynamicOverlay(element);
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
    setDataset(item.title, 'Seed', dissolveSeedFor(hashedKey));
    this.clearTitleTransition(item.title);
    this.applyTitleClipState(item.title, isVisible ? 'visible' : 'masked');
    this.syncDynamicOverlay(item.title, settings.maskStyle, hashedKey, isVisible ? 'visible' : 'masked');
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
    const transition = this.shouldAnimateDynamicMask(binding.title, 'revealing') ? 'revealing' : undefined;
    this.setBoundTitleState(binding, 'visible', transition);
  }

  private maskRow(row: HTMLElement): void {
    if (this.stopped) return;
    const binding = this.rowBindings.get(row);
    if (!binding) return;
    this.activeRevealKeys.delete(binding.hashedKey);
    if (this.shouldKeepBoundTitleVisible(binding)) {
      this.setBoundTitleState(binding, 'visible');
      return;
    }
    const transition = this.shouldAnimateDynamicMask(binding.title, 'remasking') ? 'remasking' : undefined;
    this.setBoundTitleState(binding, 'masked', transition);
  }

  private setBoundTitleState(binding: BoundEngineItem, state: 'visible' | 'masked', transition?: TitleTransition): void {
    if (!this.document.documentElement.contains(binding.title)) return;
    if (transition === 'revealing') {
      this.startRevealTransition(binding);
      return;
    }
    if (transition === 'remasking') {
      this.startRemaskTransition(binding);
      return;
    }
    this.clearTitleTransition(binding.title);
    setDataset(binding.title, 'State', state);
    this.applyTitleClipState(binding.title, state);
    this.syncBoundDynamicOverlay(binding, state);
  }

  private shouldAnimateDynamicMask(title: HTMLElement, transition: TitleTransition): boolean {
    if (!isDynamicMaskStyle(title.dataset[`${DATA_PREFIX}Style`] as MaskSettings['maskStyle'] | undefined)) return false;
    if (transition === 'revealing') {
      return title.dataset[`${DATA_PREFIX}State`] === 'masked' || title.dataset[`${DATA_PREFIX}Transition`] === 'remasking';
    }
    return title.dataset[`${DATA_PREFIX}State`] === 'visible' || title.dataset[`${DATA_PREFIX}Transition`] === 'revealing';
  }

  private startRevealTransition(binding: BoundEngineItem): void {
    const { title } = binding;
    const wasRemaskingVisible =
      title.dataset[`${DATA_PREFIX}State`] === 'visible' && title.dataset[`${DATA_PREFIX}Transition`] === 'remasking';
    this.clearTitleTransition(title);
    setDataset(title, 'State', wasRemaskingVisible ? 'visible' : 'masked');
    setDataset(title, 'Transition', 'revealing');
    this.applyTitleClipState(title, wasRemaskingVisible ? 'visible' : 'masked');
    this.getDynamicOverlay(title)?.reveal();
    this.scheduleTitleTransition(title, DISSOLVE_REVEAL_MS, () => {
      if (this.stopped || !this.document.documentElement.contains(title)) return;
      if (title.dataset[`${DATA_PREFIX}Transition`] !== 'revealing') return;
      deleteDataset(title, 'Transition');
      const nextState = this.shouldKeepBoundTitleVisible(binding) ? 'visible' : 'masked';
      setDataset(title, 'State', nextState);
      this.applyTitleClipState(title, nextState);
      this.syncBoundDynamicOverlay(binding, nextState);
    });
  }

  private startRemaskTransition(binding: BoundEngineItem): void {
    const { title } = binding;
    const wasVisible = title.dataset[`${DATA_PREFIX}State`] === 'visible' && title.dataset[`${DATA_PREFIX}Transition`] !== 'revealing';
    this.clearTitleTransition(title);
    setDataset(title, 'State', wasVisible ? 'visible' : 'masked');
    setDataset(title, 'Transition', 'remasking');
    this.applyTitleClipState(title, wasVisible ? 'visible' : 'masked');
    this.getDynamicOverlay(title)?.remask();
    this.scheduleTitleTransition(title, DISSOLVE_REMASK_MS, () => {
      if (this.stopped || !this.document.documentElement.contains(title)) return;
      if (title.dataset[`${DATA_PREFIX}Transition`] !== 'remasking') return;
      deleteDataset(title, 'Transition');
      const nextState = this.shouldKeepBoundTitleVisible(binding) ? 'visible' : 'masked';
      setDataset(title, 'State', nextState);
      this.applyTitleClipState(title, nextState);
      this.syncBoundDynamicOverlay(binding, nextState);
    });
  }

  private syncBoundDynamicOverlay(binding: BoundEngineItem, state: 'visible' | 'masked'): void {
    this.syncDynamicOverlay(
      binding.title,
      (binding.title.dataset[`${DATA_PREFIX}Style`] as MaskSettings['maskStyle'] | undefined) ?? 'dissolve',
      binding.hashedKey,
      state,
    );
  }

  private syncDynamicOverlay(
    title: HTMLElement,
    maskStyle: MaskSettings['maskStyle'],
    hashedKey: string,
    state: 'visible' | 'masked',
  ): void {
    if (!isDynamicMaskStyle(maskStyle) || isJsdomDocument(this.document)) {
      this.removeDynamicOverlay(title);
      return;
    }
    if (state === 'visible') {
      this.getDynamicOverlay(title)?.hide();
      return;
    }
    this.ensureDynamicOverlay(title, numericSeedFor(hashedKey), maskStyle).idle();
  }

  private ensureDynamicOverlay(title: HTMLElement, seed: number, maskStyle: DynamicMaskStyle): DynamicMaskOverlay {
    const existing = this.dynamicOverlays.get(title);
    if (existing) {
      existing.setStyle(maskStyle);
      return existing;
    }
    const overlay = new DynamicMaskOverlay(title, seed, maskStyle);
    this.dynamicOverlays.set(title, overlay);
    return overlay;
  }

  private getDynamicOverlay(title: HTMLElement): DynamicMaskOverlay | undefined {
    return this.dynamicOverlays.get(title);
  }

  private removeDynamicOverlay(title: HTMLElement): void {
    const overlay = this.dynamicOverlays.get(title);
    if (!overlay) return;
    overlay.dispose();
    this.dynamicOverlays.delete(title);
  }

  private scheduleTitleTransition(title: HTMLElement, delay: number, callback: () => void): void {
    const window = this.document.defaultView;
    if (!window) {
      callback();
      return;
    }
    const timer = window.setTimeout(() => {
      this.titleTransitionTimers.delete(title);
      callback();
    }, delay);
    this.titleTransitionTimers.set(title, timer);
  }

  private clearTitleTransition(title: HTMLElement): void {
    const timer = this.titleTransitionTimers.get(title);
    const window = this.document.defaultView;
    if (timer !== undefined && window) {
      window.clearTimeout(timer);
    }
    this.titleTransitionTimers.delete(title);
    deleteDataset(title, 'Transition');
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
    if (
      parent.querySelector(
        `button, [role="button"], img, svg:not([data-${DATA_PREFIX}-particle-layer="true"]), canvas, picture, video, [role="img"]:not([data-${DATA_PREFIX}-particle-layer="true"])`,
      )
    ) {
      return false;
    }
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
    this.rememberMenuRowFor(row, control);
  }

  private rememberMenuRowFromDocument(event: Event): void {
    if (this.stopped) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>(MENU_CONTROL_SELECTOR);
    const isChatGpt = this.location.hostname === 'chatgpt.com' || this.location.hostname.endsWith('.chatgpt.com');
    if (isChatGpt && this.associatedMenu?.contains(target)) return;
    const row = control && (isLikelyMenuControl(control) || isIconOnlyMenuControl(control))
      ? (isChatGpt ? this.findChatGptRowForMenuControl(control) : this.findRowForMenuControl(control))
      : undefined;
    if (row && this.rowBindings.has(row)) {
      this.rememberMenuRowFor(row, control ?? undefined);
    } else if (isChatGpt) {
      this.lastMenuRow = undefined;
      this.lastMenuTrigger = undefined;
      this.associatedMenu = undefined;
      this.cleanupMenuActions([]);
    }
  }

  private rememberMenuRowFor(row: HTMLElement, trigger?: HTMLElement): void {
    if (this.lastMenuRow !== row || this.lastMenuTrigger !== trigger ||
      (this.associatedMenu && !this.document.documentElement.contains(this.associatedMenu))) this.associatedMenu = undefined;
    this.lastMenuRow = row;
    this.lastMenuTrigger = trigger;
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

  private findChatGptRowForMenuControl(control: HTMLElement): HTMLElement | undefined {
    const ancestor = control.closest<HTMLElement>(`[data-${DATA_PREFIX}-row="true"]`);
    if (ancestor && this.rowBindings.has(ancestor)) return ancestor;

    // ChatGPT may mount the overflow button only on hover, after the link was bound.
    // Associate it only through a small shared container with one conversation link.
    let container = control.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      if (container.matches('nav, aside, main, [role="navigation"], body')) break;
      const links = container.querySelectorAll('a[href]');
      if (links.length > 1) break;
      if (links.length !== 1) continue;
      const rows = Array.from(container.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-row="true"]`))
        .filter((row) => this.rowBindings.has(row) && row.contains(links[0]));
      if (rows.length === 1) return rows[0];
    }
    return undefined;
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

    const isChatGpt = host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
    if (isChatGpt && this.associatedMenu && !this.document.documentElement.contains(this.associatedMenu)) {
      this.lastMenuRow = undefined;
      this.lastMenuTrigger = undefined;
      this.associatedMenu = undefined;
    }
    const candidates = isChatGpt ? menus.filter((candidate) => this.isChatGptConversationMenu(candidate)) : menus;
    const menu = this.associatedMenu && candidates.includes(this.associatedMenu)
      ? this.associatedMenu : this.chooseActionMenu(candidates);
    if (!menu) {
      this.cleanupMenuActions([]);
      return;
    }

    const row = this.resolveMenuRow(menu, isChatGpt);
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

    if (isChatGpt) this.associatedMenu = menu;
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
      this.matchMenuActionStyle(menu, existing);
      return;
    }

    const action = this.createMenuAction(row, unlocked);
    this.positionMenuAction(menu, action);
    this.matchMenuActionStyle(menu, action);
  }

  private resolveMenuRow(menu: HTMLElement, requireExplicitContext = false): HTMLElement | undefined {
    const row = this.lastMenuRow;
    if (row && this.document.documentElement.contains(row) && this.rowBindings.has(row) && (this.associatedMenu === menu || this.clock() - this.lastMenuRowAt <= MENU_CONTEXT_TTL_MS)) {
      if (requireExplicitContext) {
        if (!this.lastMenuTrigger || (this.associatedMenu && this.associatedMenu !== menu)) return undefined;
        const controlledId = this.lastMenuTrigger.getAttribute('aria-controls');
        if (controlledId && menu.id !== controlledId && !Array.from(menu.querySelectorAll<HTMLElement>('[id]')).some((element) => element.id === controlledId) && menu.closest('[id]')?.id !== controlledId) return undefined;
      }
      return row;
    }
    return requireExplicitContext ? undefined : this.findNearestRowForMenu(menu);
  }

  private isChatGptConversationMenu(menu: HTMLElement): boolean {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], button, [role="button"]'))
      .filter((item) => !item.closest(`[data-${DATA_PREFIX}-menu-action="true"]`))
      .filter((item) => !menu.matches('[role="menu"]') || item.closest('[role="menu"]') === menu)
      .map((item) => normalizeMenuText(item.textContent ?? ''));
    return items.some((text) => /^(rename|edit name|重命名|编辑名称)$/i.test(text)) &&
      items.some((text) => /^(delete|archive|删除|归档|存档)$/i.test(text));
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

  private matchMenuActionStyle(menu: HTMLElement, action: HTMLElement): void {
    const reference = this.findMenuItemByText(menu, /^(rename|edit name|edit chat name|pin chat|pin to top|pin|unpin|share|重命名|编辑名称|编辑对话名|置顶|固定|取消置顶|分享)$/i);
    const view = this.document.defaultView;
    if (!reference || !view) return;
    const referenceRect = reference.getBoundingClientRect();
    if (referenceRect.width <= 0 || referenceRect.height <= 0) return;

    const walker = this.document.createTreeWalker(reference, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!normalizeMenuText(node.textContent ?? '') || node.parentElement?.closest('svg, [aria-hidden="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNode = walker.nextNode();
    const textElement = textNode?.parentElement ?? reference;
    const itemStyle = view.getComputedStyle(reference);
    const textStyle = view.getComputedStyle(textElement);
    const properties: Record<string, string> = {
      'font-family': textStyle.fontFamily,
      'font-size': textStyle.fontSize,
      'font-style': textStyle.fontStyle,
      'font-weight': textStyle.fontWeight,
      'line-height': textStyle.lineHeight,
      'letter-spacing': textStyle.letterSpacing,
      color: textStyle.color,
      radius: itemStyle.borderRadius,
      height: `${referenceRect.height}px`,
      padding: itemStyle.padding,
    };

    const nativeIcon = reference.querySelector<HTMLElement | SVGElement>('svg, img, [role="img"]');
    if (nativeIcon && textNode && itemStyle.direction !== 'rtl') {
      const iconRect = nativeIcon.getBoundingClientRect();
      const range = this.document.createRange();
      range.selectNodeContents(textNode);
      const textRect = range.getBoundingClientRect();
      const gap = textRect.left - iconRect.right;
      const left = iconRect.left - referenceRect.left;
      if (iconRect.width >= 10 && iconRect.width <= 32 && iconRect.height >= 10 && iconRect.height <= 32 &&
          textRect.width > 0 && gap >= 0 && gap <= 32 && left >= 0 && left <= 48) {
        properties['icon-size'] = `${iconRect.width}px`;
        properties['glyph-size'] = `${Math.min(iconRect.width, iconRect.height)}px`;
        properties.gap = `${gap}px`;
        properties.padding = `${itemStyle.paddingTop} ${itemStyle.paddingRight} ${itemStyle.paddingBottom} ${left}px`;
      }
    }
    for (const [name, value] of Object.entries(properties)) {
      if (value) action.style.setProperty(`--chatveil-menu-${name}`, value);
    }
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
    icon?.replaceChildren(createTitlePinIcon(this.document, !unlocked));
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
    return Array.from(menu.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-menu-action="true"]`)).filter((action) => {
      if (action.parentElement === menu) return true;
      return menu.getAttribute('role') === 'menu' && action.closest('[role="menu"]') === menu &&
        !action.parentElement?.closest('[role="menuitem"], [role="option"], button, [role="button"]');
    });
  }

  private positionMenuAction(menu: HTMLElement, action: HTMLElement): void {
    const pinItem = this.findMenuItemByText(menu, /^(pin chat|pin to top|pin|unpin|置顶|固定|取消置顶)$/i);
    const destructiveItem = this.findMenuItemByText(menu, /^(delete|remove|删除|移除)$/i);
    const insertBefore = pinItem ?? destructiveItem;
    if (insertBefore?.parentElement) {
      const parent = insertBefore.parentElement;
      if (action.parentElement !== parent || action.nextElementSibling !== insertBefore) parent.insertBefore(action, insertBefore);
      return;
    }
    if (action.parentElement !== menu || action.nextElementSibling) menu.append(action);
  }

  private findMenuContainer(item: HTMLElement): HTMLElement | undefined {
    if (this.location.hostname === 'chatgpt.com' || this.location.hostname.endsWith('.chatgpt.com')) {
      const enclosingMenu = item.closest<HTMLElement>('[role="menu"]');
      if (enclosingMenu && this.isEligibleMenuContainer(enclosingMenu)) return enclosingMenu;
    }
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
    const validActions = new Set(validMenus.flatMap((menu) => this.directMenuActions(menu)));
    for (const action of Array.from(this.document.querySelectorAll<HTMLElement>(`[data-${DATA_PREFIX}-menu-action="true"]`))) {
      if (!validActions.has(action)) action.remove();
    }
    for (const menu of validMenus) {
      const actions = this.directMenuActions(menu);
      const keep = actions[0];
      for (const action of actions.slice(1)) action.remove();
      if (keep) this.positionMenuAction(menu, keep);
    }
  }

  private findMenuItemByText(menu: HTMLElement, pattern: RegExp): HTMLElement | undefined {
    const candidates = menu.getAttribute('role') === 'menu'
      ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], button, [role="button"]'))
          .filter((item) => item.closest('[role="menu"]') === menu && !item.closest(`[data-${DATA_PREFIX}-menu-action="true"]`))
      : Array.from(menu.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    return candidates.find((child) => pattern.test(normalizeMenuText(child.textContent ?? '')));
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
