import { App, Modal, Notice, Setting, TFile } from "obsidian";

import {
    EXAM_TAG_ORDER,
    existingVocabWords,
    ExtractedWord,
    ExtractGroupId,
    ExtractMode,
    extractWords,
    groupOrder,
} from "src/dictionary/vocab-extract";
import { createVocabNote } from "src/dictionary/vocab-vault";
import type HandyLearnPlugin from "src/main";

function groupLabel(group: ExtractGroupId): string {
    switch (group) {
        case "zk":
            return "中考";
        case "gk":
            return "高考";
        case "cet4":
            return "四级";
        case "cet6":
            return "六级";
        case "ky":
            return "考研";
        case "toefl":
            return "托福";
        case "ielts":
            return "雅思";
        case "gre":
            return "GRE";
        case "high":
            return "高频";
        case "mid":
            return "中频";
        default:
            return "专业";
    }
}

/**
 * 从当前笔记正文里抽出值得学的生词，按考试/词频分组展示，勾选后一键建卡。
 */
export class ExtractWordsModal extends Modal {
    private plugin: HandyLearnPlugin;
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

    constructor(app: App, plugin: HandyLearnPlugin, text: string, sourceFile: TFile | null = null) {
        super(app);
        this.plugin = plugin;
        this.text = text;
        this.source = sourceFile === null ? null : `[[${sourceFile.basename}]]`;
    }

    onOpen(): void {
        this.setTitle("提取生词");

        this.knownWords = existingVocabWords(this.app, this.plugin.settings.vocabOutputFolder);

        this.topEl = this.contentEl.createDiv("hl-extract-topbar");
        this.listEl = this.contentEl.createDiv("hl-extract-list");

        this.refresh();

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setCta();
                this.actionEl = button.buttonEl;
                button.onClick(() => void this.run());
            })
            .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refresh(): void {
        this.words = extractWords(
            this.text,
            this.plugin.dictionary,
            this.knownWords,
            new Set<string>(),
            this.mode,
        );

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
        modeSelect.createEl("option", { value: "exam", text: "按考试" });
        modeSelect.createEl("option", { value: "frequency", text: "按词频" });
        modeSelect.value = this.mode;
        modeSelect.addEventListener("change", () => {
            this.mode = modeSelect.value as ExtractMode;
            this.refresh();
        });

        const selectAll = this.topEl.createEl("button", { text: "全选" });
        selectAll.addEventListener("click", () => {
            for (const item of this.words) this.selected.add(item.word);
            this.renderList();
        });

        const clearAll = this.topEl.createEl("button", { text: "清空" });
        clearAll.addEventListener("click", () => {
            this.selected.clear();
            this.renderList();
        });
    }

    private renderList(): void {
        if (this.listEl === null) return;
        this.listEl.empty();

        if (this.words.length === 0) {
            this.listEl.createDiv({ cls: "hl-extract-empty", text: "没有值得学的生词" });
            this.refreshAction();
            return;
        }

        for (const group of groupOrder(this.mode)) {
            const items = this.words.filter((item) => item.group === group);
            if (items.length === 0) continue;

            const section = this.listEl.createDiv("hl-extract-group");
            const header = section.createDiv("hl-extract-header");

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

            header.createSpan({ cls: "hl-extract-title", text: groupLabel(group) });
            header.createSpan({ cls: "hl-extract-count", text: String(items.length) });

            for (const item of items) {
                const row = section.createDiv("hl-extract-row");

                const box = row.createEl("input", { type: "checkbox" });
                box.checked = this.selected.has(item.word);
                box.addEventListener("change", () => {
                    if (this.selected.has(item.word)) this.selected.delete(item.word);
                    else this.selected.add(item.word);
                    this.refreshAction();
                });

                row.createSpan({ cls: "hl-extract-word", text: item.word });
                row.createSpan({
                    cls: "hl-extract-gloss",
                    text: (item.entry.t ?? "").split("\n")[0].trim(),
                });
                row.createSpan({ cls: "hl-extract-times", text: `×${item.count}` });
            }
        }

        this.refreshAction();
    }

    private refreshAction(): void {
        if (this.actionEl === null) return;
        this.actionEl.setText(`创建 ${this.selected.size} 张词卡`);
        this.actionEl.disabled = this.selected.size === 0;
    }

    private async run(): Promise<void> {
        if (this.running || this.selected.size === 0) return;

        this.running = true;
        const folder = this.plugin.settings.vocabOutputFolder;
        const targets = this.words.filter((item) => this.selected.has(item.word));

        for (let i = 0; i < targets.length; i++) {
            this.actionEl?.setText(`创建中 ${i + 1}/${targets.length}`);
            await createVocabNote(
                this.app,
                folder,
                targets[i].word,
                targets[i].entry,
                null,
                this.source,
            );
        }

        await this.plugin.refreshSidebar();
        new Notice(`已创建 ${targets.length} 张词卡`);
        this.close();
    }
}
