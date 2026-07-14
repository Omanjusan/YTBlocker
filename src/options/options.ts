import {
  addEntry, clearLogs, DEFAULT_DEBOUNCE_DELAY, generateId, getBlockShortsEnabled, getDebounceDelay,
  getEntries, getLogs, removeEntry, setBlockShortsEnabled, setDebounceDelay, STORAGE_KEYS,
} from '../shared/storage';
import type { BlockEntry, MatchTarget } from '../shared/types';

const shortsCheckbox  = document.getElementById('shorts-checkbox')  as HTMLInputElement;
const debounceInput   = document.getElementById('debounce-input')   as HTMLInputElement;
const sampleInput     = document.getElementById('sample-input')     as HTMLInputElement;
const regexInput      = document.getElementById('regex-input')      as HTMLInputElement;
const matchIndicator  = document.getElementById('match-indicator')  as HTMLSpanElement;
const btnAddVideo     = document.getElementById('btn-add-video')    as HTMLButtonElement;
const btnAddChannel   = document.getElementById('btn-add-channel')  as HTMLButtonElement;
const btnAddBoth      = document.getElementById('btn-add-both')     as HTMLButtonElement;
const entryList       = document.getElementById('entry-list')       as HTMLDivElement;
const logList         = document.getElementById('log-list')         as HTMLDivElement;
const btnClearLog     = document.getElementById('btn-clear-log')    as HTMLButtonElement;

// ---- ショート動画設定 ----

getBlockShortsEnabled().then((enabled) => {
  shortsCheckbox.checked = enabled;
});

shortsCheckbox.addEventListener('change', () => {
  setBlockShortsEnabled(shortsCheckbox.checked);
});

// ---- デバウンス遅延設定 ----

getDebounceDelay().then((ms) => {
  debounceInput.value = String(ms);
});

debounceInput.addEventListener('change', () => {
  let val = parseInt(debounceInput.value, 10);
  if (isNaN(val)) val = DEFAULT_DEBOUNCE_DELAY;
  val = Math.max(100, Math.min(1000, val));
  debounceInput.value = String(val);
  setDebounceDelay(val);
});

// ---- リアルタイムマッチ判定 ----

/** サンプル入力欄がパターン欄の正規表現にマッチするかをリアルタイムで判定し、⭕/❌ で表示する。 */
function updateMatchIndicator(): void {
  const pattern = regexInput.value;
  const sample  = sampleInput.value;

  if (!pattern || !sample) { matchIndicator.textContent = '❌'; return; }

  try {
    const m = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
    const regex = m ? new RegExp(m[1], m[2]) : new RegExp(pattern);
    matchIndicator.textContent = regex.test(sample) ? '⭕' : '❌';
  } catch {
    matchIndicator.textContent = '❌';
  }
}

regexInput.addEventListener('input', updateMatchIndicator);
sampleInput.addEventListener('input', updateMatchIndicator);

// ---- 登録 ----

/** 正規表現入力欄の内容を matchType: 'regex' のブロックルールとして登録する。 */
async function handleAdd(target: MatchTarget): Promise<void> {
  const raw = regexInput.value.trim();
  if (!raw) return;

  const entry: BlockEntry = {
    id: generateId(),
    target,
    matchType: 'regex',
    value: raw,
    createdAt: Date.now(),
  };

  await addEntry(entry);
  regexInput.value = '';
  sampleInput.value = '';
  updateMatchIndicator();
  await renderList();
}

btnAddVideo  .addEventListener('click', () => handleAdd('video'));
btnAddChannel.addEventListener('click', () => handleAdd('channel'));
btnAddBoth   .addEventListener('click', () => handleAdd('both'));

// ---- ルールリスト描画 ----

function targetLabel(entry: BlockEntry): string {
  if (entry.target === 'video')   return '動画';
  if (entry.target === 'channel') return 'チャンネル';
  return '両方';
}

function targetBadgeClass(entry: BlockEntry): string {
  if (entry.target === 'video')   return 'badge-video';
  if (entry.target === 'channel') return 'badge-channel';
  return 'badge-both';
}

/** 登録済みブロックルール一覧を新しい順に描画する。 */
async function renderList(): Promise<void> {
  const entries = await getEntries();
  entryList.innerHTML = '';

  if (entries.length === 0) {
    entryList.innerHTML = '<p class="empty-msg">ルールがありません</p>';
    return;
  }

  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);

  for (const entry of sorted) {
    const item = document.createElement('div');
    item.className = 'entry-item';

    const targetBadge = document.createElement('span');
    targetBadge.className = `entry-badge ${targetBadgeClass(entry)}`;
    targetBadge.textContent = targetLabel(entry);

    const typeBadge = document.createElement('span');
    typeBadge.className = 'entry-badge badge-regex';
    typeBadge.textContent = entry.matchType === 'regex' ? '正規表現' : '完全一致';

    const valueEl = document.createElement('span');
    valueEl.className = 'entry-value';
    valueEl.textContent = entry.value;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', async () => {
      await removeEntry(entry.id);
      await renderList();
    });

    item.append(targetBadge, typeBadge, valueEl, deleteBtn);
    entryList.appendChild(item);
  }
}

// ---- ブロックログ描画 ----

/** UNIXミリ秒のタイムスタンプを "MM/DD HH:mm:ss" 形式の日本語ロケール文字列に変換する。 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** ブロック履歴ログを新しい順に描画する。 */
async function renderLog(): Promise<void> {
  const logs = await getLogs();
  logList.innerHTML = '';

  if (logs.length === 0) {
    logList.innerHTML = '<p class="empty-msg">ログはありません</p>';
    return;
  }

  for (const log of logs) {
    const item = document.createElement('div');
    item.className = 'log-item';

    const timeEl = document.createElement('span');
    timeEl.className = 'log-time';
    timeEl.textContent = formatTime(log.blockedAt);

    const bodyEl = document.createElement('span');
    bodyEl.className = 'log-body';

    const parts: string[] = [];
    if (log.videoTitle)  parts.push(`動画: ${log.videoTitle}`);
    if (log.channelName) parts.push(`CH: ${log.channelName}`);
    parts.push(`パターン: ${log.matchedValue}`);
    bodyEl.textContent = parts.join(' / ');

    item.append(timeEl, bodyEl);
    logList.appendChild(item);
  }
}

btnClearLog.addEventListener('click', async () => {
  await clearLogs();
  await renderLog();
});

// ---- ストレージ変更をリアルタイム反映 ----

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE_KEYS.list]) renderList();
  if (changes[STORAGE_KEYS.log])  renderLog();
});

// ---- 初回描画 ----

renderList();
renderLog();
