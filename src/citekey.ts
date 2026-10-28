import * as http from 'http';
import { App } from 'obsidian';

import { findPdf } from './pdfrender';
import { TrackedIndex } from './tracked';
import { ZoteroMirrorSettings } from './types';

/**
 * Resolving a citekey to the PDF link for its paper.
 *
 * The rest of this plugin only ever travels the other way: citekeys come OUT
 * of Zotero during an import, carried on items fetched by changed-since, by
 * tag or by collection. Nothing asked "which item has this citekey", because
 * nothing needed to -- a note exists precisely when the plugin made it.
 *
 * Dendrite needs the opposite, and for papers with no note at all: it draws a
 * citation as a link to the paper's PDF so the hover can preview it, and most
 * cited papers are read without ever being annotated. A citekey with no note
 * is the normal case there, not the edge.
 *
 * Two sources, cheapest first:
 *
 *   1. The literature note, if there is one. Its first `zotero://open-pdf`
 *      link is the same one the hover already previews, and reading it needs
 *      no network, so this keeps working with Zotero closed.
 *   2. Better BibTeX's JSON-RPC, which is the only interface that maps a
 *      citekey to an item. Zotero's own local API has no citekey filter: it
 *      reports `citationKey` on items you already found some other way. BBT
 *      with pinned citekeys is already required to use this plugin at all, so
 *      this adds no new dependency.
 *
 * Positive answers are cached for the session; negative ones are not, so a
 * key asked while Zotero was closed resolves on a later hover rather than
 * staying dead until Obsidian restarts.
 */
export class CitekeyAttachments {
  /** citekey -> `zotero://open-pdf/...`. Only ever holds hits. */
  private cache = new Map<string, string>();

  constructor(
    private app: App,
    private settings: ZoteroMirrorSettings,
    private tracked: TrackedIndex,
  ) {}

  /** After a host/port change, or the answers belong to the old Zotero. */
  forget(): void {
    this.cache.clear();
  }

  /**
   * The PDF link for a citekey, or null if nothing could be resolved.
   *
   * Returns the whole link rather than a bare attachment key, so a group
   * library's `zotero://open-pdf/groups/<id>/items/<key>` survives: the key
   * alone cannot say which library it came from.
   */
  async linkFor(citekey: string): Promise<string | null> {
    const key = citekey.replace(/^@/, '').trim();
    if (!key) return null;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const fromNote = await this.noteLink(key);
    if (fromNote) {
      this.cache.set(key, fromNote);
      return fromNote;
    }

    const fromZotero = await this.zoteroLink(key);
    if (fromZotero) {
      this.cache.set(key, fromZotero);
      return fromZotero;
    }

    // Deliberately not cached. Zotero may simply not be running.
    return null;
  }

  /** The first `zotero://open-pdf` link in this citekey's note, if any. */
  private async noteLink(citekey: string): Promise<string | null> {
    const file = this.tracked.fileFor(citekey);
    if (!file) return null;
    let content: string;
    try {
      content = await this.app.vault.cachedRead(file);
    } catch {
      return null;
    }
    const m = content.match(OPEN_PDF);
    return m ? base(m[0]) : null;
  }

  /** Ask Better BibTeX which attachments the citekey's item has. */
  private async zoteroLink(citekey: string): Promise<string | null> {
    let result: unknown;
    try {
      result = await this.rpc('item.attachments', [citekey]);
    } catch {
      return null;
    }
    if (!Array.isArray(result)) return null;
    return this.choose(result);
  }

  /**
   * Pick the attachment to preview.
   *
   * Not simply the first: a paper whose supplement is listed first would hand
   * the reader a hover on the wrong document, with nothing marking it wrong.
   * So prefer one whose file is actually in Zotero's storage, by the same
   * check the hover itself uses -- which also demotes a linked-file
   * attachment and a WebDAV paper that has not been fetched, since neither
   * can be rendered. When none is local the link is still returned: a preview
   * is impossible but clicking through to Zotero is not.
   */
  private choose(entries: unknown[]): string | null {
    const pdfs: string[] = [];
    for (const entry of entries) {
      const e = entry as { open?: unknown; path?: unknown };
      if (typeof e.open !== 'string' || !OPEN_PDF.test(e.open)) continue;
      if (typeof e.path !== 'string') continue;
      if (!e.path.toLowerCase().endsWith('.pdf')) continue;
      pdfs.push(base(e.open));
    }
    if (pdfs.length === 0) return null;

    const local = pdfs.find((link) => {
      const key = link.match(ITEM_KEY);
      return key ? findPdf(this.settings.zoteroDataDir, key[1]!) !== null : false;
    });
    return local ?? pdfs[0]!;
  }

  /**
   * One JSON-RPC call to Better BibTeX.
   *
   * Node's `http` rather than Obsidian's requestUrl or fetch, for the reason
   * `ZoteroClient` gives: Electron's networking layer frequently fails on
   * localhost `http://` requests. BBT shares Zotero's port, so the configured
   * host and port are the right ones.
   */
  private rpc(method: string, params: unknown[]): Promise<unknown> {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.settings.zoteroHost,
          port: this.settings.zoteroPort,
          path: '/better-bibtex/json-rpc',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (d) => (body += d));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`Better BibTeX replied ${res.statusCode}`));
              return;
            }
            try {
              const json = JSON.parse(body);
              // A JSON-RPC error is a 200 with an `error` member, so a bare
              // `result` read would silently treat a failure as "no PDF".
              if (json?.error) {
                reject(new Error(String(json.error?.message ?? 'rpc error')));
                return;
              }
              resolve(json?.result);
            } catch (e) {
              reject(e instanceof Error ? e : new Error('bad JSON'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(RPC_TIMEOUT_MS, () =>
        req.destroy(new Error('Better BibTeX request timed out')),
      );
      req.end(payload);
    });
  }
}

const RPC_TIMEOUT_MS = 8000;

/** A `zotero://open-pdf` link, stopping before markdown or quoting syntax. */
const OPEN_PDF = /zotero:\/\/open-pdf\/[^\s)\]}"'<>]+/;

/** The attachment key in either the user-library or group-library form. */
const ITEM_KEY = /\/items\/([A-Z0-9]+)/i;

/**
 * The link without its query.
 *
 * A citation names a paper, not a passage in it, so it must open at page 1.
 * Whatever `page=` or `annotation=` a note's backlink or BBT's answer happens
 * to carry would otherwise decide where an unrelated citation lands.
 */
function base(link: string): string {
  return link.split('?')[0]!;
}
