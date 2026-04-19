// FRED (Federal Reserve Economic Data, St. Louis Fed) から主要株価指数の日次終値を取得。
//
// 設計意図:
//   - FRED は米国連邦準備制度が運営する公的データサービス。商用利用含めて広く公開されている。
//   - API key 付きの JSON endpoint もあるが、`fredgraph.csv?id=SYMBOL` は key 不要で
//     過去 10 年分の CSV を返す。Phase A は MVP なのでこちらを使う（登録待ち不要）。
//   - 取得対象は「地球儀トップで見せても映える主要 4 指数」に絞る。指数が多すぎると
//     BI カード側が雑然とするので、UI と合わせて 4 で固定。
//
// 踏んではいけない地雷:
//   - FRED CSV は土日祝に値を出さない。tail でデータ行だけ読むようにし、空行は skip。
//   - NIKKEI225 は JPY 建て、SP500/DJIA/NASDAQ は USD 建て。currency を個別に設定する。
//   - changePct は直近 2 営業日の close 差。同日連続値が返ることがあるので dedup が必要。

import { fetchText, writeJson, sleep } from "../lib/io.ts";
import type { StockIndex, ForexRate } from "../lib/types.ts";

/**
 * FRED series の定義。指数を追加したいときはここに 1 行足すだけ。
 * symbol は Mundeye UI 表示用（FRED の ID と人間向け名称を分ける）。
 */
interface FredSeries {
  fredId: string;
  symbol: string;
  name: string;
  countryCode: string;
  currency: string;
}

const SERIES: readonly FredSeries[] = [
  { fredId: "SP500", symbol: "SPX", name: "S&P 500", countryCode: "US", currency: "USD" },
  { fredId: "DJIA", symbol: "DJI", name: "Dow Jones", countryCode: "US", currency: "USD" },
  { fredId: "NASDAQCOM", symbol: "IXIC", name: "NASDAQ Composite", countryCode: "US", currency: "USD" },
  { fredId: "NIKKEI225", symbol: "N225", name: "Nikkei 225", countryCode: "JP", currency: "JPY" },
];

/**
 * CSV を parse して「日付と close の pair 配列（新しい順）」を返す。
 * FRED の CSV フォーマットは固定で `observation_date,<id>` の 2 列、NA は "." で返る。
 * 先頭はヘッダ行、2 行目以降がデータ。
 */
function parseFredCsv(csv: string): Array<{ date: string; value: number }> {
  const lines = csv.trim().split("\n").slice(1); // skip header
  const rows: Array<{ date: string; value: number }> = [];
  for (const line of lines) {
    const [date, valueStr] = line.split(",");
    if (!date || !valueStr || valueStr === "." || valueStr === "NA") continue;
    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;
    rows.push({ date, value });
  }
  // 新しい順に返す（末尾が最新）
  return rows.reverse();
}

export async function fetchFredStock(): Promise<void> {
  console.log("• FRED (stock indices)…");
  const results: StockIndex[] = [];

  for (const series of SERIES) {
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.fredId}`;
      const csv = await fetchText(url, 30_000);
      const rows = parseFredCsv(csv);

      if (rows.length < 2) {
        throw new Error(`not enough data (got ${rows.length} rows)`);
      }

      const latest = rows[0];
      const prev = rows[1];
      const changePct = ((latest.value - prev.value) / prev.value) * 100;

      results.push({
        symbol: series.symbol,
        name: series.name,
        countryCode: series.countryCode,
        price: latest.value,
        changePct: Number(changePct.toFixed(2)),
        currency: series.currency,
        asOf: new Date(latest.date + "T00:00:00Z").toISOString(),
      });

      console.log(`  ✓ ${series.symbol}: ${latest.value} (${changePct.toFixed(2)}%) @ ${latest.date}`);

      // FRED は連邦機関運営で rate limit 緩めだが、連投は避ける
      await sleep(150);
    } catch (e) {
      console.warn(`  ! ${series.fredId}: ${(e as Error).message}`);
    }
  }

  if (results.length === 0) {
    // 空で上書きすると既存スナップショットを壊すので throw（fetch.ts 側で catch して
    // 既存 JSON を残す。writeJson の「空上書き保護」と同じ思想）
    throw new Error("all FRED series failed — skipping write to preserve previous snapshot");
  }

  await writeJson("fred-stock.json", results);
}

/**
 * 為替シリーズの定義。FRED の DEXxxYY シリーズは base/quote の方向が紛らわしいので
 * 明示的に pair/base/quote を併記する（定義ミスを commit diff で見つけやすい）。
 *
 * FRED 命名規則:
 *   - DEXAAAB: "A currency per B currency"（A 通貨で B 通貨 1 単位を表す値）
 *   - DEXJPUS = JPY per USD → "USD/JPY" (1 USD = X JPY)
 *   - DEXUSEU = USD per EUR → "EUR/USD" (1 EUR = X USD)
 */
interface FredForexSeries {
  fredId: string;
  pair: string;
  base: string;
  quote: string;
}

const FOREX_SERIES: readonly FredForexSeries[] = [
  { fredId: "DEXJPUS", pair: "USD/JPY", base: "USD", quote: "JPY" },
  { fredId: "DEXUSEU", pair: "EUR/USD", base: "EUR", quote: "USD" },
  { fredId: "DEXUSUK", pair: "GBP/USD", base: "GBP", quote: "USD" },
  { fredId: "DEXCHUS", pair: "USD/CNY", base: "USD", quote: "CNY" },
  { fredId: "DEXCAUS", pair: "USD/CAD", base: "USD", quote: "CAD" },
  { fredId: "DEXKOUS", pair: "USD/KRW", base: "USD", quote: "KRW" },
];

export async function fetchFredForex(): Promise<void> {
  console.log("• FRED (forex rates)…");
  const results: ForexRate[] = [];

  for (const series of FOREX_SERIES) {
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.fredId}`;
      const csv = await fetchText(url, 30_000);
      const rows = parseFredCsv(csv);

      if (rows.length < 2) {
        throw new Error(`not enough data (got ${rows.length} rows)`);
      }

      const latest = rows[0];
      const prev = rows[1];
      const changePct = ((latest.value - prev.value) / prev.value) * 100;

      results.push({
        pair: series.pair,
        base: series.base,
        quote: series.quote,
        rate: latest.value,
        changePct: Number(changePct.toFixed(2)),
        asOf: new Date(latest.date + "T00:00:00Z").toISOString(),
      });

      console.log(`  ✓ ${series.pair}: ${latest.value} (${changePct.toFixed(2)}%) @ ${latest.date}`);
      await sleep(150);
    } catch (e) {
      console.warn(`  ! ${series.fredId}: ${(e as Error).message}`);
    }
  }

  if (results.length === 0) {
    throw new Error("all FRED forex series failed — skipping write to preserve previous snapshot");
  }

  await writeJson("fred-forex.json", results);
}
