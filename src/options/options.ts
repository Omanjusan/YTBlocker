import {
  addEntry, clearLogs, estimateEntryBytes, generateId, getBlockShortsEnabled,
  getEntries, getLogs, getScoutModeEnabled, getUsageBytes, isActiveArea, isLogDisabled, isSyncEnabled, itemByteSize, MAX_ENTRY_BYTES,
  removeEntry, setBlockShortsEnabled, setLogDisabled, setScoutModeEnabled, STORAGE_KEYS, switchSyncArea, SYNC_TOTAL_BUDGET, updateEntry,
} from '../shared/storage';
import { applyStaticI18n, getLanguage, LANGS, setLanguage, t, toIntlLocale, type Lang } from '../shared/i18n';
import type { BlockEntry, MatchTarget } from '../shared/types';

const versionLabel        = document.getElementById('version-label')         as HTMLSpanElement;
const langSelect          = document.getElementById('lang-select')           as HTMLSelectElement;
const usageBadge          = document.getElementById('usage-badge')           as HTMLSpanElement;
const shortsCheckbox      = document.getElementById('shorts-checkbox')       as HTMLInputElement;
const scoutCheckbox       = document.getElementById('scout-checkbox')        as HTMLInputElement;
const syncLocalCheckbox   = document.getElementById('sync-local-checkbox')   as HTMLInputElement;
const logDisabledCheckbox = document.getElementById('log-disabled-checkbox') as HTMLInputElement;
const formCard            = document.getElementById('form-card')             as HTMLElement;
const sampleInput         = document.getElementById('sample-input')          as HTMLInputElement;
const regexInput          = document.getElementById('regex-input')           as HTMLInputElement;
const matchIndicator      = document.getElementById('match-indicator')       as HTMLSpanElement;
const budgetText          = document.getElementById('budget-text')           as HTMLSpanElement;
const btnSubmit           = document.getElementById('btn-submit')            as HTMLButtonElement;
const btnCancel           = document.getElementById('btn-cancel')            as HTMLButtonElement;
const entryList           = document.getElementById('entry-list')            as HTMLDivElement;
const logList             = document.getElementById('log-list')              as HTMLDivElement;
const btnClearLog         = document.getElementById('btn-clear-log')         as HTMLButtonElement;

/** 編集中のブロックルールID。null なら新規登録モード。 */
let editingId: string | null = null;

/** 現在の表示言語。言語切替時に静的文言と動的描画部分の両方を再適用する。 */
let currentLang: Lang = 'ja';

// ---- 言語設定 ----

for (const { code, label } of LANGS) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = label;
  langSelect.appendChild(opt);
}

async function applyLanguage(lang: Lang): Promise<void> {
  currentLang = lang;
  langSelect.value = lang;
  applyStaticI18n(lang);
  updateMatchIndicator();
  updateByteBudget();
  await renderList();
  await renderLog();
}

getLanguage().then(applyLanguage);

langSelect.addEventListener('change', async () => {
  const lang = langSelect.value as Lang;
  await setLanguage(lang);
  await applyLanguage(lang);
});

/** storage.sync の現在の使用バイト数。起動時に実測し、以降は onChanged の差分で更新する(毎回全チャンクを読み直さない)。 */
let usedBytes = 0;
/** 容量が100%に達しているかどうか。達している場合は登録処理そのものをスキップする。 */
let usageAtCapacity = false;

// ---- NG登録容量ゲージ ----

function renderUsage(): void {
  const percent = Math.min(100, Math.round((usedBytes / SYNC_TOTAL_BUDGET) * 100));
  usageAtCapacity = percent >= 100;

  usageBadge.textContent = `${percent}%`;
  usageBadge.classList.remove('usage-warn', 'usage-full');
  if (percent >= 90) usageBadge.classList.add('usage-full');
  else if (percent >= 70) usageBadge.classList.add('usage-warn');

  updateByteBudget();
}

getUsageBytes().then((bytes) => {
  usedBytes = bytes;
  renderUsage();
});

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

// ---- 同期無効化(ローカル保存)設定 ----
// チェックボックスは「保存しない」＝ローカル保存 なので isSyncEnabled とは真偽が逆になる。

isSyncEnabled().then((enabled) => {
  syncLocalCheckbox.checked = !enabled;
});

syncLocalCheckbox.addEventListener('change', async () => {
  syncLocalCheckbox.disabled = true;
  try {
    await switchSyncArea(!syncLocalCheckbox.checked);
    usedBytes = await getUsageBytes();
    renderUsage();
    await renderList();
  } finally {
    syncLocalCheckbox.disabled = false;
  }
});

// ---- ブロックログ表示無効化設定 ----

isLogDisabled().then((disabled) => {
  logDisabledCheckbox.checked = disabled;
});

logDisabledCheckbox.addEventListener('change', async () => {
  await setLogDisabled(logDisabledCheckbox.checked);
  if (logDisabledCheckbox.checked) await clearLogs();
  await renderLog();
});

// ---- リアルタイムマッチ判定 ----

/** サンプル入力欄がパターン欄の正規表現にマッチするかをリアルタイムで判定し、適合/不適合で表示する。 */
function setMatchState(ok: boolean): void {
  matchIndicator.classList.toggle('match-ok', ok);
  matchIndicator.classList.toggle('match-ng', !ok);
  matchIndicator.textContent = t(ok ? 'match.ok' : 'match.ng', currentLang);
}

