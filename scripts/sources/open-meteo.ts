// Open-Meteo 現在気象。キー不要、無制限、商用 OK。
// https://open-meteo.com/en/docs

import { fetchJson, writeJson, sleep } from "../lib/io.ts";
import type { ClimateNow } from "../lib/types.ts";
import { COUNTRY_META } from "../lib/countries.ts";

interface OpenMeteoResponse {
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    weather_code: number;
  };
}

export async function fetchOpenMeteo(): Promise<void> {
  console.log("• Open-Meteo (weather)…");
  const results: Record<string, ClimateNow> = {};

  for (const meta of Object.values(COUNTRY_META)) {
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${meta.lat}&longitude=${meta.lng}` +
        `&current=temperature_2m,relative_humidity_2m,weather_code` +
        `&timezone=${encodeURIComponent(meta.timezone)}`;
      const body = await fetchJson<OpenMeteoResponse>(url);
      results[meta.code] = {
        countryCode: meta.code,
        cityName: meta.cityName,
        tempC: body.current.temperature_2m,
        humidity: body.current.relative_humidity_2m,
        weatherCode: body.current.weather_code,
        asOf: body.current.time,
      };
      await sleep(120);
    } catch (e) {
      console.warn(`  ! ${meta.code}: ${(e as Error).message}`);
    }
  }

  await writeJson("open-meteo.json", results);
}
