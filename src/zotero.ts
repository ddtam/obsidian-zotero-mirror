import { requestUrl, RequestUrlResponse } from 'obsidian';

import { ZoteroItemData } from './types';

export interface ChangedResult {
  items: ZoteroItemData[];
  newVersion: number;
}

/**
 * Thin read-only client for Zotero 7+'s built-in local HTTP API
 * (http://localhost:23119/api). GET-only; no writes ever leave Obsidian.
 */
export class ZoteroClient {
  private base: string;
  /** Per-poll item cache so resolving many annotations of one paper is cheap. */
  private cache = new Map<string, ZoteroItemData>();

  constructor(host: string, port: number) {
    // `/users/0` is the local alias for the current user library.
    this.base = `http://${host}:${port}/api/users/0`;
  }

  /** Clear the short-lived item cache (call at the start of each poll). */
  resetCache(): void {
    this.cache.clear();
  }

  private header(res: RequestUrlResponse, name: string): string | undefined {
    const want = name.toLowerCase();
    for (const k of Object.keys(res.headers ?? {})) {
      if (k.toLowerCase() === want) return res.headers[k];
    }
    return undefined;
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await requestUrl({
        url: `${this.base}/items?limit=1`,
        method: 'GET',
        throw: false,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** Current top library version (used to baseline on first install). */
  async getCurrentVersion(): Promise<number> {
    const res = await requestUrl({
      url: `${this.base}/items?limit=1`,
      method: 'GET',
      throw: false,
    });
    return parseInt(this.header(res, 'Last-Modified-Version') ?? '0', 10) || 0;
  }

  private nextLink(res: RequestUrlResponse): string | null {
    const link = this.header(res, 'Link');
    if (!link) return null;
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    return m ? m[1] : null;
  }

  /** All items changed since `version`, with full `data`, following pagination. */
  async getChangedSince(version: number): Promise<ChangedResult> {
    let url = `${this.base}/items?since=${version}&limit=100&include=data`;
    const items: ZoteroItemData[] = [];
    let newVersion = version;
    let first = true;

    while (url) {
      const res = await requestUrl({ url, method: 'GET', throw: false });
      if (res.status !== 200) break;
      if (first) {
        newVersion =
          parseInt(this.header(res, 'Last-Modified-Version') ?? '0', 10) || version;
        first = false;
      }
      const page = (res.json ?? []) as Array<{ data: ZoteroItemData }>;
      for (const entry of page) {
        if (entry?.data) {
          this.cache.set(entry.data.key, entry.data);
          items.push(entry.data);
        }
      }
      url = this.nextLink(res) ?? '';
    }

    return { items, newVersion };
  }

  /** Fetch a single item's `data` (cached within the current poll). */
  async getItemData(key: string): Promise<ZoteroItemData | null> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    const res = await requestUrl({
      url: `${this.base}/items/${key}?include=data`,
      method: 'GET',
      throw: false,
    });
    if (res.status !== 200) return null;
    const data = (res.json?.data ?? null) as ZoteroItemData | null;
    if (data) this.cache.set(key, data);
    return data;
  }

  /**
   * Walk an item up to its top-level parent.
   *   annotation -> attachment (parentItem) -> top-level (parentItem)
   *   attachment -> top-level (parentItem)
   *   anything else is already top-level.
   */
  async resolveTopLevel(data: ZoteroItemData): Promise<ZoteroItemData | null> {
    let current: ZoteroItemData | null = data;
    let hops = 0;
    while (current?.parentItem && hops < 4) {
      current = await this.getItemData(current.parentItem);
      hops++;
    }
    return current;
  }

  /**
   * Top-level journal articles carrying any of `tags` — the backfill set.
   * Uses the API's `tag=a || b` OR syntax.
   */
  async getTaggedItems(itemType: string, tags: string[]): Promise<ZoteroItemData[]> {
    const tagExpr = encodeURIComponent(tags.join(' || '));
    let url = `${this.base}/items?itemType=${itemType}&tag=${tagExpr}&limit=100&include=data`;
    const items: ZoteroItemData[] = [];
    while (url) {
      const res = await requestUrl({ url, method: 'GET', throw: false });
      if (res.status !== 200) break;
      const page = (res.json ?? []) as Array<{ data: ZoteroItemData }>;
      for (const entry of page) if (entry?.data) items.push(entry.data);
      url = this.nextLink(res) ?? '';
    }
    return items;
  }
}
