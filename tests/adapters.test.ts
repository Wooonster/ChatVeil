import { describe, expect, it } from 'vitest';
import {
  chatGptAdapter,
  claudeAdapter,
  deepSeekAdapter,
  genericSidebarAdapter,
  minimaxAdapter,
  qwenAdapter,
  xiaomiAdapter,
  zAiAdapter,
} from '../src/core/adapters';

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

describe('chatbot adapters', () => {
  it('matches first-class chatbot domains', () => {
    expect(chatGptAdapter.matches(new URL('https://chatgpt.com/c/123') as unknown as Location)).toBe(true);
    expect(claudeAdapter.matches(new URL('https://claude.ai/chat/abc') as unknown as Location)).toBe(true);
    expect(qwenAdapter.matches(new URL('https://chat.qwen.ai/chat/abc') as unknown as Location)).toBe(true);
    expect(deepSeekAdapter.matches(new URL('https://chat.deepseek.com/a/chat/s/abc') as unknown as Location)).toBe(true);
    expect(minimaxAdapter.matches(new URL('https://agent.minimax.com/chat?id=abc') as unknown as Location)).toBe(true);
    expect(minimaxAdapter.matches(new URL('https://agent.minimaxi.com/chat?id=abc') as unknown as Location)).toBe(true);
    expect(zAiAdapter.matches(new URL('https://chat.z.ai/') as unknown as Location)).toBe(false);
    expect(xiaomiAdapter.matches(new URL('https://aistudio.xiaomimimo.com/chat/abc') as unknown as Location)).toBe(false);
  });

  it('finds current and non-current ChatGPT history items', () => {
    document.body.innerHTML = `
      <nav>
        <a href="https://chatgpt.com/c/current" aria-current="page"><span>Current thread</span></a>
        <a href="https://chatgpt.com/c/old"><span>Old thread</span></a>
      </nav>
    `;
    const location = new URL('https://chatgpt.com/c/current') as unknown as Location;
    const items = chatGptAdapter.findHistoryItems(document);
    expect(items).toHaveLength(2);
    expect(chatGptAdapter.isCurrent(items[0], location)).toBe(true);
    expect(chatGptAdapter.isCurrent(items[1], location)).toBe(false);
    expect(chatGptAdapter.getStableKey(items[1], location, 1)).toContain('/c/old');
  });

  it('extracts Claude, Qwen, and generic sidebar rows conservatively', () => {
    document.body.innerHTML = `
      <aside>
        <a href="https://claude.ai/chat/a"><span>Claude diagnosis</span></a>
        <a href="https://chat.qwen.ai/chat/b"><span>Qwen planning</span></a>
        <a href="https://example.com/thread/c"><span>Generic assistant thread</span></a>
        <a href="/settings"><span>Settings</span></a>
      </aside>
    `;
    expect(claudeAdapter.findHistoryItems(document)).toHaveLength(1);
    expect(qwenAdapter.findHistoryItems(document)).toHaveLength(1);
    expect(genericSidebarAdapter.findHistoryItems(document).map((item) => item.title.textContent?.trim())).toContain(
      'Generic assistant thread',
    );
  });

  it('uses the shared title/action wrapper as the Claude history row', () => {
    document.body.innerHTML = `
      <nav>
        <div class="flex group relative" data-row="claude-history-row">
          <a href="https://claude.ai/chat/a"><span>Claude diagnosis</span></a>
          <button aria-label="Open conversation options">...</button>
        </div>
      </nav>
    `;
    const [item] = claudeAdapter.findHistoryItems(document);
    expect(item.title.textContent?.trim()).toBe('Claude diagnosis');
    expect(item.row).toBe(document.querySelector('[data-row="claude-history-row"]'));
  });

  it('extracts DeepSeek anchor and clickable-div history rows', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <a href="https://chat.deepseek.com/a/chat/s/current" class="active"><span>Current DeepSeek chat</span></a>
        <a href="https://chat.deepseek.com/chat/old"><span>Old DeepSeek chat</span></a>
        <div class="history-item" data-session-id="div-1" tabindex="0">
          <span>Clickable div DeepSeek chat</span>
          <button aria-label="More actions">...</button>
        </div>
      </aside>
    `;
    const location = new URL('https://chat.deepseek.com/a/chat/s/current') as unknown as Location;
    const items = deepSeekAdapter.findHistoryItems(document);
    expect(items.map((item) => item.title.textContent?.trim())).toEqual([
      'Current DeepSeek chat',
      'Old DeepSeek chat',
      'Clickable div DeepSeek chat',
    ]);
    expect(deepSeekAdapter.isCurrent(items[0], location)).toBe(true);
    expect(deepSeekAdapter.getStableKey(items[2], location, 2)).toContain('/deepseek/div-1');
  });

  it('targets only text when a history row starts with an icon', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div class="history-item" data-session-id="icon-row" tabindex="0">
          <span class="chat-icon" role="img">💬</span>
          DeepSeek icon row title
          <button aria-label="More actions">...</button>
        </div>
      </aside>
    `;
    const [item] = deepSeekAdapter.findHistoryItems(document);
    expect(item.title.textContent?.trim()).toBe('DeepSeek icon row title');
    expect(item.title.dataset.chatveilTextWrapper).toBe('true');
    expect(item.title.querySelector('[role="img"], img, svg')).toBeNull();
    expect(item.row.querySelector('[role="img"]')?.textContent).toBe('💬');
  });

  it('targets only text when a history row ends with an action icon', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div class="history-item" data-session-id="trailing-icon-row" tabindex="0">
          <span>
            Private row title
            <button aria-label="More actions">•••</button>
          </span>
        </div>
      </aside>
    `;
    const [item] = deepSeekAdapter.findHistoryItems(document);
    expect(item.title.textContent?.trim()).toBe('Private row title');
    expect(item.title.dataset.chatveilTextWrapper).toBe('true');
    expect(item.title.querySelector('button, [role="button"], img, svg')).toBeNull();
    expect(item.row.querySelector('button')?.textContent).toBe('•••');
  });

  it('uses clean flex/truncate title layout containers directly', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div class="history-item" data-session-id="layout-title" tabindex="0">
          <span class="min-w-0 flex-1 truncate text-sm">Layout title text</span>
          <button aria-label="More actions">•••</button>
        </div>
      </aside>
    `;
    const [item] = deepSeekAdapter.findHistoryItems(document);
    expect(item.title.textContent?.trim()).toBe('Layout title text');
    expect(item.title.dataset.chatveilTextWrapper).toBeUndefined();
    expect(item.title.className).toContain('flex-1');
    expect(item.row.querySelector('button')?.textContent).toBe('•••');
  });

  it('does not treat official tool/navigation rows as chatbot history', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <a href="https://www.doubao.com/chat/new"><span>新对话</span></a>
        <a href="https://www.doubao.com/apps"><span>AI 创作</span></a>
        <a href="https://www.doubao.com/more"><span>更多</span></a>
        <a href="https://www.doubao.com/chat/abc"><span>真实会话标题</span></a>
      </aside>
    `;
    expect(genericSidebarAdapter.findHistoryItems(document).map((item) => item.title.textContent?.trim())).toEqual([
      '真实会话标题',
    ]);
  });

  it('extracts MiniMax task records from the task history section only', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>新建任务</div>
        <div>搜索</div>
        <div>资产</div>
        <div>MiniMax实验室</div>
        <div>MaxHermes Beta</div>
        <div>MaxClaw</div>
        <div>Skills技能 New</div>
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
    const items = minimaxAdapter.findHistoryItems(document);
    expect(items.map((item) => item.title.textContent?.trim())).toEqual(['Arena 分数', '你好']);
    expect(items.every((item) => item.title.className.includes('truncate'))).toBe(true);
  });

  it('keeps Xiaomi MiMO disabled for now', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>MiMo Claw Free Trial</div>
        <div>MiMo Chat</div>
        <div>History</div>
        <div>New conversation</div>
        <button class="history-row">
          <span class="min-w-0 flex-1 truncate text-sm">程序员风安慰失恋猫咪代码指南</span>
          <span aria-label="More actions">•••</span>
        </button>
      </aside>
    `;
    expect(xiaomiAdapter.findHistoryItems(document)).toEqual([]);
  });

  it('extracts Qwen date-grouped plain conversation rows', () => {
    document.body.innerHTML = `
      <aside class="sidebar">
        <div>新建对话</div>
        <div>搜索对话</div>
        <div>社区</div>
        <div>Coder</div>
        <div>项目</div>
        <div>新项目</div>
        <div>所有对话</div>
        <div>今天</div>
        <div>新建对话</div>
        <div>2025</div>
        <div class="conversation-row">传染病预测模型与方法综述</div>
      </aside>
    `;
    expect(qwenAdapter.findHistoryItems(document).map((item) => item.title.textContent?.trim())).toEqual([
      '传染病预测模型与方法综述',
    ]);
  });

  it('keeps Z.ai/GLM disabled for now', () => {
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
        <button class="conversation-row">结合该新闻稿 https://news.h...</button>
        <div class="sidebar-user"><span>Wonster Wayne</span></div>
      </aside>
    `;
    expect(zAiAdapter.findHistoryItems(document)).toEqual([]);
  });
});
