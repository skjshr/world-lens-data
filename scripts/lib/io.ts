// IO ヘルパ。snapshot 書き出しと、失敗時に既存値を残す書き方を統一する。

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_DIR = resolve(__dirname, "../../snapshots");

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJson(filename: string, data: unknown): Promise<void> {
  await ensureDir(SNAPSHOT_DIR);
  const full = resolve(SNAPSHOT_DIR, filename);
  await writeFile(full, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`  ✓ wrote ${filename}`);
}

export async function readJsonOr<T>(filename: string, fallback: T): Promise<T> {
  try {
    const full = resolve(SNAPSHOT_DIR, filename);
    const raw = await readFile(full, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** API 呼び出しの間隔を空ける（相手への礼儀 + レート制限回避） */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** fetch のラッパ。タイムアウトとステータスチェックを足す */
export async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "mundeye-data/0.2 (+https://github.com/skjshr/mundeye-data)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson<T = unknown>(url: string, timeoutMs = 20_000): Promise<T> {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text) as T;
}
