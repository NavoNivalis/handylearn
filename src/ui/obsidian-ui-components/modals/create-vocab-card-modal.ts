import "src/ui/obsidian-ui-components/modals/create-vocab-card-modal.css";
import { App, Modal, Notice, Setting } from "obsidian";

import { DictEntry, Ecdict } from "src/data/dictionary/ecdict";
import { GeneratedExample, VocabAi } from "src/data/dictionary/vocab-ai";
import { buildVocabNote } from "src/data/dictionary/vocab-card";
import { createVocabNote } from "src/data/dictionary/vocab-vault";
import { SettingsManager } from "src/data/settings-manager";
import { t } from "src/lang/helpers";

/**
 * Modal for creating a vocabulary card from a single word.
 *
 * Type a word, optionally generate an example sentence with AI, and save the
 * note into the folder configured in the plugin settings.
 */
export class CreateVocabCardModal extends Modal {
    private ecdict: Ecdict;
    private settingsManager: SettingsManager;
    private initialWord: string;

    private wordInput: HTMLInputElement | null = null;
    private previewEl: HTMLElement | null = null;
    private saveButton: HTMLButtonElement | null = null;
    private exampleButton: HTMLButtonElement | null = null;

    private entry: DictEntry | null = null;
    private word = "";
    private example: GeneratedExample | null = null;
    private generating = false;

    constructor(app: App, ecdict: Ecdict, settingsManager: SettingsManager, initialWord = "") {
        super(app);
        this.ecdict = ecdict;
        this.settingsManager = settingsManager;
        this.initialWord = initialWord;
    }

    onOpen(): void {
        this.setTitle(t("CREATE_VOCAB_CARD"));

        new Setting(this.contentEl).setName(t("VOCAB_WORD_LABEL")).addText((text) => {
            text.setPlaceholder("emerge");
            this.wordInput = text.inputEl;
            text.inputEl.addEventListener("input", () => this.refreshPreview());
        });

        this.previewEl = this.contentEl.createEl("pre", { cls: "sr-vocab-preview" });

        new Setting(this.contentEl).addButton((button) => {
            button.setButtonText(t("VOCAB_AI_GENERATE"));
            this.exampleButton = button.buttonEl;
            button.onClick(() => void this.generateExample());
        });

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setButtonText(t("SAVE")).setCta();
                this.saveButton = button.buttonEl;
                button.onClick(() => void this.createCard());
            })
            .addButton((button) => button.setButtonText(t("CANCEL")).onClick(() => this.close()));

        if (this.initialWord && this.wordInput !== null) {
            this.wordInput.value = this.initialWord;
        }
        this.refreshPreview();
        this.wordInput?.focus();
        this.wordInput?.select();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refreshPreview(): void {
        const word = (this.wordInput?.value ?? "").trim();

        // 换了单词，之前生成的例句作废
        if (word.toLowerCase() !== this.word.toLowerCase()) {
            this.example = null;
        }

        this.word = word;
        this.entry = word.length > 0 ? this.ecdict.query(word) : null;
        this.renderPreview();
    }

    private renderPreview(): void {
        if (this.previewEl === null) return;

        if (this.word.length === 0) {
            this.previewEl.setText("");
        } else if (this.entry === null) {
            this.previewEl.setText(t("VOCAB_WORD_NOT_FOUND"));
        } else {
            this.previewEl.setText(buildVocabNote(this.word, this.entry, this.example));
        }

        const ready = this.entry !== null;

        if (this.saveButton !== null) {
            this.saveButton.toggleClass("mod-cta", ready);
            this.saveButton.disabled = !ready;
        }
        if (this.exampleButton !== null) {
            this.exampleButton.disabled = !ready || this.generating;
        }
    }

    private async generateExample(): Promise<void> {
        if (this.entry === null || this.word.length === 0 || this.generating) return;

        if (!VocabAi.isConfigured(this.settingsManager.settings)) {
            new Notice(t("VOCAB_AI_NOT_CONFIGURED"));
            return;
        }

        this.generating = true;
        this.exampleButton?.setText(t("VOCAB_AI_GENERATING"));
        this.renderPreview();

        try {
            this.example = await VocabAi.generateExample(
                this.word,
                this.settingsManager.settings,
            );
        } catch (error) {
            console.error("Failed to generate vocabulary example:", error);
            new Notice(t("VOCAB_AI_FAILED"));
            this.example = null;
        } finally {
            this.generating = false;
            this.exampleButton?.setText(t("VOCAB_AI_GENERATE"));
            this.renderPreview();
        }
    }

    private async createCard(): Promise<void> {
        if (this.entry === null || this.word.length === 0) return;

        const created = await createVocabNote(
            this.app,
            this.settingsManager.settings.vocabOutputFolder,
            this.word,
            this.entry,
            this.example,
        );

        new Notice(t(created ? "VOCAB_NOTE_CREATED" : "VOCAB_NOTE_EXISTS"));
        if (created) this.close();
    }
}
