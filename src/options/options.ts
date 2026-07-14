import {
  addEntry, clearLogs, generateId, getBlockShortsEnabled,
  getEntries, getLogs, getScoutModeEnabled, removeEntry, setBlockShortsEnabled,
  setScoutModeEnabled, STORAGE_KEYS, updateEntry,
} from '../shared/storage';
import type { BlockEntry, MatchTarget } from '../shared/types';

const versionLabel    = document.getElementById('version-label')    as HTMLSpanElement;
const shortsCheckbox  = document.getElementById('shorts-checkbox')  as HTMLInputElement;
const scoutCheckbox   = document.getElementById('scout-checkbox')   as HTMLInputElement;
const formCard        = document.getElementById('form-card')        as HTMLElement;
const sampleInput     = document.getElementById('sample-input')     as HTMLInputElement;
const regexInput      = document.getElementById('regex-input')      as HTMLInputElement;
const matchIndicator  = document.getElementById('match-indicator')  as HTMLSpanElement;
const btnSubmit       = document.getElementById('btn-submit')       as HTMLButtonElement;
const btnCancel       = document.getElementById('btn-cancel')       as HTMLButtonElement;
const entryList       = document.getElementById('entry-list')       as HTMLDivElement;
const logList         = document.getElementById('log-list')         as HTMLDivElement;
const btnClearLog     = document.getElementById('btn-clear-log')    as HTMLButtonElement;

/** 編集中のブロックルールID。null なら新規登録モード。 */
let editingId: string | null = null;

// ---- バージョン表示 ----

versionLabel.textContent = `v${browser.runtime.getManifest().version}`;

// ---- ショート動画設定 ----

getBlockShortsEnabled().then((enabled) => {
  shortsCheckbox.checked = enabled;
});

shortsCheckbox.addEventListener('change', () => {
  setBlockShortsEnabled(shortsCheckbox.checked);
});

// ---- 観測モード設定 ----

getScoutModeEnabled().then((enabled) => {
  scoutCheckbox.checked = enabled;
});

scoutCheckbox.addEventListener('change', () => {
  setScoutModeEnabled(scoutCheckbox.checked);
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

// ---- 登録・編集 ----

function getSelectedTarget(): MatchTarget {
  return (document.querySelector('input[name="target"]:checked') as HTMLInputElement).value as MatchTarget;
}

function setSelectedTarget(target: MatchTarget): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="target"][value="${target}"]`);
  if (radio) radio.checked = true;
}

/** 指定エントリの内容をフォームへ流し込み、編集モードへ切り替える。 */
function enterEditMode(entry: BlockEntry): void {
  editingId = entry.id;
  regexInput.value = entry.value;
  sampleInput.value = '';
  setSelectedTarget(entry.target);
  updateMatchIndicator();
  formCard.classList.add('is-editing');
  btnSubmit.textContent = '更新';
  regexInput.focus();
}

/** 編集モードを終了し、新規登録モードに戻す。 */
function exitEditMode(): void {
  editingId = null;
  regexInput.value = '';
  sampleInput.value = '';
  setSelectedTarget('video');
  updateMatchIndicator();
  formCard.classList.remove('is-editing');
  btnSubmit.textContent = '登録';
}

btnCancel.addEventListener('click', exitEditMode);

/** フォームの内容で新規登録、または編集中のルールを更新する。 */
async function handleSubmit(): Promise<void> {
  const raw = regexInput.value.trim();
  if (!raw) return;
  const target = getSelectedTarget();

  if (editingId) {
    await updateEntry(editingId, { target, value: raw });
    exitEditMode();
  } else {
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
  }

  await renderList();
}

btnSubmit.addEventListener('click', handleSubmit);

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
    item.className = 'entry-item' + (entry.id === editingId ? ' is-target' : '');

    const targetBadge = document.createElement('span');
    targetBadge.className = `entry-badge ${targetBadgeClass(entry)}`;
    targetBadge.textContent = targetLabel(entry);

    const typeBadge = document.createElement('span');
    typeBadge.className = 'entry-badge badge-regex';
    typeBadge.textContent = entry.matchType === 'regex' ? '正規表現' : '完全一致';

    const valueEl = document.createElement('span');
    valueEl.className = 'entry-value';
    valueEl.textContent = entry.value;

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => enterEditMode(entry));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', async () => {
      await removeEntry(entry.id);
      if (editingId === entry.id) exitEditMode();
      await renderList();
    });

    item.append(targetBadge, typeBadge, valueEl, editBtn, deleteBtn);
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
