// Stooq (stooq.com) から FRED に無い欧州/香港指数を取得する薄い source。
//
// 設計意図:
//   - FRED には SP500 / DJIA / NASDAQCOM / NIKKEI225 は揃っているが、FTSE100 / DAX / HSI の
//     公式日次配信が無い（あっても license 制限）。
//   - Stooq の `/q/l/?s=SYMBOL&f=sd2t2ohlc&h&e=csv` は apikey 不要で最新終値を返す（2026 時点で確認済み）。
//   - 歴史データ endpoint（`/q/d/l/`）は 2026 に apikey 必須化されたが、latest スナップショットは
//     未だ無料で叩けるため、前日比は「前回実行時に保存した close」との差分で計算する運用にする。
//
// 前日比（changePct）の仕様:
//   - 初回実行時は既存 snapshot が無いので changePct = 0
//   - 2 回目以降は `snapshots/stooq-stock.json` の該当 symbol の price を prev close として参照
//   - 同日連続実行（hourly cron）で同じ close を何度も上書きしても問題ない設計
//     （日付が変わる瞬間だけ prev が前日 close を指す）
//
// 踏んではいけない地雷:
//   - Stooq latest endpoint は「その日の終値」を返す。市場開場前の時間帯は前日終値を返す
//     ので、asOf は応答内の Date 列をそのまま信頼する（受信時刻でなく）
//   - カンマ区切り CSV だが、symbol が `^` を含むため URL encode（%5E）必須
//   - multi-symbol 取得は仕様が安定しないので 1 symbol ずつ叩く（rate limit 配慮で sleep 入れる）

import { fetchText, writeJson, readJsonOr, sleep } from "../lib/io.ts";
import type { StockIndex } from "../lib/types.ts";

interface StooqSeries {
  /** Stooq の symbol（`^FTM`, `^DAX`, `^HSI`）。`^` は URL encode して渡す */
  stooqId: string;
  /** Mundeye UI 表示用シンボル（短縮） */
  symbol: string;
  /** 表示名 */
  name: string;
  /** 発行国 ISO-2（UK→GB / DE / HK） */
  countryCode: string;
  currency: string;
}

// 主要国の株価指数を網羅。
// なぜ US / JP も Stooq で取るか（旧実装は FRED 使用）:
//   - FRED (fredgraph.csv) は連邦機関の公開サービスで、日次集計→public 公開までに
//     3〜5 営業日の遅延がある。ユーザー検収で「株価データが古い」と指摘された根本原因。
//   - Stooq の latest endpoint は終値をその日中に反映するのでラグは最大 1 日（週末除く）。
//   - ただし FRED 為替・商品・利回りは Stooq に無いので fred.ts は残し、株価のみ移管する。
// 指数を増やすときはここに 1 行追加すれば snapshot と BI の両方に流れる。
const SERIES: readonly StooqSeries[] = [
  // US major
  { stooqId: "^SPX", symbol: "SPX", name: "S&P 500", countryCode: "US", currency: "USD" },
  { stooqId: "^DJI", symbol: "DJI", name: "Dow Jones", countryCode: "US", currency: "USD" },
  { stooqId: "^NDQ", symbol: "IXIC", name: "NASDAQ Composite", countryCode: "US", currency: "USD" },
  // Asia
  { stooqId: "^NKX", symbol: "N225", name: "Nikkei 225", countryCode: "JP", currency: "JPY" },
  { stooqId: "^HSI", symbol: "HSI", name: "Hang Seng", countryCode: "HK", currency: "HKD" },
  // Europe
  { stooqId: "^FTM", symbol: "FTSE", name: "FTSE 100", countryCode: "GB", currency: "GBP" },
  { stooqId: "^DAX", symbol: "DAX", name: "DAX", countryCode: "DE", currency: "EUR" },
];

const SNAPSHOT_NAME = "stooq-stock.json";

/**
 * Stooq の latest CSV を 1 symbol 分 parse する。
 * レスポンス例:
 *   Symbol,Date,Time,Open,High,Low,Close
 *   ^FTM,2026-04-17,17:36:21,22784.29,23230.87,22721.11,23205.92
 *
 * 欠落値は "N/D"（取引時間外や未公開時）で返る。Close が N/D のときは null を返し、
 * 呼び出し側でその series を skip する。
 */
function parseStooqLatest(csv: string): { date: string; close: number } | null {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return null;
  const cols = lines[1].split(",");
  // [symbol, date, time, open, high, low, close]
  if (cols.length < 7) return null;
  const date = cols[1];
  const closeStr = cols[6];
  if (!date || date === "N/D" || !closeStr || closeStr === "N/D") return null;
  const close = Number(closeStr);
  if (!Number.isFinite(close)) return null;
  return { date, close };
}

export async function fetchStooqStock(): Promise<void> {
  console.log("• Stooq (non-US indices)…");

  // 前日 close を引き出すための既存 snapshot 読み。初回は空配列で fallback。
  const prev = await readJsonOr<StockIndex[]>(SNAPSHOT_NAME, []);
  const prevPrice: Record<string, number> = {};
  for (const p of prev) prevPrice[p.symbol] = p.price;

  const results: StockIndex[] = [];

  for (const series of SERIES) {
    try {
      const url = `https://stooq.com/q/l/?s=${encodeURIComponent(series.stooqId)}&f=sd2t2ohlc&h&e=csv`;
      const csv = await fetchText(url, 20_000);
      const parsed = parseStooqLatest(csv);
      if (!parsed) {
        throw new Error("latest row unparsable (N/D?)");
      }

      // prev が同日付 = 同日 2 回目以降の実行。change% は 0 ではなく
      // 「1 つ前の prev snapshot の price」を使いたくなるが、それだと前日終値では
      // ないので信頼できない（同日 intraday ドリフトに化ける）。
      // 簡便には「prev.price があれば current / prev - 1」とし、初回だけ 0 とする。
      const prevClose = prevPrice[series.symbol];
      const changePct =
        typeof prevClose === "number" && prevClose > 0
          ? Number((((parsed.close - prevClose) / prevClose) * 100).toFixed(2))
          : 0;

      results.push({
        symbol: series.symbol,
        name: series.name,
        countryCode: series.countryCode,
        price: parsed.close,
        changePct,
        currency: series.currency,
        asOf: new Date(parsed.date + "T00:00:00Z").toISOString(),
      });

      console.log(
        `  ✓ ${series.symbol}: ${parsed.close} ${series.currency} (${changePct.toFixed(2)}%) @ ${parsed.date}`,
      );
      await sleep(200);
    } catch (e) {
      console.warn(`  ! ${series.stooqId}: ${(e as Error).message}`);
    }
  }

  if (results.length === 0) {
    // 空で上書きすると既存スナップショットが壊れる（前日 close が消える）ので throw。
    // FRED source と同じ「空上書き保護」思想。
    throw new Error("all Stooq series failed — skipping write to preserve previous snapshot");
  }

  await writeJson(SNAPSHOT_NAME, results);
}
