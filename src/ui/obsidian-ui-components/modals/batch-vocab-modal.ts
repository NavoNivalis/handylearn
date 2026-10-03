import { App, Modal, Notice, Setting } from "obsidian";

import { Ecdict } from "src/data/dictionary/ecdict";
import { VocabAi } from "src/data/dictionary/vocab-ai";
import { EXAM_TAGS } from "src/data/dictionary/vocab-card";
import { createVocabNote } from "src/data/dictionary/vocab-vault";
import { SettingsManager } from "src/data/settings-manager";
import { t } from "src/lang/helpers";

const DEFAULT_COUNT = 100;

/**
 * Batch-creates vocabulary notes for an exam word list (CET-4, 考研, TOEFL ...).
 *
 * Words are ordered by corpus frequency, and notes that already exist are skipped.
 */
export class BatchVocabModal extends Modal {
    private ecdict: Ecdict;
    private settingsManager: SettingsManager;

    private tag = EXAM_TAGS[0].value;
    private count = DEFAULT_COUNT;
    private withExample = false;
    private running = false;

    private infoEl: HTMLElement | null = null;
    private startButton: HTMLButtonElement | null = null;

    constructor(app: App, ecdict: Ecdict, settingsManager: SettingsManager) {
        super(app);
        this.ecdict = ecdict;
        this.settingsManager = settingsManager;
    }

    onOpen(): void {
        this.setTitle(t("VOCAB_BATCH_TITLE"));

        new Setting(this.contentEl).setName(t("VOCAB_BATCH_LIST")).addDropdown((dropdown) => {
            for (const item of EXAM_TAGS) dropdown.addOption(item.value, item.label);
            dropdown.setValue(this.tag);
            dropdown.onChange((value) => {
                this.tag = value;
                this.refreshInfo();
            });
        });

        new Setting(this.contentEl).setName(t("VOCAB_BATCH_COUNT")).addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(DEFAULT_COUNT));
            text.onChange((value) => {
                this.count = Math.max(1, Number.parseInt(value, 10) || DEFAULT_COUNT);
            });
        });

        new Setting(this.contentEl)
            .setName(t("VOCAB_BATCH_WITH_EXAMPLE"))
            .addToggle((toggle) => {
                toggle.onChange((value) => {
                    this.withExample = value;
                });
            });

        this.infoEl = this.contentEl.createDiv("sr-vocab-progress");
        this.refreshInfo();

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setButtonText(t("VOCAB_BATCH_START")).setCta();
                this.startButton = button.buttonEl;
                button.onClick(() => void this.run());
            })
            .addButton((button) => button.setButtonText(t("CANCEL")).onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refreshInfo(): void {
        if (this.running || this.infoEl === null) return;
        const total = this.ecdict.listByTag(this.tag).length;
        this.infoEl.setText(t("VOCAB_BATCH_TOTAL", { total }));
    }

    private async run(): Promise<void> {
        if (this.running) return;

        this.running = true;
        if (this.startButton !== null) this.startButton.disabled = true;

        const settings = this.settingsManager.settings;
        const folder = settings.vocabOutputFolder;
        const words = this.ecdict.listByTag(this.tag).slice(0, this.count);
        const useAi = this.withExample && VocabAi.isConfigured(settings);

        let created = 0;
        let skipped = 0;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            this.infoEl?.setText(
                t("VOCAB_BATCH_PROGRESS", { done: i + 1, total: words.length }),
            );

            const entry = this.ecdict.query(word);
            if (entry === null) {
                skipped++;
                continue;
            }

            let example = null;
            if (useAi) {
                try {
                    example = await VocabAi.generateExample(word, settings);
                } catch (error) {
                    console.error("Batch example generation failed:", word, error);
                }
            }

            const ok = await createVocabNote(this.app, folder, word, entry, example);
            if (ok) created++;
            else skipped++;
        }

        this.running = false;
        if (this.startButton !== null) this.startButton.disabled = false;

        const message = t("VOCAB_BATCH_DONE", { created, skipped });
        this.infoEl?.setText(message);
        new Notice(message);
    }
}
