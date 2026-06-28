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

## Notes / limitations

- Obsidian must be running on the enabled device for imports to occur; anything annotated
  while it's closed is caught up on the next launch.
- The plugin only reads Zotero (GET) — it never writes to your library.
- The single coupling to upstream is the public `runImport` method on the Zotero
  Integration plugin.
