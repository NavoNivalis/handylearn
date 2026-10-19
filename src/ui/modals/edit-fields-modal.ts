import { App, Modal, Notice, Setting, TFile } from "obsidian";

import {
    CardField,
    FieldSide,
    FIELD_EXAMPLE,
    FIELD_TRANSLATION,
    LOCKED_FIELD_LABELS,
} from "src/engine/card";
import { updateNoteFields } from "src/dictionary/vocab-vault";
import { VocabAi } from "src/dictionary/vocab-ai";
import { normalizeFieldTemplates } from "src/settings";
import type HandyLearnPlugin from "src/main";

/**
 * 编辑单张词卡的字段：改名、改内容、切换正反面、增删、排序。
 * 锁定字段（释义 / 音标）只能改内容。
 */
export class EditFieldsModal extends Modal {
    private fields: CardField[];
    private listEl: HTMLElement | null = null;
    private generating = false;

    constructor(
        app: App,
        private plugin: HandyLearnPlugin,
        private file: TFile,
        private word: string,
        fields: CardField[],
    ) {
        super(app);
        this.fields = fields.map((field) => ({ ...field }));
    }

    onOpen(): void {
        this.setTitle(`编辑字段：${this.word}`);

        this.listEl = this.contentEl.createDiv({ cls: "hl-field-list" });
        this.renderList();

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setButtonText("添加字段").onClick(() => {
                    this.fields.push({ label: "新字段", value: "", side: "back" });
                    this.renderList();
                });
            })
            .addButton((button) => {
                button.setButtonText("AI 生成例句").onClick(() => void this.generateExample());
            })
            .addButton((button) => {
                button.setButtonText("设为默认模板").onClick(() => void this.saveAsTemplate());
            })
            .addButton((button) => {
                button.setButtonText("保存").setCta().onClick(() => void this.save());
            })
            .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderList(): void {
        if (this.listEl === null) return;
        this.listEl.empty();

        this.fields.forEach((field, index) => {
            // 无名字段是正面的单词行，固定不可编辑
            const isWord = field.label === "";
            const locked = isWord || LOCKED_FIELD_LABELS.includes(field.label);

            const row = this.listEl!.createDiv({ cls: "hl-field-row" });

            if (isWord) {
                row.createSpan({ cls: "hl-field-label", text: "单词" });
            } else if (locked) {
                row.createSpan({ cls: "hl-field-label", text: field.label });
            } else {
                const input = row.createEl("input", { cls: "hl-field-label", type: "text" });
                input.value = field.label;
                input.addEventListener("input", () => {
                    field.label = input.value;
                });
            }

            const value = row.createEl("textarea", { cls: "hl-field-value" });
            value.rows = 2;
            value.value = field.value;
            value.disabled = isWord;
            value.addEventListener("input", () => {
                field.value = value.value;
            });

            const side = row.createEl("select", { cls: "hl-field-side" });
            side.createEl("option", { value: "front", text: "正面" });
            side.createEl("option", { value: "back", text: "背面" });
            side.value = field.side;
            side.disabled = locked;
            side.addEventListener("change", () => {
                field.side = side.value as FieldSide;
            });

            const actions = row.createDiv({ cls: "hl-field-actions" });
            if (isWord) return;

            const up = actions.createEl("button", { text: "↑" });
            up.disabled = index === 0 || this.fields[index - 1].label === "";
            up.addEventListener("click", () => this.move(index, -1));

            const down = actions.createEl("button", { text: "↓" });
            down.disabled = index === this.fields.length - 1;
            down.addEventListener("click", () => this.move(index, 1));

            if (!locked) {
                const remove = actions.createEl("button", { text: "✕" });
                remove.addEventListener("click", () => {
                    this.fields.splice(index, 1);
                    this.renderList();
                });
            }
        });
    }

    private move(index: number, offset: number): void {
        const target = index + offset;
        if (target < 0 || target >= this.fields.length) return;
        // 不允许把字段移到正面单词行之前
        if (this.fields[target].label === "") return;
        [this.fields[index], this.fields[target]] = [this.fields[target], this.fields[index]];
        this.renderList();
    }

    /** 把 AI 例句写进「例句」「翻译」字段；没有这两个字段就补上。 */
    private async generateExample(): Promise<void> {
        if (this.generating) return;
        if (!VocabAi.isConfigured(this.plugin.settings)) {
            new Notice("未配置 AI API Key，请到设置里填写");
            return;
        }

        this.generating = true;
        try {
            const example = await VocabAi.generateExample(this.word, this.plugin.settings);
            this.setFieldValue(FIELD_EXAMPLE, example.sentence);
            this.setFieldValue(FIELD_TRANSLATION, example.translation);
            this.renderList();
        } catch (error) {
            console.error("Failed to generate vocabulary example:", error);
            new Notice("AI 例句生成失败");
        } finally {
            this.generating = false;
        }
    }

    private setFieldValue(label: string, value: string): void {
        const existing = this.fields.find((field) => field.label === label);
        if (existing !== undefined) {
            existing.value = value;
            return;
        }
        this.fields.push({ label, value, side: "back" });
    }

    /** 把当前卡片的字段结构（不含内容）保存成全局默认模板。 */
    private async saveAsTemplate(): Promise<void> {
        const templates = this.fields
            .filter((field) => field.label.trim() !== "")
            .map((field) => ({ label: field.label.trim(), side: field.side }));

        this.plugin.settings.fieldTemplates = normalizeFieldTemplates(templates);
        await this.plugin.saveSettings();
        new Notice("已设为默认字段模板");
    }

    private async save(): Promise<void> {
        const cleaned: CardField[] = [];
        for (const field of this.fields) {
            const label = field.label.trim();
            // 无名字段只保留正面单词行
            if (label === "" && !(field.side === "front" && field.value.trim().length > 0)) continue;
            if (label !== "" && cleaned.some((item) => item.label === label)) continue;
            cleaned.push({ label, value: field.value, side: field.side });
        }

        await updateNoteFields(this.app, this.file, cleaned);
        await this.plugin.refreshSidebar();
        new Notice("字段已保存");
        this.close();
    }
}
