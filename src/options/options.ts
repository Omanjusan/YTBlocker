import {
  addEntry, clearLogs, estimateEntryBytes, generateId,
  getBlockShortsEnabled, getEntries, getLogs, getScoutModeEnabled,
  isLogDisabled, isSyncEnabled, removeEntry, setBlockShortsEnabled,
  setLogDisabled, setScoutModeEnabled, setSyncEnabled, STORAGE_KEYS,
  updateEntry,
} from '../shared/storage';
import {
  getSyncUsageBytes, isSyncFeedKey, itemByteSize, MAX_ENTRY_BYTES,
  SYNC_TOTAL_BUDGET,
} from '../shared/sync-protocol';
import {
  applyStaticI18n, getLanguage, LANGS, setLanguage,
  t, toIntlLocale, type Lang,
} from '../shared/i18n';
import type { BlockEntry, MatchTarget, MatchType } from '../shared/types';

const versionLabel        = document.getElementById('version-label')         as HTMLSpanElement;
const langSelect          = document.getElementById('lang-select')           as HTMLSelectElement;
const usageBadge          = document.getElementById('usage-badge')           as HTMLSpanElement;
const shortsCheckbox      = document.getElementById('shorts-checkbox')       as HTMLInputElement;
const scoutCheckbox       = document.getElementById('scout-checkbox')        as HTMLInputElement;
const syncLocalCheckbox   = document.getElementById('sync-local-checkbox')   as HTMLInputElement;
const logDisabledCheckbox = document.getElementById('log-disabled-checkbox') as HTMLInputElement;
const formCard            = document.getElementById('form-card')             as HTMLElement;
const tabGeneral          = document.getElementById('tab-general')           as HTMLInputElement;
const tabAdvanced         = document.getElementById('tab-advanced')          as HTMLInputElement;
const generalInput        = document.getElementById('general-input')        as HTMLInputElement;
const budgetTextGeneral   = document.getElementById('budget-text-general')   as HTMLParagraphElement;
const sampleInput         = document.getElementById('sample-input')          as HTMLInputElement;
const regexInput          = document.getElementById('regex-input')           as HTMLInputElement;
const matchIndicator      = document.getElementById('match-indicator')       as HTMLSpanElement;
const budgetText          = document.getElementById('budget-text')           as HTMLSpanElement;
const btnSubmit           = document.getElementById('btn-submit')            as HTMLButtonElement;
const btnCancel           = document.getElementById('btn-cancel')            as HTMLButtonElement;
const entryList           = document.getElementById('entry-list')            as HTMLDivElement;
const logList             = document.getElementById('log-list')              as HTMLDivElement;
const btnClearLog         = document.getElementById('btn-clear-log')         as HTMLButtonElement;

/** 一般ルールタブの一致方法ラジオ(exact/partialの2択)。 */
function generalMatchRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="match-general"]'));
}
/** 上級者ルールタブの一致方法ラジオ(exact/partial/regexの3択)。 */
function advancedMatchRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="match-advanced"]'));
}

type FormTab = 'general' | 'advanced';

/** 現在アクティブなタブ(一般ルール/上級者ルール)を返す。 */
function getActiveTab(): FormTab {
  return tabAdvanced.checked ? 'advanced' : 'general';
}

/** 指定したタブをアクティブにする(タブラジオのcheckedを切り替えるだけで、値の同期は行わない)。 */
function setActiveTab(tab: FormTab): void {
  tabGeneral.checked = tab === 'general';
  tabAdvanced.checked = tab === 'advanced';
}

/** 指定タブの一致方法ラジオから、選択中の MatchType を取得する。 */
function getSelectedMatchTypeFor(tab: FormTab): MatchType {
  const radios = tab === 'general' ? generalMatchRadios() : advancedMatchRadios();
  const checked = radios.find((r) => r.checked);
  return (checked?.value as MatchType | undefined) ?? 'exact';
}

/** アクティブなタブの一致方法ラジオから、選択中の MatchType を取得する。 */
function getSelectedMatchType(): MatchType {
  return getSelectedMatchTypeFor(getActiveTab());
}

/** 指定したタブの一致方法ラジオに値をセットする。一般タブに'regex'を渡した場合は'partial'にフォールバックする。 */
function setSelectedMatchType(tab: FormTab, matchType: MatchType): void {
  const resolved: MatchType = tab === 'general' && matchType === 'regex' ? 'partial' : matchType;
  const radios = tab === 'general' ? generalMatchRadios() : advancedMatchRadios();
  for (const r of radios) r.checked = r.value === resolved;
}

