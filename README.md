# Zotero Mirror

Automatically keeps your Obsidian literature notes in sync with Zotero — so the moment
you annotate a paper (or flag it in your reading pile), its note appears/updates in your
vault and becomes searchable.

It does **not** fork or replace the [Zotero Integration]
(https://github.com/obsidian-community/obsidian-zotero-integration) plugin. It is a thin
companion that *detects* changes in Zotero and calls that plugin's existing
`runImport(format, citekey)` API, so all your templates and formatting stay exactly as
they are.

## How it works

Every ~45s the plugin polls Zotero's built-in local API (`http://localhost:23119/api`)
for items changed since last time, and decides what to do — in this order:

1. **REFRESH** — if a note already exists for the item (matched by `citekey` frontmatter),
   re-import it to stay fresh, **regardless of item type**. This is your opt-in to
   tracking: a book you've already pulled notes from keeps auto-updating.
2. **ENRICH** — else, if the change was a new **annotation** on an in-scope item
   (`journalArticle` by default), import it. Reading = the signal. (Scoped to journal
   articles so stray book highlights don't flood the vault.)
3. **STUB** — else, if it now carries a reading-pile / priority tag (📚️ 📖 ✅ 🔴 🟡 🔵),
   import it — **regardless of item type**. A deliberate tag is an explicit "track this"
   signal, so this is how you pull in a book, report, etc. Because Zotero tags sync, you
   can flag an item from **Zotero mobile** and it imports on your desktop.

Imports are **debounced**: a paper is only written once it has been "quiet" for the
cooldown (~90s), so a burst of highlights during a reading session produces **one** note
write, not dozens. This matters if you sync your vault with LiveSync.

## Important: import is a one-way overwrite

The Zotero Integration plugin **regenerates the whole note from Zotero** on every import;
only content inside `{% persist %}` blocks (e.g. your *Persistent Links* / *Persistent
Notes* sections) survives. Anything you type **outside** a persist block will be
overwritten on the next sync. This plugin re-imports more often than manual use, so keep
manual content in persist blocks.

## Setup

1. **Zotero**: enable the local API — Settings → Advanced → *Allow other applications on
   this computer to communicate with Zotero*. Better BibTeX with pinned citekeys must be
   installed (the Zotero Integration plugin already requires it).
2. **Install** this plugin (via [BRAT](https://github.com/TfTHacker/obsidian42-brat) from
   this repo, or copy `main.js` + `manifest.json` into
   `.obsidian/plugins/obsidian-zotero-mirror/`).
3. In settings, set **Import format** to your Zotero Integration export format name
   (default `Smart Import`) and turn on **Enable on this device** — on **one** device only.
4. (Optional) Click **Backfill reading pile** to import your existing tagged papers.

## Referencing a specific highlight

When writing a synthesis note, run **Insert highlight reference** (bind it to a hotkey).
Fuzzy-search every highlight in your vault — by its text, your comment on it, the author,
or the citekey — and pick one. It inserts two links:

```
…drives subgroup identity _[[Chromatin landscape…#^955J99SZ|in]]_ _[[Chromatin landscape…|Ochi et al. 2026]]_
```

Hovering **in** previews the highlight in context; the citation links to the source note.
The citation is derived from the note's own `authors`/`year` frontmatter (override it per
note with a `shortcite:` property).

This relies on each highlight carrying its Zotero annotation key as a block anchor
(` ^955J99SZ`), which your import template must emit. Because Zotero annotation keys are
stable and imports are full overwrites, the anchor is regenerated identically every time —
so the reference survives re-imports. Notes imported before you added the anchor to your
template have nothing to point at; **Re-import all tracked notes** in settings re-renders
them all (throttled).

### Optional: hovering into the PDF itself

By default references point at the *note's* block anchor, which needs no PDFs in your
vault and works on mobile. If you want the hover to show the actual PDF page instead, set
**Zotero PDF folder** to a folder in your vault containing Zotero's `storage/` tree
(normally a symlink). References then become:

```
[[9 - Zotero PDFs/PIIL4IA8/Ochi et al. - 2026 - ….pdf#page=5&rect=68.75,89.98,458.64,139.36|in]]
```

Base Obsidian honours `#page=` and gives you a popover of that page.
[PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus) additionally understands `rect=`
and draws a box on the highlight — it is **optional**, and installing it later upgrades
links you have already inserted, with no relinking.

> **Read this before setting the folder.** Everything in your vault syncs. Zotero's
> `storage/` is easily several GB, and most PDFs fall under LiveSync's file-size cap, so
> they *will* replicate to your remote — cleaning that up means rebuilding the database.
> **Exclude the folder from sync first, verify it, and only then create the symlink.**
> Prefer an allowlist (`syncOnlyRegEx`) over a blocklist: a forgotten allowlist entry means
> a file doesn't sync, whereas a forgotten blocklist entry means gigabytes upload
> irreversibly. Note that LiveSync's own settings do not sync between devices.

Page and rectangle come from Zotero's API, never from the note — the `[pg N]` in your notes
is the page *printed* on the paper (often a journal page like 2213) and is not the PDF's
physical page. Zotero stores one rectangle per line of a highlight; these are reduced to
the single rectangle a link can carry by grouping lines that share a column, so a highlight
wrapping between columns boxes one column rather than the whole page.

## Resolving `[[citekey]]` links

If you paste bare `[[citekey]]` wikilinks into your Zotero annotation comments, they import
verbatim and don't resolve — Obsidian matches link targets against filenames only and
never consults `aliases`. Turn on **Resolve citekey links** and they are rewritten in place
to point at the file while still displaying the citekey:

```
[[ochiChromatin…2026]]  ->  [[Chromatin landscape…|ochiChromatin…2026]]
```

Block anchors are preserved, ordinary links are untouched, and the rewrite is idempotent.
Use **Resolve citekey links now** to apply it to existing notes.

## Multi-device / LiveSync

Run it on a **single** designated device (`Enable on this device`). If two synced devices
both import the same paper you'll get conflicting note copies.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Enable on this device | off | Turn on for exactly one device. |
| Import format | `Smart Import` | Must match a Zotero Integration export format. |
| Poll interval | 45s | |
| Quiet cooldown | 90s | Batches a reading burst into one write. |
| Item types for new notes | `journalArticle` | Tracked notes update regardless of type. |
| Stub trigger tags | 📚️ 📖 ✅ 🔴 🟡 🔵 | Reuses your existing triage tags. |
| Source folder | `2 - Source Material` | Where notes live (citekey ⇒ tracked). |
| Citekey property | `citekey` | Frontmatter key holding the BBT citekey. |
| Zotero PDF folder | *(empty)* | Empty ⇒ references link to note anchors. See the warning above before setting. |
| Reference template (PDF) | see settings | `{{pdf}} {{page}} {{rect}} {{color}} {{note}} {{cite}} {{key}} {{quote}} {{pageLabel}}` |
| Reference template (fallback) | see settings | Used when there's no PDF folder or no geometry. |
| Resolve citekey links | off | Rewrites bare `[[citekey]]` links so they resolve. |

## Notes / limitations

- Obsidian must be running on the enabled device for imports to occur; anything annotated
  while it's closed is caught up on the next launch.
- The plugin only reads Zotero (GET) — it never writes to your library.
- The single coupling to upstream is the public `runImport` method on the Zotero
  Integration plugin.
