import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';

import type ZoteroMirrorPlugin from './main';

export class ZoteroMirrorSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: ZoteroMirrorPlugin,
  ) {
    super(app, plugin);
  }

  private parseList(value: string): string[] {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    // --- activation -------------------------------------------------------
    new Setting(containerEl).setName('Activation').setHeading();

    new Setting(containerEl)
      .setName('Enable on this device')
      .setDesc(
        'Only ONE device should have this on. If multiple LiveSync devices poll and import the same paper, they will write conflicting copies of the note.',
      )
      .addToggle((t) =>
        t.setValue(s.enabledOnThisDevice).onChange(async (v) => {
          s.enabledOnThisDevice = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Import format')
      .setDesc('Name of the Zotero Integration export format to drive (must exist there).')
      .addText((t) =>
        t
          .setPlaceholder('Smart Import')
          .setValue(s.exportFormatName)
          .onChange(async (v) => {
            s.exportFormatName = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    // --- timing -----------------------------------------------------------
    new Setting(containerEl).setName('Timing').setHeading();

    new Setting(containerEl)
      .setName('Poll interval (seconds)')
      .setDesc('How often to check Zotero for changes.')
      .addText((t) =>
        t.setValue(String(s.pollIntervalSeconds)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 5) {
            s.pollIntervalSeconds = n;
            await this.plugin.saveSettings();
            this.plugin.restartPolling();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Quiet cooldown (seconds)')
      .setDesc(
        'A paper is imported only after it has had no further changes for this long — batches a burst of highlights into one note write (LiveSync-friendly).',
      )
      .addText((t) =>
        t.setValue(String(s.quietCooldownSeconds)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 0) {
            s.quietCooldownSeconds = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    // --- scope ------------------------------------------------------------
    new Setting(containerEl).setName('Scope').setHeading();

    new Setting(containerEl)
      .setName('Item types for annotation imports')
      .setDesc(
        'Comma-separated Zotero item types that get a NEW note when annotated (journal articles only by default, to avoid book-highlight noise). Tag-flagged items and updates to existing notes work for ANY type.',
      )
      .addText((t) =>
        t.setValue(s.allowedItemTypes.join(', ')).onChange(async (v) => {
          s.allowedItemTypes = this.parseList(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Stub trigger tags')
      .setDesc(
        'Comma-separated Zotero tags that flag ANY item (book, paper, etc.) for import (status / priority emojis). Reuses your existing triage tags — works from Zotero mobile via sync.',
      )
      .addText((t) =>
        t.setValue(s.stubTriggerTags.join(', ')).onChange(async (v) => {
          s.stubTriggerTags = this.parseList(v);
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Source folder')
      .setDesc('Vault folder whose notes’ citekeys mark a paper as "tracked".')
      .addText((t) =>
        t.setValue(s.sourceFolder).onChange(async (v) => {
          s.sourceFolder = v.trim();
          await this.plugin.saveSettings();
          this.plugin.tracked.rebuild();
        }),
      );

    new Setting(containerEl)
      .setName('Citekey property')
      .setDesc('Frontmatter property holding the Better BibTeX citekey.')
      .addText((t) =>
        t.setValue(s.citekeyProperty).onChange(async (v) => {
          s.citekeyProperty = v.trim() || 'citekey';
          await this.plugin.saveSettings();
          this.plugin.tracked.rebuild();
        }),
      );

    // --- highlight references ---------------------------------------------
    new Setting(containerEl).setName('Highlight references').setHeading();

    new Setting(containerEl)
      .setName('PDF preview on hover')
      .setDesc(
        'Hovering a zotero:// link renders that PDF page with its highlights drawn on it. Read straight from Zotero’s folder — no PDFs are copied into the vault. Desktop only.',
      )
      .addToggle((t) =>
        t.setValue(s.hoverPreviews).onChange(async (v) => {
          s.hoverPreviews = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Zotero data directory')
      .setDesc('Attachments are read from <dir>/storage/<key>/. Usually ~/Zotero.')
      .addText((t) =>
        t.setValue(s.zoteroDataDir).onChange(async (v) => {
          s.zoteroDataDir = v.trim().replace(/\/+$/, '');
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Require ctrl/cmd for preview')
      .setDesc('Only show the PDF preview while a modifier is held.')
      .addToggle((t) =>
        t.setValue(s.hoverRequiresModKey).onChange(async (v) => {
          s.hoverRequiresModKey = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Preview size')
      .setDesc(
        'Width and height of the preview in pixels. The zoom is fitted to these, so a larger preview shows more of the page rather than a bigger crop of it.',
      )
      .addText((t) =>
        t.setPlaceholder('width').setValue(String(s.hoverPopoverWidth)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 200) {
            s.hoverPopoverWidth = n;
            await this.plugin.saveSettings();
          }
        }),
      )
      .addText((t) =>
        t.setPlaceholder('height').setValue(String(s.hoverPopoverHeight)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n >= 100) {
            s.hoverPopoverHeight = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Highlight fill')
      .setDesc(
        'How much of the preview the highlight should take up, 0–1. Raise it to zoom in tighter, lower it to see more of the page around it. Surrounding context is not lost either way: the whole page is rendered and the preview scrolls.',
      )
      .addText((t) =>
        t.setValue(String(s.hoverFill)).onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n > 0 && n <= 1) {
            s.hoverFill = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Dim preview (dark theme)')
      .setDesc(
        'Soften a bright white PDF page over a dark note. 0 is off; higher lowers brightness and saturation together. Applied only under a dark theme.',
      )
      .addSlider((sl) =>
        sl
          .setLimits(0, 1, 0.05)
          .setValue(s.hoverDimDark)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.hoverDimDark = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Dim preview (light theme)')
      .setDesc('Same, but under a light theme — usually 0, since a white page needs no softening there.')
      .addSlider((sl) =>
        sl
          .setLimits(0, 1, 0.05)
          .setValue(s.hoverDimLight)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.hoverDimLight = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Log preview zoom decisions')
      .setDesc(
        'Print how each preview chose its zoom to the developer console (ctrl+shift+i). For working out why a size setting is not having the effect you expect.',
      )
      .addToggle((t) =>
        t.setValue(s.hoverDebug).onChange(async (v) => {
          s.hoverDebug = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Zoom limits')
      .setDesc(
        'Minimum and maximum zoom. Each highlight is zoomed to fit the preview: the minimum stops a page-long highlight shrinking past readability (scroll instead), the maximum stops a three-word one being magnified to fill the box.',
      )
      .addText((t) =>
        t.setPlaceholder('min').setValue(String(s.hoverMinScale)).onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n > 0 && n <= 5) {
            s.hoverMinScale = n;
            await this.plugin.saveSettings();
          }
        }),
      )
      .addText((t) =>
        t.setPlaceholder('max').setValue(String(s.hoverMaxScale)).onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n > 0 && n <= 8) {
            s.hoverMaxScale = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName('Reference template')
      .setDesc(
        'Used when Zotero knows where the highlight is. Placeholders: {{attachment}} {{page}} {{note}} {{cite}} {{key}} {{quote}} {{pageLabel}}',
      )
      .addTextArea((t) =>
        t.setValue(s.highlightInsertTemplate).onChange(async (v) => {
          s.highlightInsertTemplate = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Reference template (fallback)')
      .setDesc(
        'Used when Zotero has never been reached, so no attachment is known. Links to the note’s block anchor instead — no PDF preview, but it works on mobile.',
      )
      .addTextArea((t) =>
        t.setValue(s.highlightFallbackTemplate).onChange(async (v) => {
          s.highlightFallbackTemplate = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Embed template')
      .setDesc(
        'Inserted by the "Insert highlight embed" command — the source highlight rendered inline, kept in sync with the note and still a backlink to the paper. Placeholders: {{note}} {{key}} {{cite}} {{quote}} {{pageLabel}}',
      )
      .addTextArea((t) =>
        t.setValue(s.highlightEmbedTemplate).onChange(async (v) => {
          s.highlightEmbedTemplate = v;
          await this.plugin.saveSettings();
        }),
      );

    // --- citekey links ----------------------------------------------------
    new Setting(containerEl).setName('Citekey links').setHeading();

    new Setting(containerEl)
      .setName('Resolve citekey links')
      .setDesc(
        'Rewrite bare [[citekey]] links in source notes so they resolve, keeping the citekey as the displayed text. Obsidian matches links by filename only and ignores aliases, so a citekey pasted into a Zotero comment otherwise imports as a broken link.',
      )
      .addToggle((t) =>
        t.setValue(s.resolveCitekeyLinks).onChange(async (v) => {
          s.resolveCitekeyLinks = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Resolve existing notes')
      .setDesc(
        'Apply the rewrite to every source note once. Not normally needed — with the toggle on, notes are rewritten as they change. Useful after turning it on, since the links live in Zotero comments and come back bare on every re-import.',
      )
      .addButton((b) =>
        b.setButtonText('Resolve now').onClick(async () => {
          if (!s.resolveCitekeyLinks) {
            new Notice('Turn on "Resolve citekey links" first.');
            return;
          }
          const changed = await this.plugin.linkResolver.sweep();
          new Notice(`Zotero Mirror: rewrote links in ${changed} note(s).`);
        }),
      );

    // --- connection -------------------------------------------------------
    new Setting(containerEl).setName('Zotero connection').setHeading();

    new Setting(containerEl).setName('Host').addText((t) =>
      t.setValue(s.zoteroHost).onChange(async (v) => {
        s.zoteroHost = v.trim() || '127.0.0.1';
        await this.plugin.saveSettings();
        this.plugin.applyConnectionSettings();
      }),
    );

    new Setting(containerEl).setName('Port').addText((t) =>
      t.setValue(String(s.zoteroPort)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n)) {
          s.zoteroPort = n;
          await this.plugin.saveSettings();
          this.plugin.applyConnectionSettings();
        }
      }),
    );

    new Setting(containerEl)
      .setName('Library id')
      .setDesc('BBT library id passed to runImport (1 = personal "My Library").')
      .addText((t) =>
        t.setValue(String(s.libraryId)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n)) {
            s.libraryId = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    // --- actions ----------------------------------------------------------
    new Setting(containerEl).setName('Actions').setHeading();

    new Setting(containerEl)
      .setName('Sync now')
      .setDesc('Run one poll + import cycle immediately.')
      .addButton((b) =>
        b.setButtonText('Sync now').onClick(async () => {
          if (!s.enabledOnThisDevice) {
            new Notice('Enable on this device first.');
            return;
          }
          new Notice('Zotero Mirror: syncing…');
          await this.plugin.forceSync();
          new Notice(`Zotero Mirror: ${this.plugin.lastStatus}`);
        }),
      );

    new Setting(containerEl)
      .setName('Backfill reading pile')
      .setDesc(
        'One-time: import tagged journal articles that have no note yet (throttled).',
      )
      .addButton((b) =>
        b.setButtonText('Backfill…').onClick(async () => {
          new Notice('Zotero Mirror: collecting candidates…');
          let list;
          try {
            list = await this.plugin.collectBackfill();
          } catch (e) {
            new Notice('Zotero Mirror: failed to query Zotero (see console).');
            console.error(e);
            return;
          }
          if (list.length === 0) {
            new Notice('Zotero Mirror: nothing to backfill.');
            return;
          }
          new ConfirmModal(
            this.app,
            `Import ${list.length} tagged paper(s) with no note yet?`,
            'They will be imported one at a time (~2.5/sec) on this device.',
            async () => {
              const notice = new Notice(`Backfill: 0/${list.length}`, 0);
              const done = await this.plugin.runBackfill(list, (d, total) => {
                notice.setMessage(`Backfill: ${d}/${total}`);
              });
              notice.hide();
              new Notice(`Zotero Mirror: backfilled ${done}/${list.length}.`);
            },
          ).open();
        }),
      );

    new Setting(containerEl)
      .setName('Re-import all tracked notes')
      .setDesc(
        'Re-render every note that already exists, to pick up template changes such as the highlight block anchors. Overwrites everything outside {% persist %} blocks and writes every note — LiveSync will replicate all of them.',
      )
      .addButton((b) =>
        b.setButtonText('Re-import all…').onClick(async () => {
          if (!s.enabledOnThisDevice) {
            new Notice('Enable on this device first.');
            return;
          }
          const list = this.plugin.collectTracked();
          if (list.length === 0) {
            new Notice('Zotero Mirror: no tracked notes.');
            return;
          }
          new ConfirmModal(
            this.app,
            `Re-import all ${list.length} tracked note(s)?`,
            'Each is re-rendered from Zotero (~2.5/sec). Content outside persist blocks is overwritten.',
            async () => {
              const notice = new Notice(`Re-import: 0/${list.length}`, 0);
              const done = await this.plugin.runBackfill(list, (d, total) => {
                notice.setMessage(`Re-import: ${d}/${total}`);
              });
              notice.hide();
              new Notice(`Zotero Mirror: re-imported ${done}/${list.length}.`);
            },
          ).open();
        }),
      );

    new Setting(containerEl)
      .setName('Reset baseline')
      .setDesc(
        'Forget the backlog: set the tracking point to Zotero’s current version. Future changes only.',
      )
      .addButton((b) =>
        b.setWarning().setButtonText('Reset baseline').onClick(async () => {
          await this.plugin.resetBaseline();
        }),
      );

    // --- status -----------------------------------------------------------
    new Setting(containerEl).setName('Status').setHeading();
    containerEl.createEl('p', {
      text: `Tracked notes: ${this.plugin.tracked.size()} · Library version: ${s.lastLibraryVersion} · Last: ${this.plugin.lastStatus}`,
      cls: 'setting-item-description',
    });
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private body: string,
    private onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    contentEl.createEl('p', { text: this.body });
    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Import')
          .setCta()
          .onClick(async () => {
            this.close();
            await this.onConfirm();
          }),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
