import * as http from 'http';

/**
 * Asking Zotero to settle an item's annotations before the note is written.
 *
 * WHY THIS EXISTS. Zotero Automations rewrites a maths highlight to the LaTeX
 * its book carries, in the annotation itself, and it reacts to Zotero's
 * notifier. This plugin polls on its own clock. Nothing sequences the two: the
 * note gets the normalised text because the quiet cooldown is far longer than
 * the rewrite takes, which is timing rather than a rule. One call, immediately
 * before the import, makes the order explicit.
 *
 * FAIL OPEN, ALWAYS. Every failure here — the plugin not installed, an old
 * version without the endpoint, a timeout, a Zotero that is busy — resolves to
 * `null` and the import proceeds. A note that briefly shows an unnormalised
 * equation is a small cost; a note that stops updating because a *different*
 * plugin is missing is not one worth risking, and would be near-impossible to
 * diagnose from the symptom.
 *
 * The request is a GET whose effect is a write, which is a deliberate exception
 * to this plugin's read-only rule and the reason it does not live in
 * `ZoteroClient`. The write happens inside Zotero, by the plugin that owns the
 * data; Obsidian only asks.
 */

export interface NormaliseResult {
  normalised: boolean;
  seen?: number;
  changed?: number;
  flagged?: number;
  reason?: string;
}

/**
 * Timeout for the whole call.
 *
 * It walks one item's annotations and may parse a chapter of an EPUB, which is
 * cached after the first. Ten seconds is far past that and still short enough
 * that a hung Zotero delays one import rather than stalling the queue.
 */
const TIMEOUT_MS = 10_000;

export function normaliseMaths(
  host: string,
  port: number,
  itemKey: string,
): Promise<NormaliseResult | null> {
  return new Promise((resolve) => {
    if (!itemKey) {
      resolve(null);
      return;
    }
    const path = `/zotero-automations/normalise-maths?item=${encodeURIComponent(itemKey)}`;
    const req = http.request(
      { host, port, path, method: 'GET', headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          // A 404 is the endpoint not being there at all, which is the normal
          // state of an older Zotero Automations and not worth a log line.
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body) as NormaliseResult);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('normalise timed out')));
    req.end();
  });
}
