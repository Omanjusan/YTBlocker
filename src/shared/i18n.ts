/**
 * 自前の軽量i18n機構。
 * browser.i18n(_locales)はブラウザの言語設定に固定されユーザーが実行時に切り替えられないため、
 * オプション画面の言語セレクタで即時切替できるよう独自の辞書ベースで実装する。
 */

export type Lang = 'ja' | 'en' | 'de' | 'it' | 'fr' | 'ko' | 'zh-CN' | 'zh-TW';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'fr', label: 'Français' },
  { code: 'ko', label: '한국어' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
];

const DEFAULT_LANG: Lang = 'ja';
const LANG_STORAGE_KEY = 'ytblocker_lang';

type Dict = Record<Lang, string>;

const messages: Record<string, Dict> = {
  'header.settings': {
    ja: '設定', en: 'Settings', de: 'Einstellungen', it: 'Impostazioni',
    fr: 'Paramètres', ko: '설정', 'zh-CN': '设置', 'zh-TW': '設定',
  },
  'usage.label': {
    ja: 'NG登録容量:', en: 'Blocklist capacity:', de: 'Sperrlisten-Kapazität:', it: 'Capacità elenco blocchi:',
    fr: 'Capacité de la liste de blocage :', ko: '차단 등록 용량:', 'zh-CN': '屏蔽名单容量:', 'zh-TW': '封鎖名單容量:',
  },
  'options.title': {
    ja: 'オプション設定', en: 'Options', de: 'Optionen', it: 'Opzioni',
    fr: 'Options', ko: '옵션 설정', 'zh-CN': '选项设置', 'zh-TW': '選項設定',
  },
  'lang.label': {
    ja: '言語設定：', en: 'Language:', de: 'Sprache:', it: 'Lingua:',
    fr: 'Langue :', ko: '언어 설정:', 'zh-CN': '语言设置：', 'zh-TW': '語言設定：',
  },
  'sync.disable.label': {
    ja: 'FIREFOXアカウントに保存しない（ローカル保存）',
    en: 'Do not save to Firefox Account (local storage only)',
    de: 'Nicht im Firefox-Konto speichern (nur lokal)',
    it: 'Non salvare nell’account Firefox (solo locale)',
    fr: 'Ne pas enregistrer dans le compte Firefox (stockage local uniquement)',
    ko: 'FIREFOX 계정에 저장하지 않음(로컬 저장)',
    'zh-CN': '不保存到 FIREFOX 账户（仅本地保存）',
    'zh-TW': '不保存到 FIREFOX 帳戶（僅本機保存）',
  },
  'shorts.label': {
    ja: 'ショート動画をすべて非表示にする', en: 'Hide all Shorts', de: 'Alle Shorts ausblenden', it: 'Nascondi tutti gli Shorts',
    fr: 'Masquer tous les Shorts', ko: '모든 쇼츠 동영상 숨기기', 'zh-CN': '隐藏所有 Shorts 短视频', 'zh-TW': '隱藏所有 Shorts 短影片',
  },
  'scout.label': {
    ja: '観測モード（未対応カードをコンソールに報告。通常はOFF）',
    en: 'Scout mode (reports unsupported cards to console. Usually OFF)',
    de: 'Beobachtungsmodus (meldet nicht unterstützte Karten in der Konsole. Normalerweise AUS)',
    it: 'Modalità di osservazione (segnala le schede non supportate nella console. Normalmente disattivata)',
    fr: 'Mode observation (signale les cartes non prises en charge dans la console. Généralement désactivé)',
    ko: '관측 모드(미지원 카드를 콘솔에 보고. 일반적으로 OFF)',
    'zh-CN': '观测模式（将不支持的卡片报告到控制台，通常为关闭）',
    'zh-TW': '觀測模式（將不支援的卡片回報到控制台，通常為關閉）',
  },
  'form.title': {
    ja: 'ブロックルールを追加（正規表現）', en: 'Add block rule (regex)', de: 'Sperrregel hinzufügen (Regex)', it: 'Aggiungi regola di blocco (regex)',
    fr: 'Ajouter une règle de blocage (regex)', ko: '차단 규칙 추가(정규식)', 'zh-CN': '添加屏蔽规则（正则表达式）', 'zh-TW': '新增封鎖規則（正規表示式）',
  },
  'form.editTag': {
    ja: '✎ 編集中', en: '✎ Editing', de: '✎ Wird bearbeitet', it: '✎ In modifica',
    fr: '✎ Modification en cours', ko: '✎ 편집 중', 'zh-CN': '✎ 编辑中', 'zh-TW': '✎ 編輯中',
  },
  'form.sampleLabel': {
    ja: 'サンプル文字列（動画タイトルまたはチャンネル名）　例 test ch',
    en: 'Sample text (video title or channel name)  e.g. test ch',
    de: 'Beispieltext (Videotitel oder Kanalname)  z. B. test ch',
    it: 'Testo di esempio (titolo del video o nome del canale)  es. test ch',
    fr: 'Texte d’exemple (titre de la vidéo ou nom de la chaîne)  ex. test ch',
    ko: '샘플 문자열(동영상 제목 또는 채널명)  예: test ch',
    'zh-CN': '示例文本（视频标题或频道名称） 例：test ch',
    'zh-TW': '範例文字（影片標題或頻道名稱） 例：test ch',
  },
  'form.regexLabel': {
    ja: '正規表現パターン　例 aaaa | bbbb', en: 'Regex pattern  e.g. aaaa | bbbb', de: 'Regex-Muster  z. B. aaaa | bbbb', it: 'Pattern regex  es. aaaa | bbbb',
    fr: 'Motif regex  ex. aaaa | bbbb', ko: '정규식 패턴  예: aaaa | bbbb', 'zh-CN': '正则表达式  例：aaaa | bbbb', 'zh-TW': '正規表示式  例：aaaa | bbbb',
  },
  'form.matchNote': {
    ja: 'サンプル文字列との判定結果は下の行頭に表示されます。サンプル文字列が空なら常に「不適合」表示',
    en: 'The match result against the sample text is shown at the start of the line below. If the sample is empty, it always shows "No match".',
    de: 'Das Vergleichsergebnis mit dem Beispieltext wird am Anfang der Zeile unten angezeigt. Ist das Beispiel leer, wird immer „Keine Übereinstimmung“ angezeigt.',
    it: 'Il risultato del confronto con il testo di esempio viene mostrato all’inizio della riga sottostante. Se il campione è vuoto, viene sempre mostrato "Nessuna corrispondenza".',
    fr: 'Le résultat de la comparaison avec le texte d’exemple s’affiche en début de ligne ci-dessous. Si l’exemple est vide, « Aucune correspondance » s’affiche toujours.',
    ko: '샘플 문자열과의 판정 결과는 아래 줄 앞에 표시됩니다. 샘플 문자열이 비어 있으면 항상 "불일치"로 표시됩니다.',
    'zh-CN': '与示例文本的比对结果显示在下方行首。示例文本为空时始终显示"不匹配"',
    'zh-TW': '與範例文字的比對結果顯示在下方行首。範例文字為空時一律顯示「不符合」',
  },
  'match.ok': {
    ja: '✓ 適合', en: '✓ Match', de: '✓ Treffer', it: '✓ Corrisponde',
    fr: '✓ Correspond', ko: '✓ 일치', 'zh-CN': '✓ 匹配', 'zh-TW': '✓ 符合',
  },
  'match.ng': {
    ja: '✗ 不適合', en: '✗ No match', de: '✗ Kein Treffer', it: '✗ Nessuna corrispondenza',
    fr: '✗ Aucune correspondance', ko: '✗ 불일치', 'zh-CN': '✗ 不匹配', 'zh-TW': '✗ 不符合',
  },
  'match.compareLabel': {
    ja: 'サンプル文字列との比較：', en: 'Compared to sample: ', de: 'Vergleich mit Beispiel: ', it: 'Confronto con il campione: ',
    fr: 'Comparaison avec l’exemple : ', ko: '샘플 문자열과의 비교: ', 'zh-CN': '与示例文本的比对：', 'zh-TW': '與範例文字的比對：',
  },
  'budget.remaining': {
    ja: 'あと約{n}バイト入力できます', en: 'About {n} more bytes available', de: 'Noch etwa {n} Byte verfügbar', it: 'Ancora circa {n} byte disponibili',
    fr: 'Environ {n} octets restants', ko: '약 {n}바이트 더 입력할 수 있습니다', 'zh-CN': '还可输入约 {n} 字节', 'zh-TW': '還可輸入約 {n} 位元組',
  },
  'budget.tooLong': {
    ja: 'パターンが長すぎます(バイト数が上限を超えています)',
    en: 'Pattern is too long (byte limit exceeded)',
    de: 'Muster ist zu lang (Byte-Limit überschritten)',
    it: 'Il pattern è troppo lungo (limite di byte superato)',
    fr: 'Le motif est trop long (limite d’octets dépassée)',
    ko: '패턴이 너무 깁니다(바이트 상한 초과)',
    'zh-CN': '规则过长（超出字节上限）',
    'zh-TW': '規則過長（超出位元組上限）',
  },
  'budget.capacityFull': {
    ja: 'NG登録容量が上限に達しているため、これ以上登録できません',
    en: 'Blocklist capacity is full; no more rules can be added',
    de: 'Die Sperrlisten-Kapazität ist erschöpft, es können keine weiteren Regeln hinzugefügt werden',
    it: 'La capacità dell’elenco blocchi è esaurita: non è possibile aggiungere altre regole',
    fr: 'La capacité de la liste de blocage est atteinte, impossible d’ajouter d’autres règles',
    ko: '차단 등록 용량이 가득 차서 더 이상 등록할 수 없습니다',
    'zh-CN': '屏蔽名单容量已满，无法继续添加规则',
    'zh-TW': '封鎖名單容量已滿，無法繼續新增規則',
  },
  'target.legend': {
    ja: '適用対象', en: 'Applies to', de: 'Gilt für', it: 'Si applica a',
    fr: 'S’applique à', ko: '적용 대상', 'zh-CN': '适用对象', 'zh-TW': '適用對象',
  },
  'target.video': {
    ja: '動画', en: 'Video', de: 'Video', it: 'Video',
    fr: 'Vidéo', ko: '동영상', 'zh-CN': '视频', 'zh-TW': '影片',
  },
  'target.channel': {
    ja: 'チャンネル', en: 'Channel', de: 'Kanal', it: 'Canale',
    fr: 'Chaîne', ko: '채널', 'zh-CN': '频道', 'zh-TW': '頻道',
  },
  'target.both': {
    ja: '両方', en: 'Both', de: 'Beides', it: 'Entrambi',
    fr: 'Les deux', ko: '둘 다', 'zh-CN': '两者', 'zh-TW': '兩者',
  },
  'manual.start':      { ja: '先頭', en: 'start', de: 'Anfang', it: 'inizio', fr: 'début', ko: '시작', 'zh-CN': '开头', 'zh-TW': '開頭' },
  'manual.end':         { ja: '末尾', en: 'end', de: 'Ende', it: 'fine', fr: 'fin', ko: '끝', 'zh-CN': '结尾', 'zh-TW': '結尾' },
  'manual.anyChar':     { ja: '任意の1文字', en: 'any 1 char', de: 'ein beliebiges Zeichen', it: 'un carattere qualsiasi', fr: 'un caractère quelconque', ko: '임의의 한 글자', 'zh-CN': '任意单个字符', 'zh-TW': '任意單一字元' },
  'manual.zeroOrMore':  { ja: '0回以上', en: '0 or more', de: '0 oder mehr', it: '0 o più', fr: '0 ou plus', ko: '0회 이상', 'zh-CN': '0次以上', 'zh-TW': '0次以上' },
  'manual.oneOrMore':   { ja: '1回以上', en: '1 or more', de: '1 oder mehr', it: '1 o più', fr: '1 ou plus', ko: '1회 이상', 'zh-CN': '1次以上', 'zh-TW': '1次以上' },
  'manual.zeroOrOne':   { ja: '0または1回', en: '0 or 1', de: '0 oder 1', it: '0 o 1', fr: '0 ou 1', ko: '0회 또는 1회', 'zh-CN': '0次或1次', 'zh-TW': '0次或1次' },
  'manual.anyOf':       { ja: 'a・b・cのいずれか', en: 'any of a, b, c', de: 'a, b oder c', it: 'una tra a, b, c', fr: 'a, b ou c', ko: 'a・b・c 중 하나', 'zh-CN': 'a、b、c 之一', 'zh-TW': 'a、b、c 之一' },
  'manual.noneOf':      { ja: 'a・b・c以外', en: 'none of a, b, c', de: 'weder a, b noch c', it: 'nessuno tra a, b, c', fr: 'ni a, ni b, ni c', ko: 'a・b・c 이외', 'zh-CN': '非 a、b、c', 'zh-TW': '非 a、b、c' },
  'manual.or':          { ja: 'aまたはb', en: 'a or b', de: 'a oder b', it: 'a o b', fr: 'a ou b', ko: 'a 또는 b', 'zh-CN': 'a 或 b', 'zh-TW': 'a 或 b' },
  'manual.digit':       { ja: '数字', en: 'digit', de: 'Ziffer', it: 'cifra', fr: 'chiffre', ko: '숫자', 'zh-CN': '数字', 'zh-TW': '數字' },
  'manual.word':        { ja: '単語文字', en: 'word char', de: 'Wortzeichen', it: 'carattere alfanumerico', fr: 'caractère alphanumérique', ko: '단어 문자', 'zh-CN': '单词字符', 'zh-TW': '單字字元' },
  'manual.space':       { ja: '空白', en: 'whitespace', de: 'Leerzeichen', it: 'spazio', fr: 'espace', ko: '공백', 'zh-CN': '空白', 'zh-TW': '空白' },
  'manual.iFlag': {
    ja: 'フラグ（末尾に /i）: 大文字小文字を無視',
    en: 'flag (append /i): ignore case',
    de: 'Flag (an /i anhängen): Groß-/Kleinschreibung ignorieren',
    it: 'flag (aggiungi /i): ignora maiuscole/minuscole',
    fr: 'drapeau (ajouter /i) : ignorer la casse',
    ko: '플래그(끝에 /i 추가): 대소문자 무시',
    'zh-CN': '标志（末尾加 /i）：忽略大小写',
    'zh-TW': '旗標（末尾加 /i）：忽略大小寫',
  },
  'btn.submit':       { ja: '登録', en: 'Add', de: 'Hinzufügen', it: 'Aggiungi', fr: 'Ajouter', ko: '등록', 'zh-CN': '添加', 'zh-TW': '新增' },
  'btn.update':       { ja: '更新', en: 'Update', de: 'Aktualisieren', it: 'Aggiorna', fr: 'Mettre à jour', ko: '수정', 'zh-CN': '更新', 'zh-TW': '更新' },
  'btn.cancelEdit':   { ja: '編集をキャンセル', en: 'Cancel editing', de: 'Bearbeitung abbrechen', it: 'Annulla modifica', fr: 'Annuler la modification', ko: '편집 취소', 'zh-CN': '取消编辑', 'zh-TW': '取消編輯' },
  'rules.title':      { ja: '登録済みルール', en: 'Saved rules', de: 'Gespeicherte Regeln', it: 'Regole salvate', fr: 'Règles enregistrées', ko: '등록된 규칙', 'zh-CN': '已保存的规则', 'zh-TW': '已儲存的規則' },
  'rules.empty':      { ja: 'ルールがありません', en: 'No rules yet', de: 'Keine Regeln vorhanden', it: 'Nessuna regola presente', fr: 'Aucune règle enregistrée', ko: '등록된 규칙이 없습니다', 'zh-CN': '暂无规则', 'zh-TW': '尚無規則' },
  'matchType.regex':  { ja: '正規表現', en: 'Regex', de: 'Regex', it: 'Regex', fr: 'Regex', ko: '정규식', 'zh-CN': '正则表达式', 'zh-TW': '正規表示式' },
  'matchType.exact':  { ja: '完全一致', en: 'Exact match', de: 'Exakte Übereinstimmung', it: 'Corrispondenza esatta', fr: 'Correspondance exacte', ko: '완전 일치', 'zh-CN': '完全匹配', 'zh-TW': '完全符合' },
  'btn.edit':         { ja: '編集', en: 'Edit', de: 'Bearbeiten', it: 'Modifica', fr: 'Modifier', ko: '편집', 'zh-CN': '编辑', 'zh-TW': '編輯' },
  'btn.delete':       { ja: '削除', en: 'Delete', de: 'Löschen', it: 'Elimina', fr: 'Supprimer', ko: '삭제', 'zh-CN': '删除', 'zh-TW': '刪除' },
  'log.title':        { ja: 'ブロックログ（直近50件）', en: 'Block log (last 50)', de: 'Sperrprotokoll (letzte 50)', it: 'Registro dei blocchi (ultimi 50)', fr: 'Journal des blocages (50 derniers)', ko: '차단 로그(최근 50건)', 'zh-CN': '屏蔽日志（最近 50 条）', 'zh-TW': '封鎖紀錄（最近 50 筆）' },
  'btn.clearLog':     { ja: 'ログをクリア', en: 'Clear log', de: 'Protokoll leeren', it: 'Cancella registro', fr: 'Effacer le journal', ko: '로그 지우기', 'zh-CN': '清除日志', 'zh-TW': '清除紀錄' },
  'log.empty':        { ja: 'ログはありません', en: 'No log entries', de: 'Keine Protokolleinträge', it: 'Nessuna voce nel registro', fr: 'Aucune entrée de journal', ko: '로그가 없습니다', 'zh-CN': '暂无日志', 'zh-TW': '尚無紀錄' },
  'log.video':        { ja: '動画: ', en: 'Video: ', de: 'Video: ', it: 'Video: ', fr: 'Vidéo : ', ko: '동영상: ', 'zh-CN': '视频: ', 'zh-TW': '影片: ' },
  'log.channel':      { ja: 'CH: ', en: 'Channel: ', de: 'Kanal: ', it: 'Canale: ', fr: 'Chaîne : ', ko: '채널: ', 'zh-CN': '频道: ', 'zh-TW': '頻道: ' },
  'log.pattern':      { ja: 'パターン: ', en: 'Pattern: ', de: 'Muster: ', it: 'Pattern: ', fr: 'Motif : ', ko: '패턴: ', 'zh-CN': '规则: ', 'zh-TW': '規則: ' },
  'popup.blocking':   { ja: 'ブロック中:', en: 'Blocking:', de: 'Blockiert:', it: 'In blocco:', fr: 'Bloqués :', ko: '차단 중:', 'zh-CN': '屏蔽中:', 'zh-TW': '封鎖中:' },
  'popup.unit':       { ja: '件', en: '', de: '', it: '', fr: '', ko: '건', 'zh-CN': '条', 'zh-TW': '筆' },
  'popup.openOptions':{ ja: '設定を開く', en: 'Open settings', de: 'Einstellungen öffnen', it: 'Apri impostazioni', fr: 'Ouvrir les paramètres', ko: '설정 열기', 'zh-CN': '打开设置', 'zh-TW': '開啟設定' },
};

