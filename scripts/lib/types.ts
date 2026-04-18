// world-lens/src/lib/types.ts と互換の型。data repo は JSON しか吐かないので、
// フロント側が受け取るシェイプだけ合わせれば OK。

export interface NewsItem {
  id: string;
  headline: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string; // ISO8601
  countryCode: string;
  tone?: number;
  lang: string;
}

export interface StockIndex {
  symbol: string;
  name: string;
  countryCode: string;
  price: number;
  changePct: number;
  currency: string;
  asOf: string; // ISO8601
}

export interface ClimateNow {
  countryCode: string;
  cityName: string;
  tempC: number;
  weatherCode: number;
  humidity?: number;
  asOf: string;
}

export interface PopulationStat {
  countryCode: string;
  population: number;
  year: number;
}
