// LBMA (London Bullion Market Association) の公開 JSON から金・銀スポット価格を取得する source。
//
// 設計意図:
//   - FRED には 2016 年以降 金 (GOLDAMGBD228NLBM / GOLDPMGBD228NLBM) / 銀 (SLVPRUSD) シリーズが
//     あるが、2020 年頃の LBMA ポリシー変更で連動シリーズが事実上停止済み。
//   - 代替として prices.lbma.org.uk の直下に「全履歴を JSON でまとめた public endpoint」
//     がある（apikey 不要、2026 時点でも 15 分更新で最新日付まで配信される）。
//   - `gold_pm.json` / `silver.json` はそれぞれ fix 価格の全履歴配列を返す。
//     v = [USD, GBP, EUR] per troy ounce。
//
// 踏んではいけない地雷:
//   - endpoint は history 全体を返すため数百 KB と大きい。cron 毎回 fetch するので
//     timeout は 30s まで余裕を取る（通常数秒で終わるが、LBMA CDN は深夜に遅いことがある）
//   - 日次 fix なので「今日の fix はまだ」という時間帯が存在する（UK 10:30/15:00 GMT 前）。
//     最新エントリは「直近で出た fix」なので asOf をその日付のまま信頼する。
//   - gold_am.json もあるが、日中に両方出る日と PM のみの日が混在するので PM を採用する
//     （市場が終わる頃の最終 fix）
//   - v 配列中の null は欧州・英国祝日で EUR/GBP fix が無い日に発生する。USD は常に入る

import { fetchJson, writeJson } from "../lib/io.ts";
import type { Commodity } from "../lib/types.ts";

interface LbmaEntry {
  is_cms_locked: 0 | 1;
  /** "2026-04-17" */
  d: string;
  /** [USD, GBP, EUR] per troy oz。欧州祝日で GBP/EUR が null になりうる */
  v: [number | null, number | null, number | null];
}

interface LbmaSeries {
  /** LBMA endpoint のファイル名（`gold_pm` / `silver` 等） */
  lbmaId: string;
  /** Mundeye UI 表示用 */
  symbol: string;
  name: string;
  /** "oz" 固定。ozt（troy ounce）を英語で書くと読みにくいので短縮 */
  unit: string;
}

// gold と silver の 2 本で商品タブの見栄えを埋める。
// PM fix は UK 15:00 GMT、市場クローズ前の公式値で信頼性が高い。
const SERIES: readonly LbmaSeries[] = [
  { lbmaId: "gold_pm", symbol: "GOLD", name: "金スポット", unit: "oz" },
  { lbmaId: "silver", symbol: "SILVER", name: "銀スポット", unit: "oz" },
];

const SNAPSHOT_NAME = "lbma-commodities.json";

export async function fetchLbmaCommodities(): Promise<void> {
  console.log("• LBMA (gold / silver fix)…");

  const results: Commodity[] = [];

  for (const series of SERIES) {
    try {
      const url = `https://prices.lbma.org.uk/json/${series.lbmaId}.json`;
      const data = await fetchJson<LbmaEntry[]>(url, 30_000);

      // USD fix が入っている最新エントリ 2 件を取り、前日比を計算。
      // USD が null のエントリ（極稀）は潰して遡る。
      const validUsd = data.filter((e) => typeof e.v[0] === "number");
      if (validUsd.length < 2) {
        throw new Error(`not enough USD-valid rows (got ${validUsd.length})`);
      }
      const latest = validUsd[validUsd.length - 1];
      const prev = validUsd[validUsd.length - 2];
      const latestPrice = latest.v[0] as number;
      const prevPrice = prev.v[0] as number;
      const changePct = Number((((latestPrice - prevPrice) / prevPrice) * 100).toFixed(2));

      results.push({
        symbol: series.symbol,
        name: series.name,
        price: latestPrice,
        changePct,
        currency: "USD",
        unit: series.unit,
        asOf: new Date(latest.d + "T00:00:00Z").toISOString(),
      });

      console.log(
        `  ✓ ${series.symbol}: $${latestPrice} (${changePct.toFixed(2)}%) @ ${latest.d}`,
      );
    } catch (e) {
      console.warn(`  ! ${series.lbmaId}: ${(e as Error).message}`);
    }
  }

  if (results.length === 0) {
    // 空上書き保護。LBMA がダウンした日に snapshot を消さない（Stooq と同じ思想）
    throw new Error("all LBMA series failed — skipping write to preserve previous snapshot");
  }

  await writeJson(SNAPSHOT_NAME, results);
}
