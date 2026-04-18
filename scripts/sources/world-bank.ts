// World Bank Open Data（人口 SP.POP.TOTL）。キー不要、完全無料。
// 年次更新なので週 1 回で十分。

import { fetchJson, writeJson, sleep } from "../lib/io.ts";
import type { PopulationStat } from "../lib/types.ts";
import { COUNTRY_META } from "../lib/countries.ts";

export async function fetchWorldBankPopulation(): Promise<void> {
  console.log("• World Bank (population)…");
  const results: Record<string, PopulationStat> = {};

  for (const meta of Object.values(COUNTRY_META)) {
    try {
      const url = `https://api.worldbank.org/v2/country/${meta.code}/indicator/SP.POP.TOTL?format=json&per_page=5`;
      const body = await fetchJson<unknown>(url);
      if (!Array.isArray(body) || !Array.isArray(body[1])) {
        throw new Error("unexpected shape");
      }
      const rows = body[1] as Array<{ date: string; value: number | null }>;
      const latest = rows.find((r) => r.value != null);
      if (!latest) throw new Error("no data");
      results[meta.code] = {
        countryCode: meta.code,
        population: latest.value as number,
        year: Number(latest.date),
      };
      await sleep(120);
    } catch (e) {
      console.warn(`  ! ${meta.code}: ${(e as Error).message}`);
    }
  }

  await writeJson("world-bank-population.json", results);
}
