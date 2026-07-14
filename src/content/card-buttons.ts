import { blockAndLog, CARD_SELECTOR, getChannelName, getVideoTitle } from './blocker';
import { DEBUG, debugLog } from '../shared/debug';

type OnAdded = () => void;

const INJECTED_ATTR = 'data-ytb';

function makeBtn(label: string, color: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    `background:${color}`,
    'color:#fff',
    'border:none',
    'border-radius:3px',
    'padding:2px 7px',
    'font-size:11px',
    'font-family:Roboto,Arial,sans-serif',
    'cursor:pointer',
    'line-height:1.6',
    'opacity:0.85',
    'flex-shrink:0',
  ].join(';');
  btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.85'; });
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(e); });
  return btn;
}

export function injectCardButtons(card: Element, onAdded: OnAdded): void {
  if (card.hasAttribute(INJECTED_ATTR)) return;

  const title   = getVideoTitle(card);
  const channel = getChannelName(card);
  if (!title && !channel) return;

  card.setAttribute(INJECTED_ATTR, '1');

  const row = document.createElement('div');
  row.setAttribute('data-ytb-row', '1');
  row.style.cssText = [
    'display:flex',
    'flex-wrap:wrap',
    'gap:4px',
    'padding:4px 0 2px',
    'align-items:center',
  ].join(';');

  if (title) {
    row.appendChild(makeBtn('🚫 動画', '#c00', async () => {
      const currentTitle   = getVideoTitle(card);
      const currentChannel = getChannelName(card);
      await blockAndLog(card, 'video', currentTitle, currentTitle, currentChannel, onAdded);
    }));
  }

  if (channel) {
    row.appendChild(makeBtn('🚫 CH', '#107516', async () => {
      const currentTitle   = getVideoTitle(card);
      const currentChannel = getChannelName(card);
      await blockAndLog(card, 'channel', currentChannel, currentTitle, currentChannel, onAdded);
    }));
  }

  card.prepend(row);
}

export function injectAllCardButtons(onAdded: OnAdded): void {
  const cards = document.querySelectorAll<Element>(CARD_SELECTOR);
  debugLog('injectAll: cards found =', cards.length);
  cards.forEach((card) => {
    if (DEBUG) {
      const title   = getVideoTitle(card);
      const channel = getChannelName(card);
      const lockup  = card.querySelector('yt-lockup-view-model');
      debugLog('card', card.tagName,
        '| title:', title || '(empty)',
        '| ch:', channel || '(empty)',
        '| lockup:', !!lockup,
        '| lockup.shadowRoot:', lockup ? !!lockup.shadowRoot : 'n/a',
        '| watch link:', !!card.querySelector('a[href*="/watch"]'),
      );
    }
    injectCardButtons(card, onAdded);
  });
}