/** アクティブなタブの入力欄から、登録・更新に使う値を取得する。 */
function getActiveValue(): string {
  return getActiveTab() === 'general' ? generalInput.value : regexInput.value;
}

/**
 * タブ切替時、旧タブの値を新タブへ引き継ぐ。
 * 一般→上級者は、値が入力済みなら一致方法もそのまま引き継ぎ、空欄なら正規表現を既定選択にする
 * (空欄は「新しく上級者ルールを書く」意図とみなす)。
 * 上級者→一般は setSelectedMatchType のフォールバックにより regex が partial に変わる形で引き継ぐ。
 */
function syncTabOnSwitch(from: FormTab, to: FormTab): void {
  const value = from === 'general' ? generalInput.value : regexInput.value;
  if (to === 'general') generalInput.value = value;
  else regexInput.value = value;

  const matchType = to === 'advanced' && !value.trim() ? 'regex' : getSelectedMatchTypeFor(from);
  setSelectedMatchType(to, matchType);
}

let lastActiveTab: FormTab = getActiveTab();

[tabGeneral, tabAdvanced].forEach((el) => {
  el.addEventListener('change', () => {
    const next = getActiveTab();
    if (next === lastActiveTab) return;
    syncTabOnSwitch(lastActiveTab, next);
    lastActiveTab = next;
    // 切替直後は値が同期されたばかりなので、新タブ側の判定結果/容量表示を作り直す
    updateMatchIndicator();
    updateByteBudget();
  });
});

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

/** 表示言語を切り替え、静的文言(data-i18n)と動的描画部分(一覧・ログ・判定表示)を全て再適用する。 */
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

/** 現在のarea上でルール+設定が使用しているバイト数。起動時に実測し、以降は onChanged の差分で更新する(毎回全チャンクを読み直さない)。 */
let usedBytes = 0;
/** 容量が100%に達しているかどうか。達している場合は登録処理そのものをスキップする。 */
let usageAtCapacity = false;

// ---- NG登録容量ゲージ ----

/** usedBytes を元に容量ゲージの表示(%・警告色)を更新し、容量到達フラグ(usageAtCapacity)も併せて再計算する。 */
function renderUsage(): void {
  const percent = Math.min(100, Math.round((usedBytes / SYNC_TOTAL_BUDGET) * 100));
  usageAtCapacity = percent >= 100;

  usageBadge.textContent = `${percent}%`;
  usageBadge.classList.remove('usage-warn', 'usage-full');
  if (percent >= 90) usageBadge.classList.add('usage-full');
  else if (percent >= 70) usageBadge.classList.add('usage-warn');

  updateByteBudget();
}

