// 国コード → 代表座標・株価指数シンボル・気象都市。
// world-lens/src/data/countries.ts のコピー（repo 間を疎結合に保つためあえて複製）。
// Stooq 用シンボルを追加（Twelve Data とは記法が違うため）。

export interface CountryMeta {
  code: string;
  nameJa: string;
  lat: number;
  lng: number;
  /** Stooq シンボル（指数、^ プレフィックス小文字） */
  stooqSymbol: string;
  /** Stooq 指数の表示名 */
  indexName: string;
  /** 指数の通貨 */
  indexCurrency: string;
  cityName: string;
  timezone: string;
}

export const COUNTRY_META: Record<string, CountryMeta> = {
  JP: { code: "JP", nameJa: "日本",             lat: 35.6762,  lng: 139.6503,  stooqSymbol: "^nkx",   indexName: "日経平均",    indexCurrency: "JPY", cityName: "東京",           timezone: "Asia/Tokyo" },
  US: { code: "US", nameJa: "アメリカ合衆国",    lat: 38.9072,  lng: -77.0369,  stooqSymbol: "^spx",   indexName: "S&P 500",     indexCurrency: "USD", cityName: "ワシントンD.C.", timezone: "America/New_York" },
  GB: { code: "GB", nameJa: "イギリス",          lat: 51.5074,  lng: -0.1278,   stooqSymbol: "^ftm",   indexName: "FTSE 100",    indexCurrency: "GBP", cityName: "ロンドン",       timezone: "Europe/London" },
  DE: { code: "DE", nameJa: "ドイツ",            lat: 52.5200,  lng: 13.4050,   stooqSymbol: "^dax",   indexName: "DAX",         indexCurrency: "EUR", cityName: "ベルリン",       timezone: "Europe/Berlin" },
  FR: { code: "FR", nameJa: "フランス",          lat: 48.8566,  lng: 2.3522,    stooqSymbol: "^cac",   indexName: "CAC 40",      indexCurrency: "EUR", cityName: "パリ",           timezone: "Europe/Paris" },
  CN: { code: "CN", nameJa: "中国",              lat: 39.9042,  lng: 116.4074,  stooqSymbol: "^shc",   indexName: "上海総合",    indexCurrency: "CNY", cityName: "北京",           timezone: "Asia/Shanghai" },
  KR: { code: "KR", nameJa: "韓国",              lat: 37.5665,  lng: 126.9780,  stooqSymbol: "^kospi", indexName: "KOSPI",       indexCurrency: "KRW", cityName: "ソウル",         timezone: "Asia/Seoul" },
  IN: { code: "IN", nameJa: "インド",            lat: 28.6139,  lng: 77.2090,   stooqSymbol: "^nsei",  indexName: "Nifty 50",    indexCurrency: "INR", cityName: "ニューデリー",   timezone: "Asia/Kolkata" },
  BR: { code: "BR", nameJa: "ブラジル",          lat: -15.7801, lng: -47.9292,  stooqSymbol: "^bvp",   indexName: "Bovespa",     indexCurrency: "BRL", cityName: "ブラジリア",     timezone: "America/Sao_Paulo" },
  AU: { code: "AU", nameJa: "オーストラリア",    lat: -35.2809, lng: 149.1300,  stooqSymbol: "^aord",  indexName: "All Ords",    indexCurrency: "AUD", cityName: "キャンベラ",     timezone: "Australia/Sydney" },
};
