import type { Candle, SymbolInfo, Ticker24h, Timeframe } from "./types";

const BASE = "https://api.binance.com/api/v3";

/**
 * Caché de corta vida + deduplicación de peticiones en vuelo.
 *
 * Todas las llamadas se hacen desde el navegador del usuario contra Binance,
 * que aplica su rate limit sobre la IP del usuario. Alternar rápido de
 * símbolo/timeframe (o múltiples componentes pidiendo el mismo ticker)
 * puede disparar bans temporales 418/429. Un TTL corto:
 *  - deduplica peticiones idénticas concurrentes (in-flight),
 *  - sirve la última respuesta durante `ttlMs`,
 * sin afectar la frescura percibida porque las velas/precios en vivo llegan
 * por WebSocket; estas llamadas REST solo traen el snapshot inicial / 24h.
 */
interface CacheEntry<T> {
  ts: number;
  value: Promise<T>;
}

const requestCache = new Map<string, CacheEntry<unknown>>();

function cachedJson<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = requestCache.get(key) as CacheEntry<T> | undefined;
  if (hit && now - hit.ts < ttlMs) {
    return hit.value;
  }
  const value = loader().catch((err) => {
    // No cachear fallos: permitir reintento inmediato.
    if (requestCache.get(key)?.value === value) requestCache.delete(key);
    throw err;
  });
  requestCache.set(key, { ts: now, value });
  return value;
}

export async function fetchKlines(
  symbol: string,
  interval: Timeframe,
  limit = 1000,
): Promise<Candle[]> {
  const sym = symbol.toUpperCase();
  const url = `${BASE}/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
  return cachedJson(`klines:${sym}:${interval}:${limit}`, 5_000, async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`klines ${res.status}`);
    const data = (await res.json()) as unknown[][];
    return data.map((k) => ({
      time: Math.floor((k[0] as number) / 1000),
      open: parseFloat(k[1] as string),
      high: parseFloat(k[2] as string),
      low: parseFloat(k[3] as string),
      close: parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
      isFinal: true,
    }));
  });
}

export async function fetchTicker24h(symbol: string): Promise<Ticker24h> {
  const sym = symbol.toUpperCase();
  const url = `${BASE}/ticker/24hr?symbol=${sym}`;
  return cachedJson(`ticker:${sym}`, 4_000, async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`ticker ${res.status}`);
    const t = await res.json();
    return {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChange: parseFloat(t.priceChange),
      priceChangePercent: parseFloat(t.priceChangePercent),
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
      volume: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
    };
  });
}

export async function fetchTickers24h(symbols: string[]): Promise<Ticker24h[]> {
  const upper = symbols.map((s) => s.toUpperCase());
  const arr = JSON.stringify(upper);
  const url = `${BASE}/ticker/24hr?symbols=${encodeURIComponent(arr)}`;
  // Clave estable independiente del orden de entrada.
  const key = `tickers:${[...upper].sort().join(",")}`;
  return cachedJson(key, 4_000, async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`tickers ${res.status}`);
    const data = await res.json();
    return data.map((t: Record<string, string>) => ({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChange: parseFloat(t.priceChange),
      priceChangePercent: parseFloat(t.priceChangePercent),
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
      volume: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
    }));
  });
}

let cachedSymbols: SymbolInfo[] | null = null;
export async function fetchExchangeSymbols(): Promise<SymbolInfo[]> {
  if (cachedSymbols) return cachedSymbols;
  const res = await fetch(`${BASE}/exchangeInfo`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
  const data = await res.json();
  cachedSymbols = data.symbols
    .filter(
      (s: { status: string; quoteAsset: string }) =>
        s.status === "TRADING" && s.quoteAsset === "USDT",
    )
    .map((s: { symbol: string; baseAsset: string; quoteAsset: string; status: string }) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      status: s.status,
    }));
  return cachedSymbols!;
}