function updateMatchIndicator(): void {
  const pattern = regexInput.value;
  const sample  = sampleInput.value;

  if (!pattern || !sample) { setMatchState(false); return; }

  try {
    const m = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
    const regex = m ? new RegExp(m[1], m[2]) : new RegExp(pattern);
    setMatchState(regex.test(sample));
  } catch {
    setMatchState(false);
  }
}

regexInput.addEventListener('input', updateMatchIndicator);
sampleInput.addEventListener('input', updateMatchIndicator);

// ---- 登録・編集 ----

function getSelectedTarget(): MatchTarget {
  return (document.querySelector('input[name="target"]:checked') as HTMLInputElement).value as MatchTarget;
}

/**
 * 入力中のパターンがルール1件としてあと何バイト入るかをリアルタイムで表示し、
 * 上限超過または容量100%到達時は登録ボタンをガードする。
 */
function updateByteBudget(): void {
  if (usageAtCapacity) {
    budgetText.textContent = t('budget.capacityFull', currentLang);
    btnSubmit.disabled = true;
    return;
  }

  const used = estimateEntryBytes(getSelectedTarget(), 'regex', regexInput.value);
  const remaining = MAX_ENTRY_BYTES - used;

  budgetText.textContent = remaining >= 0
    ? t('budget.remaining', currentLang, { n: remaining })
    : t('budget.tooLong', currentLang);
  btnSubmit.disabled = remaining < 0;
}

regexInput.addEventListener('input', updateByteBudget);
document.querySelectorAll<HTMLInputElement>('input[name="target"]').forEach((el) => {
  el.addEventListener('change', updateByteBudget);
});

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
  updateByteBudget();
  formCard.classList.add('is-editing');
  btnSubmit.textContent = t('btn.update', currentLang);
  regexInput.focus();
}

/** 編集モードを終了し、新規登録モードに戻す。 */
function exitEditMode(): void {
  editingId = null;
  regexInput.value = '';
  sampleInput.value = '';
  setSelectedTarget('video');
  updateMatchIndicator();
  updateByteBudget();
  formCard.classList.remove('is-editing');
  btnSubmit.textContent = t('btn.submit', currentLang);
}

btnCancel.addEventListener('click', exitEditMode);

/** フォームの内容で新規登録、または編集中のルールを更新する。 */
async function handleSubmit(): Promise<void> {
  if (btnSubmit.disabled) return;
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
    updateByteBudget();
  }

  await renderList();
}

btnSubmit.addEventListener('click', handleSubmit);

// ---- ルールリスト描画 ----

function targetLabel(entry: BlockEntry): string {
  if (entry.target === 'video')   return t('target.video', currentLang);
  if (entry.target === 'channel') return t('target.channel', currentLang);
  return t('target.both', currentLang);
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
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-msg';
    emptyMsg.textContent = t('rules.empty', currentLang);
    entryList.appendChild(emptyMsg);
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
    typeBadge.textContent = t(entry.matchType === 'regex' ? 'matchType.regex' : 'matchType.exact', currentLang);

    const valueEl = document.createElement('span');
    valueEl.className = 'entry-value';
    valueEl.textContent = entry.value;

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-edit';
    editBtn.textContent = t('btn.edit', currentLang);
    editBtn.addEventListener('click', () => enterEditMode(entry));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = t('btn.delete', currentLang);
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

/** UNIXミリ秒のタイムスタンプを選択言語のロケールに沿った日時文字列に変換する。 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(toIntlLocale(currentLang), {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** ブロック履歴ログを新しい順に描画する。表示無効化中は常に空表示にする。 */
async function renderLog(): Promise<void> {
  logList.innerHTML = '';

  if (await isLogDisabled()) {
    const disabledMsg = document.createElement('p');
    disabledMsg.className = 'empty-msg';
    disabledMsg.textContent = t('log.disabledMsg', currentLang);
    logList.appendChild(disabledMsg);
    return;
  }

  const logs = await getLogs();

  if (logs.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-msg';
    emptyMsg.textContent = t('log.empty', currentLang);
    logList.appendChild(emptyMsg);
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
    if (log.videoTitle)  parts.push(`${t('log.video', currentLang)}${log.videoTitle}`);
    if (log.channelName) parts.push(`${t('log.channel', currentLang)}${log.channelName}`);
    parts.push(`${t('log.pattern', currentLang)}${log.matchedValue}`);
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

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (changes[STORAGE_KEYS.log] || changes[STORAGE_KEYS.logDisabled])) renderLog();

  if (await isActiveArea(area)) {
    // 全チャンクを読み直さず、変化したキーごとの差分バイト数だけキャッシュへ反映する
    for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
      const oldSize = oldValue === undefined ? 0 : itemByteSize(key, oldValue);
      const newSize = newValue === undefined ? 0 : itemByteSize(key, newValue);
      usedBytes += newSize - oldSize;
    }
    renderUsage();

    const ruleChanged = Object.keys(changes).some((k) => k.startsWith(STORAGE_KEYS.rulesPrefix));
    if (ruleChanged) renderList();
  }
});

// 初回描画は applyLanguage()(getLanguage() 解決後) が担う。
