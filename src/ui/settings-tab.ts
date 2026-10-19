import { App, PluginSettingTab, Setting } from "obsidian";

import { renderTemplateEditor } from "src/ui/field-template-editor";
import HandyLearnPlugin from "src/main";

export class HandyLearnSettingTab extends PluginSettingTab {
    constructor(app: App, private plugin: HandyLearnPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("词卡目录")
            .setDesc("词卡笔记存放的文件夹，默认 Words。")
            .addText((text) =>
                text
                    .setPlaceholder("Words")
                    .setValue(this.plugin.settings.vocabOutputFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.vocabOutputFolder = value.trim() || "Words";
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("阅读模式高亮")
            .setDesc("在阅读模式里高亮已经建过卡的单词。")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.highlightEnabled).onChange(async (value) => {
                    this.plugin.settings.highlightEnabled = value;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName("AI 例句")
            .setDesc("建卡时用 AI 生成例句（可选）。需要配置 DeepSeek 或豆包的 API Key。")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("deepseek", "DeepSeek")
                    .addOption("doubao", "豆包")
                    .setValue(this.plugin.settings.vocabAiProvider)
                    .onChange(async (value) => {
                        this.plugin.settings.vocabAiProvider = value as "deepseek" | "doubao";
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("AI API Key")
            .setDesc("留空则建卡时不生成 AI 例句。")
            .addText((text) =>
                text
                    .setPlaceholder("sk-...")
                    .setValue(this.plugin.settings.vocabAiApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.vocabAiApiKey = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName("AI 模型")
            .setDesc("留空用服务商默认模型。")
            .addText((text) =>
                text
                    .setPlaceholder("deepseek-chat")
                    .setValue(this.plugin.settings.vocabAiModel)
                    .onChange(async (value) => {
                        this.plugin.settings.vocabAiModel = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        this.renderFieldTemplates(containerEl);
    }

    /** 字段模板编辑器：新建词卡时按这里的字段和顺序生成。 */
    private renderFieldTemplates(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName("词卡字段模板")
            .setDesc(
                "新建词卡时自动带上这些字段，自定义字段留空等你填写。「释义」「音标」锁定，拼写卡依赖它们。",
            );

        const list = containerEl.createDiv({ cls: "hl-template-list" });
        renderTemplateEditor(list, this.plugin.settings.fieldTemplates, (next) => {
            this.plugin.settings.fieldTemplates = next;
            void this.plugin.saveSettings().then(() => this.display());
        });
    }
}
