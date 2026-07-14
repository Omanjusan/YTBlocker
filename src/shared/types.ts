export type MatchTarget = 'video' | 'channel' | 'both';
export type MatchType = 'exact' | 'regex';

export interface BlockEntry {
  id: string;
  target: MatchTarget;
  matchType: MatchType;
  value: string;
  createdAt: number;
}

export interface BlockLog {
  videoTitle: string;
  channelName: string;
  matchedValue: string;
  blockedAt: number;
}
