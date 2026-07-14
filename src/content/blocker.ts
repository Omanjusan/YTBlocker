import { addEntry, addLogs, generateId } from '../shared/storage';
import { showToast } from './toast';

import type { BlockEntry, BlockLog } from '../shared/types';

export const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-reel-item-renderer',
  'ytd-shorts-lockup-view-model',     // 旧バージョン
  'ytm-shorts-lockup-view-model-v2',  // 検索結果ページ用 ← これが抜けてた
].join(', ');

// Shadow DOM を再帰的に貫通して querySelector する
function deepQuery(root: Element | ShadowRoot, selector: string): Element | null {
  const hit = (root as Element).querySelector?.(selector);
  if (hit) return hit;
  for (const el of (root as Element).querySelectorAll?.('*') ?? []) {
    if (el.shadowRoot) {
      const found = deepQuery(el.shadowRoot as unknown as Element, selector);
      if (found) return found;
    }
  }
  return null;
}

export function getVideoTitle(card: Element): string {
  const candidates = [
    'h3 a#video-title',            // 旧構造
    'a#video-title',
    '#video-title',
    'h3 .title',
    'h3 a[href*="/watch?v="]',     // 新構造: h3 内のタイトルリンク
    'h3 a[href*="/shorts/"]',      // 新構造: h3 内のショートリンク
    'h3',                          // 新構造フォールバック
  ];
  for (const sel of candidates) {
    const text = deepQuery(card, sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

export function getChannelName(card: Element): string {
  const candidates = [
    'ytd-channel-name a',
    '#channel-name a',
    'ytd-channel-name yt-formatted-string',
    '#channel-name yt-formatted-string',
    'a[href*="/@"]',               // 新構造: @ハンドル形式
    'a[href*="/channel/"]',
    'a[href*="/c/"]',
  ];
  for (const sel of candidates) {
    const text = deepQuery(card, sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

export async function blockAndLog(
  card: Element,
  target: 'video' | 'channel',
  value: string,
  title: string,
  channel: string,
  onAdded: () => void
): Promise<void> {
  const id = generateId();
  await addEntry({ id, target, matchType: 'exact', value, createdAt: Date.now() });
  await addLogs([{ videoTitle: title, channelName: channel, matchedValue: value, blockedAt: Date.now() }]);
  card.remove();
  onAdded();
  showToast(value, id);
}

export function isShorts(card: Element): boolean {
  if (card.tagName === 'YTD-REEL-ITEM-RENDERER') return true;
  return !!card.querySelector('a[href*="/shorts/"]');
}

function entryMatches(value: string, entry: BlockEntry): boolean {
  if (!value) return false;
  if (entry.matchType === 'exact') return value === entry.value;
  try {
    const m = entry.value.match(/^\/(.+)\/([gimsuy]*)$/);
    return m ? new RegExp(m[1], m[2]).test(value) : new RegExp(entry.value).test(value);
  } catch {
    return false;
  }
}

export function applyBlockList(entries: BlockEntry[], blockShorts: boolean): BlockLog[] {
  const logged: BlockLog[] = [];

  document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
    if (blockShorts && isShorts(card)) {
      card.remove();
      return;
    }

    if (entries.length === 0) return;

    const title   = getVideoTitle(card);
    const channel = getChannelName(card);

    const matchedEntry = entries.find((entry) => {
      if (entry.target === 'video')   return entryMatches(title, entry);
      if (entry.target === 'channel') return entryMatches(channel, entry);
      return entryMatches(title, entry) || entryMatches(channel, entry);
    });

    if (matchedEntry) {
      card.remove();
      logged.push({ videoTitle: title, channelName: channel, matchedValue: matchedEntry.value, blockedAt: Date.now() });
    }
  });

  return logged;
}