/** {name}形式のプレースホルダを変数値で置換して翻訳文字列を取得する。 */
export function t(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  const dict = messages[key];
  const raw = dict?.[lang] ?? dict?.[DEFAULT_LANG] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

/** 選択言語を storage.local から取得する。未保存または不正値なら日本語。 */
export async function getLanguage(): Promise<Lang> {
  const result = await browser.storage.local.get(LANG_STORAGE_KEY);
  const stored = result[LANG_STORAGE_KEY] as Lang | undefined;
  return LANGS.some((l) => l.code === stored) ? (stored as Lang) : DEFAULT_LANG;
}

export async function setLanguage(lang: Lang): Promise<void> {
  await browser.storage.local.set({ [LANG_STORAGE_KEY]: lang });
}

/** [data-i18n] を持つ要素のtextContentと、[data-i18n-placeholder] を持つ入力のplaceholderを一括で差し替える。 */
export function applyStaticI18n(lang: Lang, root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!, lang);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder!, lang);
  });
}

/** Intl系ロケール文字列(toLocaleString等で使用)。辞書に無い言語はブラウザ標準フォーマットへフォールバックする。 */
export function toIntlLocale(lang: Lang): string {
  const map: Record<Lang, string> = {
    ja: 'ja-JP', en: 'en-US', de: 'de-DE', it: 'it-IT',
    fr: 'fr-FR', ko: 'ko-KR', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW',
  };
  return map[lang];
}