getSyncUsageBytes().then((bytes) => {
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

// フラグを切り替えるだけでデータ移送は行わない(正DBは常にlocal)。
// OFF→ONの追いつき同期はbackgroundがフラグ変更を検知して実行する。
syncLocalCheckbox.addEventListener('change', async () => {
  syncLocalCheckbox.disabled = true;
  try {
    await setSyncEnabled(!syncLocalCheckbox.checked);
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

/** updateMatchIndicatorから呼び出されるprivate */
function setMatchState(ok: boolean): void {
  matchIndicator.classList.toggle('match-ok', ok);
  matchIndicator.classList.toggle('match-ng', !ok);
  matchIndicator.textContent = t(ok ? 'match.ok' : 'match.ng', currentLang);
}

/** サンプル入力欄がパターン欄の正規表現にマッチするかをリアルタイムで判定し、適合/不適合で表示する。 */
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

/** フォームのラジオボタンから現在選択中の適用対象(video/channel/both)を取得する。 */
function getSelectedTarget(): MatchTarget {
  return (document.querySelector('input[name="target"]:checked') as HTMLInputElement).value as MatchTarget;
}

/**
 * 入力中のパターンがルール1件としてあと何バイト入るかをリアルタイムで表示し、
 * 上限超過または容量100%到達時は登録ボタンをガードする。
 * 一般/上級者どちらのタブがアクティブかで、参照する入力欄と表示先の要素を出し分ける。
 */
function updateByteBudget(): void {
  const budgetEl = getActiveTab() === 'general' ? budgetTextGeneral : budgetText;

  if (usageAtCapacity) {
    budgetEl.textContent = t('budget.capacityFull', currentLang);
    btnSubmit.disabled = true;
    return;
  }

  const used = estimateEntryBytes(getSelectedTarget(), getSelectedMatchType(), getActiveValue());
  const remaining = MAX_ENTRY_BYTES - used;

  budgetEl.textContent = remaining >= 0
    ? t('budget.remaining', currentLang, { n: remaining })
    : t('budget.tooLong', currentLang);
  btnSubmit.disabled = remaining < 0;
}

// 一般/上級者どちらの入力欄・一致方法ラジオを操作しても、アクティブタブ側の容量ゲージへ反映する
generalInput.addEventListener('input', updateByteBudget);
regexInput.addEventListener('input', updateByteBudget);
[...generalMatchRadios(), ...advancedMatchRadios()].forEach((el) => {
  el.addEventListener('change', updateByteBudget);
});
document.querySelectorAll<HTMLInputElement>('input[name="target"]').forEach((el) => {
  el.addEventListener('change', updateByteBudget);
});

/** 指定した適用対象(video/channel/both)に対応するラジオボタンを選択状態にする。 */
function setSelectedTarget(target: MatchTarget): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="target"][value="${target}"]`);
  if (radio) radio.checked = true;
}

/**
 * 指定エントリの内容をフォームへ流し込み、編集モードへ切り替える。
 * matchTypeがregexなら上級者タブ、exact/partialなら一般タブを自動で開く。
 * 値は両タブの入力欄に同じものを入れておき、編集中にタブを行き来しても引き継がれるようにする。
 */
function enterEditMode(entry: BlockEntry): void {
  editingId = entry.id;
  generalInput.value = entry.value;
  regexInput.value = entry.value;
  sampleInput.value = '';
  setSelectedTarget(entry.target);

  const tab: FormTab = entry.matchType === 'regex' ? 'advanced' : 'general';
  setActiveTab(tab);
  lastActiveTab = tab; // change イベント経由ではなく直接切り替えるため、同期用の状態も手動で合わせる
  setSelectedMatchType('general', entry.matchType);
  setSelectedMatchType('advanced', entry.matchType);

  updateMatchIndicator();
  updateByteBudget();
  formCard.classList.add('is-editing');
  btnSubmit.textContent = t('btn.update', currentLang);
  (tab === 'general' ? generalInput : regexInput).focus();
}

/** 編集モードを終了し、新規登録モードに戻す。タブは更新/登録に関わらず現在選択中のものを維持する。 */
function exitEditMode(): void {
  editingId = null;
  generalInput.value = '';
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
  // 値・一致方法とも、現在アクティブなタブ側の入力欄/ラジオを見る
  const raw = getActiveValue().trim();
  if (!raw) return;
  const target = getSelectedTarget();
  const matchType = getSelectedMatchType();

  if (editingId) {
    await updateEntry(editingId, { target, value: raw, matchType });
    exitEditMode();
  } else {
    const entry: BlockEntry = {
      id: generateId(),
      target,
      matchType,
      value: raw,
      createdAt: Date.now(),
    };
    await addEntry(entry);
    // 値はタブ間で共有しているため、登録後は両方の入力欄をクリアする
    generalInput.value = '';
    regexInput.value = '';
    sampleInput.value = '';
    updateMatchIndicator();
    updateByteBudget();
  }

  await renderList();
}

btnSubmit.addEventListener('click', handleSubmit);

// ---- ルールリスト描画 ----

/** ルールの適用対象(video/channel/both)を表示言語のラベル文字列に変換する。 */
function targetLabel(entry: BlockEntry): string {
  if (entry.target === 'video')   return t('target.video', currentLang);
  if (entry.target === 'channel') return t('target.channel', currentLang);
  return t('target.both', currentLang);
}

/** ルールの適用対象(video/channel/both)を一覧のバッジ用CSSクラス名に変換する。 */
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
    typeBadge.className = `entry-badge badge-${entry.matchType}`;
    typeBadge.textContent = t(`matchType.${entry.matchType}`, currentLang);

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

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes[STORAGE_KEYS.log] || changes[STORAGE_KEYS.logDisabled]) renderLog();
    // 正DBのルール変更(このタブの編集・他タブ・コンテンツスクリプト・receiverのマージ)は全部ここに届く
    if (changes[STORAGE_KEYS.rules]) renderList();
    return;
  }

  if (area === 'sync') {
    // senderの書き込み・他デバイスの送信箱更新を、キーごとの差分バイト数だけキャッシュへ反映する
    // (getSyncUsageBytes と同じく同期フィードのキーのみを集計対象にする)
    for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
      if (!isSyncFeedKey(key)) continue;
      const oldSize = oldValue === undefined ? 0 : itemByteSize(key, oldValue);
      const newSize = newValue === undefined ? 0 : itemByteSize(key, newValue);
      usedBytes += newSize - oldSize;
    }
    renderUsage();
  }
});

// 初回描画は applyLanguage()(getLanguage() 解決後) が担う。
