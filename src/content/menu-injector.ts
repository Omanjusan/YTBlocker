import { blockAndLog, CARD_SELECTOR, getChannelName, getVideoTitle } from './blocker';
import { debugLog } from '../shared/debug';

type OnAdded = () => void;

let pendingCard: Element | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let menuObserver: MutationObserver | null = null;

/** 三点メニュー監視の途中状態(監視中のカード・MutationObserver・タイムアウト)を全て破棄する。 */
function reset(): void {
  if (cleanupTimer !== null) clearTimeout(cleanupTimer);
  menuObserver?.disconnect();
  menuObserver = null;
  pendingCard = null;
  cleanupTimer = null;
}

/** YouTubeの三点メニュー(tp-yt-paper-listbox)に挿入する項目1個分のDOM要素を生成する。 */
function createMenuItem(label: string, onClick: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ytblocker-item';
  el.setAttribute('role', 'menuitem');
  el.setAttribute('tabindex', '0');
  el.textContent = label;
  el.style.cssText = [
    'cursor:pointer',
    'padding:0 16px',
    'min-height:40px',
    'display:flex',
    'align-items:center',
    'font-size:1.4rem',
    'font-family:Roboto,Arial,sans-serif',
    'color:var(--yt-spec-text-primary,#0f0f0f)',
    'white-space:nowrap',
    'box-sizing:border-box',
  ].join(';');

  el.addEventListener('mouseenter', () => {
    el.style.backgroundColor = 'var(--yt-spec-10-percent-layer,rgba(0,0,0,0.05))';
  });
  el.addEventListener('mouseleave', () => {
    el.style.backgroundColor = '';
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    // YouTube のメニューを閉じる（Escape キー相当）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  return el;
}

/** 開いた三点メニューの listbox に区切り線とブロック用の項目を追加する。既に追加済みなら何もしない。 */
function injectItems(card: Element, listbox: Element, onAdded: OnAdded): void {
  if (listbox.querySelector('.ytblocker-item')) return;

  const title = getVideoTitle(card);
  const channel = getChannelName(card);
  if (!title && !channel) return;

  const sep = document.createElement('div');
  sep.className = 'ytblocker-item ytblocker-sep';
  sep.style.cssText = 'border-top:1px solid var(--yt-spec-10-percent-layer,#e0e0e0);margin:4px 0;pointer-events:none';
  listbox.appendChild(sep);

  if (title) {
    listbox.appendChild(
      createMenuItem('🚫 この動画をブロック', async () => {
        await blockAndLog(card, 'video', title, title, channel, onAdded);
      })
    );
  }

  if (channel) {
    listbox.appendChild(
      createMenuItem('🚫 このチャンネルをブロック', async () => {
        await blockAndLog(card, 'channel', channel, title, channel, onAdded);
      })
    );
  }
}

/** YouTube側が開いた三点メニューの listbox 要素を探す。DOM構造の版差に応じて複数セレクタを試す。 */
function findMenuListbox(): Element | null {
  return (
    document.querySelector('ytd-menu-popup-renderer tp-yt-paper-listbox') ||
    document.querySelector('tp-yt-paper-listbox[role="listbox"]') ||
    document.querySelector('ytd-menu-popup-renderer') ||
    null
  );
}

/**
 * カード内の三点メニューボタンのクリックを document 全体で捕捉し、
 * メニューが開いたタイミングで動的にブロック用の項目を注入する。
 * メニューは動的に生成されるため、クリック後に MutationObserver で
 * listbox の出現を待ち、2秒以内に見つからなければ諦めてリセットする。
 */
export function setupMenuInjector(onAdded: OnAdded): void {
  debugLog('setupMenuInjector: registered');

  document.addEventListener(
    'click',
    (e) => {
      const path = e.composedPath() as Element[];

      // カード要素を探す
      const card = path.find(
        (el): el is Element => el instanceof Element && typeof el.matches === 'function' && el.matches(CARD_SELECTOR)
      );
      if (!card) { reset(); return; }

      // BUTTON要素を探す（三点メニューボタン）
      const button = path.find(
        (el): el is Element => el instanceof Element && el.tagName === 'BUTTON'
      ) as HTMLButtonElement | undefined;
      if (!button) { reset(); return; }

      debugLog('button in card clicked, card:', card.tagName, 'aria-label:', button.getAttribute('aria-label') ?? '');

      reset();
      pendingCard = card;

      menuObserver = new MutationObserver(() => {
        if (!pendingCard) return;
        const listbox = findMenuListbox();
        debugLog('menuObserver fired, listbox:', listbox?.tagName ?? 'null');
        if (!listbox) return;
        injectItems(pendingCard, listbox, onAdded);
        reset();
      });

      menuObserver.observe(document.body, { childList: true, subtree: true });
      debugLog('menuObserver: observing for card', card.tagName);

      cleanupTimer = setTimeout(() => {
        debugLog('cleanupTimer: 2s elapsed, resetting (listbox not found)');
        reset();
      }, 2000);
    },
    true
  );
}
