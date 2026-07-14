import type { BlockEntry, BlockLog } from './types';

export const STORAGE_KEYS = {
  list: 'ytblocker_list',
  log: 'ytblocker_log',
  blockShorts: 'ytblocker_block_shorts',
  debounceDelay: 'ytblocker_debounce_delay',
} as const;

const KEY           = STORAGE_KEYS.list;
const LOG_KEY        = STORAGE_KEYS.log;
const SHORTS_KEY     = STORAGE_KEYS.blockShorts;
const DEBOUNCE_KEY   = STORAGE_KEYS.debounceDelay;
const LOG_MAX        = 50;

export const DEFAULT_DEBOUNCE_DELAY = 300;

export async function getEntries(): Promise<BlockEntry[]> {
  const result = await browser.storage.local.get(KEY);
  return (result[KEY] as BlockEntry[] | undefined) ?? [];
}

export async function addEntry(entry: BlockEntry): Promise<void> {
  const entries = await getEntries();
  entries.push(entry);
  await browser.storage.local.set({ [KEY]: entries });
}

export async function removeEntry(id: string): Promise<void> {
  const entries = await getEntries();
  await browser.storage.local.set({ [KEY]: entries.filter((e) => e.id !== id) });
}

export async function getLogs(): Promise<BlockLog[]> {
  const result = await browser.storage.local.get(LOG_KEY);
  return (result[LOG_KEY] as BlockLog[] | undefined) ?? [];
}

export async function addLogs(newEntries: BlockLog[]): Promise<void> {
  if (newEntries.length === 0) return;
  const logs = await getLogs();
  const combined = [...newEntries, ...logs].slice(0, LOG_MAX);
  await browser.storage.local.set({ [LOG_KEY]: combined });
}

export async function clearLogs(): Promise<void> {
  await browser.storage.local.set({ [LOG_KEY]: [] });
}

export async function getBlockShortsEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(SHORTS_KEY);
  return (result[SHORTS_KEY] as boolean | undefined) ?? false;
}

export async function setBlockShortsEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SHORTS_KEY]: enabled });
}

export async function getDebounceDelay(): Promise<number> {
  const result = await browser.storage.local.get(DEBOUNCE_KEY);
  return (result[DEBOUNCE_KEY] as number | undefined) ?? DEFAULT_DEBOUNCE_DELAY;
}

export async function setDebounceDelay(ms: number): Promise<void> {
  await browser.storage.local.set({ [DEBOUNCE_KEY]: ms });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
