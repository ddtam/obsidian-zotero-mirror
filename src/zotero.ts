import * as http from 'http';

import { ZoteroItemData } from './types';

export interface ChangedResult {
  items: ZoteroItemData[];
  newVersion: number;
}

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  json: any;
}

// Match the headers the Zotero Integration plugin sends.
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'obsidian/zotero-mirror',
  Accept: 'application/json',
};

/**
 * Thin read-only client for Zotero 7+'s built-in local HTTP API
 * (http://localhost:23119/api). GET-only; no writes ever leave Obsidian.
 *
 * Uses Node's `http` module rather than Obsidian's requestUrl/fetch: those go
 * through Electron's networking layer, which frequently fails on localhost
 * `http://` requests (private-network / proxy handling). A direct socket is
 * reliable and exposes the response headers we need (Last-Modified-Version, Link).
 */
export class ZoteroClient {
  private prefix = '/api/users/0';
  /** Per-poll item cache so resolving many annotations of one paper is cheap. */
  private cache = new Map<string, ZoteroItemData>();

  constructor(
    private host: string,
    private port: number,
  ) {}

  resetCache(): void {
    this.cache.clear();
  }

  private get(pathOrUrl: string): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
      let host = this.host;
      let port = this.port;
      let path = pathOrUrl;
      if (/^https?:\/\//i.test(pathOrUrl)) {
        const u = new URL(pathOrUrl);
        host = u.hostname;
        port = parseInt(u.port || '80', 10);
        path = u.pathname + u.search;
      }
      const req = http.request(
        { host, port, path, method: 'GET', headers: DEFAULT_HEADERS },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            let json: any;
            try {
              json = body ? JSON.parse(body) : undefined;
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(8000, () => req.destroy(new Error('Zotero request timed out')));
      req.end();
    });
  }

  private header(res: HttpResult, name: string): string | undefined {
    const v = res.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  }

  private nextLink(res: HttpResult): string | null {
    const link = this.header(res, 'Link');
    if (!link) return null;
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    return m ? m[1] : null;
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await this.get(`${this.prefix}/items?limit=1`);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** Current top library version (used to baseline on first install). */
  async getCurrentVersion(): Promise<number> {
    const res = await this.get(`${this.prefix}/items?limit=1`);
    return parseInt(this.header(res, 'Last-Modified-Version') ?? '0', 10) || 0;
  }

  /** All items changed since `version`, with full `data`, following pagination. */
  async getChangedSince(version: number): Promise<ChangedResult> {
    let url = `${this.prefix}/items?since=${version}&limit=100&include=data`;
    const items: ZoteroItemData[] = [];
    let newVersion = version;
    let first = true;

    while (url) {
      const res = await this.get(url);
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
    const res = await this.get(`${this.prefix}/items/${key}?include=data`);
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
    let url = `${this.prefix}/items?itemType=${itemType}&tag=${tagExpr}&limit=100&include=data`;
    const items: ZoteroItemData[] = [];
    while (url) {
      const res = await this.get(url);
      if (res.status !== 200) break;
      const page = (res.json ?? []) as Array<{ data: ZoteroItemData }>;
      for (const entry of page) if (entry?.data) items.push(entry.data);
      url = this.nextLink(res) ?? '';
    }
    return items;
  }
}
