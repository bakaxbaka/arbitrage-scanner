export interface PriceData {
  source: string;
  venue: string;
  chain: string | null;
  pair: string;
  baseToken: string;
  quoteToken: string;
  price: number;
  volume24h?: number;
  liquidityUsd?: number;
  bid?: number;
  ask?: number;
  updatedAt: Date;
}

class PriceStore {
  private prices: Map<string, PriceData> = new Map();

  set(data: PriceData) {
    const key = `${data.source}:${data.venue}:${data.pair}`;
    this.prices.set(key, data);
  }

  getAll(): PriceData[] {
    return Array.from(this.prices.values());
  }

  getByPair(pair: string): PriceData[] {
    return this.getAll().filter((p) => p.pair === pair);
  }

  getLatest(source: string, venue: string, pair: string): PriceData | undefined {
    const key = `${source}:${venue}:${pair}`;
    return this.prices.get(key);
  }

  getAllPairs(): string[] {
    return [...new Set(this.getAll().map((p) => p.pair))];
  }

  getAllVenues(): string[] {
    return [...new Set(this.getAll().map((p) => p.venue))];
  }

  size(): number {
    return this.prices.size;
  }
}

export const priceStore = new PriceStore();
