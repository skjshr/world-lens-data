// エントリポイント。CLI 引数で特定ソースだけ叩くこともできる。
//
// 使い方:
//   npm run fetch                 # 全ソース（ただし頻度モードに応じて絞る）
//   npm run fetch -- gdelt rss    # 指定ソースのみ
//   MODE=hourly  npm run fetch    # hourly 向け（news / weather / stock）
//   MODE=weekly  npm run fetch    # 低頻度（world-bank）
//
// Actions からは MODE で呼び分ける（cron 別に workflow step を分けてもよい）。

import { fetchGdelt } from "./sources/gdelt.ts";
import { fetchRssJa } from "./sources/rss.ts";
import { fetchOpenMeteo } from "./sources/open-meteo.ts";
import { fetchWorldBankPopulation } from "./sources/world-bank.ts";
import {
  fetchFredStock,
  fetchFredForex,
  fetchFredCommodities,
  fetchFredRates,
} from "./sources/fred.ts";
import { fetchStooqStock } from "./sources/stooq.ts";
import { fetchLbmaCommodities } from "./sources/lbma.ts";
import { writeJson } from "./lib/io.ts";

// 株価・為替・商品・金利: FRED の公開 CSV endpoint（API key 不要）を使う。
// Alpha Vantage は 25req/day 制限が厳しいので fallback 候補のみ。
type SourceName =
  | "gdelt"
  | "rss"
  | "open-meteo"
  | "world-bank"
  | "fred"
  | "fred-forex"
  | "fred-commodities"
  | "fred-rates"
  | "stooq"
  | "lbma";

const SOURCES: Record<SourceName, () => Promise<void>> = {
  gdelt: fetchGdelt,
  rss: fetchRssJa,
  "open-meteo": fetchOpenMeteo,
  "world-bank": fetchWorldBankPopulation,
  fred: fetchFredStock,
  "fred-forex": fetchFredForex,
  "fred-commodities": fetchFredCommodities,
  "fred-rates": fetchFredRates,
  stooq: fetchStooqStock,
  lbma: fetchLbmaCommodities,
};

// MODE ごとの実行対象
// - hourly: 日中動くデータ（ニュース、天気、株価、為替、商品、金利）。FRED は日次更新だが
//   CSV 取得は数秒で終わるため hourly に含めても CI コストはほぼゼロ。cron 分離しない。
// - weekly: 低頻度更新（world-bank は年次）
const MODE_SETS: Record<string, SourceName[]> = {
  hourly: [
    "gdelt",
    "rss",
    "open-meteo",
    "fred",
    "fred-forex",
    "fred-commodities",
    "fred-rates",
    "stooq",
    "lbma",
  ],
  weekly: ["world-bank"],
  all: [
    "gdelt",
    "rss",
    "open-meteo",
    "world-bank",
    "fred",
    "fred-forex",
    "fred-commodities",
    "fred-rates",
    "stooq",
    "lbma",
  ],
};

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a in SOURCES) as SourceName[];
  const mode = process.env.MODE ?? "all";
  const targets: SourceName[] =
    args.length > 0 ? args : (MODE_SETS[mode] ?? MODE_SETS.all);

  console.log(`world-lens-data fetch — ${new Date().toISOString()}`);
  console.log(`  mode=${mode}  targets=${targets.join(",")}\n`);

  const startedAt = new Date().toISOString();

  for (const name of targets) {
    try {
      await SOURCES[name]();
    } catch (e) {
      console.warn(`! ${name} failed: ${(e as Error).message}`);
    }
  }

  // 最終更新時刻を updated-at.json に記録（フロントで「n 分前」表示用）
  const finishedAt = new Date().toISOString();
  await writeJson("updated-at.json", {
    startedAt,
    finishedAt,
    targets,
    mode,
  });

  console.log("\ndone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
