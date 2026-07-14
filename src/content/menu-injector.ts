import { addEntry, addLogs, generateId } from '../shared/storage';
import { CARD_SELECTOR, getChannelName, getVideoTitle } from './blocker';
import { showToast } from './toast';

type OnAdded = () => void;

let pendingCard: Element | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let menuObserver: MutationObserver | null = null;

function reset(): void {
  if (cleanupTimer !== null) clearTimeout(cleanupTimer);
  menuObserver?.disconnect();
  menuObserver = null;
  pendingCard = null;
  cleanupTimer = null;
}

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
        const id = generateId();
        await addEntry({ id, target: 'video', matchType: 'exact', value: title, createdAt: Date.now() });
        await addLogs([{ videoTitle: title, channelName: channel, matchedValue: title, blockedAt: Date.now() }]);
        card.remove();
        onAdded();
        showToast(title, id);
      })
    );
  }

  if (channel) {
    listbox.appendChild(
      createMenuItem('🚫 このチャンネルをブロック', async () => {
        const id = generateId();
        await addEntry({ id, target: 'channel', matchType: 'exact', value: channel, createdAt: Date.now() });
        await addLogs([{ videoTitle: title, channelName: channel, matchedValue: channel, blockedAt: Date.now() }]);
        card.remove();
        onAdded();
        showToast(channel, id);
      })
    );
  }
}

function findMenuListbox(): Element | null {
  return (
    document.querySelector('ytd-menu-popup-renderer tp-yt-paper-listbox') ||
    document.querySelector('tp-yt-paper-listbox[role="listbox"]') ||
    document.querySelector('ytd-menu-popup-renderer') ||
    null
  );
}

export function setupMenuInjector(onAdded: OnAdded): void {
  console.log('[YTBlocker] setupMenuInjector: registered');

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

      const ariaLabel = button.getAttribute('aria-label') ?? '';
      console.log('[YTBlocker] button in card clicked, card:', card.tagName, 'aria-label:', ariaLabel);

      reset();
      pendingCard = card;

      menuObserver = new MutationObserver(() => {
        if (!pendingCard) return;
        const listbox = findMenuListbox();
        console.log('[YTBlocker] menuObserver fired, listbox:', listbox?.tagName ?? 'null');
        if (!listbox) return;
        injectItems(pendingCard, listbox, onAdded);
        reset();
      });

      menuObserver.observe(document.body, { childList: true, subtree: true });
      console.log('[YTBlocker] menuObserver: observing for card', card.tagName);

      cleanupTimer = setTimeout(() => {
        console.log('[YTBlocker] cleanupTimer: 2s elapsed, resetting (listbox not found)');
        reset();
      }, 2000);
    },
    true
  );
}
