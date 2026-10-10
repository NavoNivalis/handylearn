import { App, Modal, Notice, Setting } from "obsidian";

import { DictEntry } from "src/dictionary/ecdict";
import { GeneratedExample, VocabAi } from "src/dictionary/vocab-ai";
import { buildVocabNote } from "src/dictionary/vocab-card";
import { createVocabNote } from "src/dictionary/vocab-vault";
import type HandyLearnPlugin from "src/main";

/**
 * 单个单词建卡：输入单词 → 预览 → 可选 AI 例句 → 保存。
 */
export class CreateVocabCardModal extends Modal {
    private plugin: HandyLearnPlugin;
    private initialWord: string;

    private wordInput: HTMLInputElement | null = null;
    private previewEl: HTMLElement | null = null;
    private saveButton: HTMLButtonElement | null = null;
    private exampleButton: HTMLButtonElement | null = null;

    private entry: DictEntry | null = null;
    private word = "";
    private example: GeneratedExample | null = null;
    private generating = false;

    constructor(app: App, plugin: HandyLearnPlugin, initialWord = "") {
        super(app);
        this.plugin = plugin;
        this.initialWord = initialWord;
    }

    onOpen(): void {
        this.setTitle("新建词卡");

        new Setting(this.contentEl).setName("单词").addText((text) => {
            text.setPlaceholder("emerge");
            this.wordInput = text.inputEl;
            text.inputEl.addEventListener("input", () => this.refreshPreview());
        });

        this.previewEl = this.contentEl.createEl("pre", { cls: "hl-vocab-preview" });

        new Setting(this.contentEl).addButton((button) => {
            button.setButtonText("AI 生成例句");
            this.exampleButton = button.buttonEl;
            button.onClick(() => void this.generateExample());
        });

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setButtonText("保存").setCta();
                this.saveButton = button.buttonEl;
                button.onClick(() => void this.createCard());
            })
            .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));

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
        this.entry = word.length > 0 ? this.plugin.dictionary.query(word) : null;
        this.renderPreview();
    }

    private renderPreview(): void {
        if (this.previewEl === null) return;

        if (this.word.length === 0) {
            this.previewEl.setText("");
        } else if (this.entry === null) {
            this.previewEl.setText("词典里没有这个词");
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

        if (!VocabAi.isConfigured(this.plugin.settings)) {
            new Notice("未配置 AI API Key，请到设置里填写");
            return;
        }

        this.generating = true;
        this.exampleButton?.setText("生成中…");
        this.renderPreview();

        try {
            this.example = await VocabAi.generateExample(this.word, this.plugin.settings);
        } catch (error) {
            console.error("Failed to generate vocabulary example:", error);
            new Notice("AI 例句生成失败");
            this.example = null;
        } finally {
            this.generating = false;
            this.exampleButton?.setText("AI 生成例句");
            this.renderPreview();
        }
    }

    private async createCard(): Promise<void> {
        if (this.entry === null || this.word.length === 0) return;

        const created = await createVocabNote(
            this.app,
            this.plugin.settings.vocabOutputFolder,
            this.word,
            this.entry,
            this.example,
        );

        new Notice(created ? "词卡已创建" : "词卡已存在");
        if (created) {
            await this.plugin.refreshSidebar();
            this.close();
        }
    }
}
