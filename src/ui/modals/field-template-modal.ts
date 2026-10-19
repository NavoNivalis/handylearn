import { App, Modal, Setting } from "obsidian";

import { renderTemplateEditor } from "src/ui/field-template-editor";
import type HandyLearnPlugin from "src/main";

/** 主页的「字段模板」弹窗：管理新建词卡时默认带上的字段。 */
export class FieldTemplateModal extends Modal {
    private listEl: HTMLElement | null = null;

    constructor(app: App, private plugin: HandyLearnPlugin) {
        super(app);
    }

    onOpen(): void {
        this.setTitle("默认字段模板");
        this.contentEl.createEl("p", {
            cls: "hl-template-desc",
            text: "新建词卡时自动带上这些字段（自定义字段留空待填）。「释义」「音标」锁定，拼写卡依赖它们。",
        });

        this.listEl = this.contentEl.createDiv({ cls: "hl-template-list" });
        this.renderList();

        new Setting(this.contentEl).addButton((button) =>
            button.setButtonText("完成").setCta().onClick(() => this.close()),
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderList(): void {
        if (this.listEl === null) return;
        renderTemplateEditor(this.listEl, this.plugin.settings.fieldTemplates, (next) => {
            this.plugin.settings.fieldTemplates = next;
            void this.plugin.saveSettings().then(() => this.renderList());
        });
    }
}
