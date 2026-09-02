import type { ZoteroCollectionData, ZoteroItemData, ZoteroMirrorSettings } from './types';
// Type-only, so `node --test` (strip-only TS) never loads the client module.
import type { ZoteroClient } from './zotero';

/**
 * Collection-based exclusion: items in configured collections — and all of
 * their subcollections — are fully excluded from the mirror. The marker is
 * collection membership rather than a tag, so filing a book (e.g. into
 * "RPG Manuals") is the only maintenance and nothing can be forgotten.
 *
 * Cost model: the item `data` the poll already fetches carries
 * `collections: string[]`, so the per-item check is a Set lookup. Only the
 * collection tree (one small request) and the excluded collections' top
 * items (one request per excluded collection, for the citekey-only code
 * paths) are fetched, on a TTL.
 */

/** How long a resolved exclusion set is trusted before re-fetching. */
const TTL_MS = 10 * 60 * 1000;

/**
 * Expand configured collection names into the full set of excluded keys.
 *
 * Trim + case-insensitive exact match against ALL collections (an excluded
 * collection may itself be a subcollection, so no root-only scan), then BFS
 * to every descendant. Duplicate names all match — simple and predictable;
 * the mitigation is picking a distinctive name. Names that match nothing are
 * reported so a rename in Zotero is noticed instead of silently ignored.
 */
export function computeExcludedKeys(
  collections: ZoteroCollectionData[],
  names: string[],
): { keys: Set<string>; unmatched: string[] } {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0);
  const keys = new Set<string>();
  const unmatched: string[] = [];
  if (wanted.length === 0) return { keys, unmatched };

  const children = new Map<string, string[]>();
  for (const c of collections) {
    if (typeof c.parentCollection === 'string') {
      const list = children.get(c.parentCollection) ?? [];
      list.push(c.key);
      children.set(c.parentCollection, list);
    }
  }

  for (const name of wanted) {
    const seeds = collections.filter((c) => c.name.trim().toLowerCase() === name);
    if (seeds.length === 0) {
      unmatched.push(name);
      continue;
    }
    const queue = seeds.map((c) => c.key);
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (keys.has(key)) continue;
      keys.add(key);
      for (const child of children.get(key) ?? []) queue.push(child);
    }
  }
  return { keys, unmatched };
}

/**
 * The live resolver: caches the excluded key set (for items whose data is in
 * hand) and the excluded citekey set (for the citekey-only code paths:
 * importOne, re-import-all).
 *
 * Failure policy: last-known-good. A failed refresh keeps the previous set;
 * only when NOTHING has ever resolved this session and exclusions are
 * configured does refreshIfStale() return false, telling the poll to abort
 * the cycle without advancing the library version — the same changes are
 * re-fetched next tick. Failing open instead would import an excluded item
 * once, which the REFRESH path would then keep fresh forever.
 */
export class CollectionExclusions {
  private keys: Set<string> | null = null;
  private citekeys = new Set<string>();
  private fetchedAt = 0;
  unmatched: string[] = [];

  // Plain fields, not parameter properties: Node's strip-only TS (used by
  // `npm test` to import this module) cannot strip parameter properties.
  private client: () => ZoteroClient;
  private settings: ZoteroMirrorSettings;

  constructor(client: () => ZoteroClient, settings: ZoteroMirrorSettings) {
    this.client = client;
    this.settings = settings;
  }

  /** Number of excluded collections (for the status line). */
  collectionCount(): number {
    return this.keys?.size ?? 0;
  }

  /** Number of excluded top-level items seen (for the status line). */
  itemCount(): number {
    return this.citekeys.size;
  }

  invalidate(): void {
    this.fetchedAt = 0;
  }

  /**
   * True when polling may proceed. False only in the cold-start failure case
   * (see class comment); the caller should skip the cycle and retry.
   */
  async refreshIfStale(): Promise<boolean> {
    const configured = this.settings.excludedCollections.some((n) => n.trim().length > 0);
    if (!configured) {
      this.keys = new Set();
      this.citekeys = new Set();
      this.unmatched = [];
      return true;
    }
    if (this.keys !== null && Date.now() - this.fetchedAt < TTL_MS) return true;

    try {
      const collections = await this.client().getAllCollections();
      const { keys, unmatched } = computeExcludedKeys(
        collections,
        this.settings.excludedCollections,
      );
      const citekeys = new Set<string>();
      for (const key of keys) {
        for (const item of await this.client().getCollectionTopItems(key)) {
          const citekey = item.citationKey?.replace(/^@/, '').trim();
          if (citekey) citekeys.add(citekey);
        }
      }
      this.keys = keys;
      this.citekeys = citekeys;
      this.unmatched = unmatched;
      this.fetchedAt = Date.now();
      if (unmatched.length > 0) {
        console.warn(
          `[zotero-mirror] excluded collections not found in Zotero: ${unmatched.join(', ')}`,
        );
      }
      return true;
    } catch (e) {
      if (this.keys !== null) {
        // Last-known-good: keep excluding what we knew about.
        console.warn('[zotero-mirror] exclusion refresh failed; using last-known-good', e);
        return true;
      }
      console.warn('[zotero-mirror] exclusions unresolved; skipping poll cycle', e);
      return false;
    }
  }

  /** Membership check for an item whose top-level `data` is in hand. */
  isExcludedItem(top: ZoteroItemData): boolean {
    if (!this.keys || this.keys.size === 0) return false;
    return (top.collections ?? []).some((k) => this.keys!.has(k));
  }

  /** Membership check for the citekey-only code paths. */
  isExcludedCitekey(citekey: string): boolean {
    return this.citekeys.has(citekey);
  }
}
