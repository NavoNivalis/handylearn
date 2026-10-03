import "src/ui/obsidian-ui-components/modals/extract-words-modal.css";
import { App, Modal, Notice, Setting, TFile } from "obsidian";

import { Ecdict } from "src/data/dictionary/ecdict";
import {
    EXAM_TAG_ORDER,
    existingVocabWords,
    ExtractedWord,
    ExtractGroupId,
    ExtractMode,
    extractWords,
    groupOrder,
} from "src/data/dictionary/vocab-extract";
import { createVocabNote } from "src/data/dictionary/vocab-vault";
import { SettingsManager } from "src/data/settings-manager";
import { t } from "src/lang/helpers";
import { vocabGroupLabel } from "src/ui/vocab-groups";

/**
 * Shows the words worth learning in the current note, grouped by exam level
 * (or by frequency). The user picks what to keep and they become cards at once.
 */
export class ExtractWordsModal extends Modal {
    private ecdict: Ecdict;
    private settingsManager: SettingsManager;
    private text: string;
    /** 这些词出自哪篇笔记（写成 [[链接]] 存进卡片） */
    private source: string | null;

    private mode: ExtractMode = "exam";
    private words: ExtractedWord[] = [];
    private selected = new Set<string>();
    private knownWords = new Set<string>();
    private initialized = false;
    private running = false;

    private topEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private actionEl: HTMLButtonElement | null = null;

    constructor(
        app: App,
        ecdict: Ecdict,
        settingsManager: SettingsManager,
        text: string,
        sourceFile: TFile | null = null,
    ) {
        super(app);
        this.ecdict = ecdict;
        this.settingsManager = settingsManager;
        this.text = text;
        this.source = sourceFile === null ? null : `[[${sourceFile.basename}]]`;
    }

    onOpen(): void {
        this.setTitle(t("EXTRACT_TITLE"));

        const settings = this.settingsManager.settings;
        this.knownWords = existingVocabWords(this.app, settings.vocabOutputFolder);

        this.topEl = this.contentEl.createDiv("sr-extract-topbar");
        this.listEl = this.contentEl.createDiv("sr-extract-list");

        this.refresh();

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setCta();
                this.actionEl = button.buttonEl;
                button.onClick(() => void this.run());
            })
            .addButton((button) => button.setButtonText(t("CANCEL")).onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** 重新抽词并重画（切换分组方式时调用；已勾选的词保持不变） */
    private refresh(): void {
        const ignore = new Set(
            this.settingsManager.settings.vocabIgnoreWords.map((item) => item.toLowerCase()),
        );
        this.words = extractWords(this.text, this.ecdict, this.knownWords, ignore, this.mode);

        // 第一次打开时，考试词默认勾上
        if (!this.initialized) {
            this.initialized = true;
            for (const item of this.words) {
                if (EXAM_TAG_ORDER.includes(item.group)) this.selected.add(item.word);
            }
        }

        this.renderTopBar();
        this.renderList();
    }

    private renderTopBar(): void {
        if (this.topEl === null) return;
        this.topEl.empty();

        if (this.words.length === 0) return;

        const modeSelect = this.topEl.createEl("select");
        modeSelect.createEl("option", { value: "exam", text: t("EXTRACT_MODE_EXAM") });
        modeSelect.createEl("option", { value: "frequency", text: t("EXTRACT_MODE_FREQUENCY") });
        modeSelect.value = this.mode;
        modeSelect.addEventListener("change", () => {
            this.mode = modeSelect.value as ExtractMode;
            this.refresh();
        });

        const selectAll = this.topEl.createEl("button", { text: t("EXTRACT_SELECT_ALL") });
        selectAll.addEventListener("click", () => {
            for (const item of this.words) this.selected.add(item.word);
            this.renderList();
        });

        const clearAll = this.topEl.createEl("button", { text: t("EXTRACT_CLEAR_ALL") });
        clearAll.addEventListener("click", () => {
            this.selected.clear();
            this.renderList();
        });
    }

    private renderList(): void {
        if (this.listEl === null) return;
        this.listEl.empty();

        if (this.words.length === 0) {
            this.listEl.createDiv({ cls: "sr-extract-empty", text: t("EXTRACT_NONE") });
            this.refreshAction();
            return;
        }

        for (const group of groupOrder(this.mode)) {
            const items = this.words.filter((item) => item.group === group);
            if (items.length === 0) continue;

            const section = this.listEl.createDiv("sr-extract-group");
            const header = section.createDiv("sr-extract-header");

            const allSelected = items.every((item) => this.selected.has(item.word));
            const groupBox = header.createEl("input", { type: "checkbox" });
            groupBox.checked = allSelected;
            groupBox.addEventListener("change", () => {
                for (const item of items) {
                    if (allSelected) this.selected.delete(item.word);
                    else this.selected.add(item.word);
                }
                this.renderList();
            });

            header.createSpan({ cls: "sr-extract-title", text: vocabGroupLabel(group) });
            header.createSpan({ cls: "sr-extract-count", text: String(items.length) });

            for (const item of items) {
                const row = section.createDiv("sr-extract-row");

                const box = row.createEl("input", { type: "checkbox" });
                box.checked = this.selected.has(item.word);
                box.addEventListener("change", () => {
                    if (this.selected.has(item.word)) this.selected.delete(item.word);
                    else this.selected.add(item.word);
                    this.refreshAction();
                });

                row.createSpan({ cls: "sr-extract-word", text: item.word });
                row.createSpan({
                    cls: "sr-extract-gloss",
                    text: (item.entry.t ?? "").split("\n")[0].trim(),
                });
                row.createSpan({ cls: "sr-extract-times", text: `×${item.count}` });
            }
        }

        this.refreshAction();
    }

    private refreshAction(): void {
        if (this.actionEl === null) return;
        this.actionEl.setText(t("EXTRACT_CREATE", { count: this.selected.size }));
        this.actionEl.disabled = this.selected.size === 0;
    }

    private async run(): Promise<void> {
        if (this.running || this.selected.size === 0) return;

        this.running = true;
        const folder = this.settingsManager.settings.vocabOutputFolder;
        const targets = this.words.filter((item) => this.selected.has(item.word));

        for (let i = 0; i < targets.length; i++) {
            this.actionEl?.setText(
                t("VOCAB_BATCH_PROGRESS", { done: i + 1, total: targets.length }),
            );
            await createVocabNote(
                this.app,
                folder,
                targets[i].word,
                targets[i].entry,
                null,
                this.source,
            );
        }

        new Notice(t("EXTRACT_DONE", { count: targets.length }));
        this.close();
    }
}
