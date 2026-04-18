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
import { writeJson } from "./lib/io.ts";

// 株価指数は stooq が 2026 に API key 必須化したため外した。
// 代替は FRED / Alpha Vantage（要 key、GitHub Secrets 経由）。Phase A はモックで進める。
type SourceName = "gdelt" | "rss" | "open-meteo" | "world-bank";

const SOURCES: Record<SourceName, () => Promise<void>> = {
  gdelt: fetchGdelt,
  rss: fetchRssJa,
  "open-meteo": fetchOpenMeteo,
  "world-bank": fetchWorldBankPopulation,
};

// MODE ごとの実行対象
const MODE_SETS: Record<string, SourceName[]> = {
  hourly: ["gdelt", "rss", "open-meteo"],
  weekly: ["world-bank"],
  all: ["gdelt", "rss", "open-meteo", "world-bank"],
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
