/** ブロックルールの適用対象。'both' は動画タイトル・チャンネル名のどちらか一致すればブロック。 */
export type MatchTarget = 'video' | 'channel' | 'both';
/** 'exact' は完全一致、'partial' は部分一致、'regex' は正規表現マッチ(`/pattern/flags` 形式にも対応)。 */
export type MatchType = 'exact' | 'partial' | 'regex';

/** ユーザーが登録したブロックルール1件分。 */
export interface BlockEntry {
  id: string;
  target: MatchTarget;
  matchType: MatchType;
  /** マッチ対象の文字列(完全一致テキスト or 正規表現パターン)。 */
  value: string;
  createdAt: number;
}

/** 実際にブロックが発動した際の履歴1件分(オプションページの「ログ」欄に表示)。 */
export interface BlockLog {
  videoTitle: string;
  channelName: string;
  /** どのルールにマッチしてブロックされたかを示す値。 */
  matchedValue: string;
  blockedAt: number;
}
