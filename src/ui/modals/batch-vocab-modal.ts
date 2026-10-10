import { App, Modal, Notice, Setting } from "obsidian";

import { VocabAi } from "src/dictionary/vocab-ai";
import { EXAM_TAGS } from "src/dictionary/vocab-card";
import { createVocabNote } from "src/dictionary/vocab-vault";
import type HandyLearnPlugin from "src/main";

const DEFAULT_COUNT = 100;

/**
 * 按考试词表批量建卡（四级 / 考研 / 托福 …），按词频排序，已存在的跳过。
 */
export class BatchVocabModal extends Modal {
    private plugin: HandyLearnPlugin;

    private tag = EXAM_TAGS[0].value;
    private count = DEFAULT_COUNT;
    private withExample = false;
    private running = false;

    private infoEl: HTMLElement | null = null;
    private startButton: HTMLButtonElement | null = null;

    constructor(app: App, plugin: HandyLearnPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        this.setTitle("批量建卡");

        new Setting(this.contentEl).setName("词表").addDropdown((dropdown) => {
            for (const item of EXAM_TAGS) dropdown.addOption(item.value, item.label);
            dropdown.setValue(this.tag);
            dropdown.onChange((value) => {
                this.tag = value;
                this.refreshInfo();
            });
        });

        new Setting(this.contentEl).setName("数量").addText((text) => {
            text.inputEl.type = "number";
            text.setValue(String(DEFAULT_COUNT));
            text.onChange((value) => {
                this.count = Math.max(1, Number.parseInt(value, 10) || DEFAULT_COUNT);
            });
        });

        new Setting(this.contentEl).setName("AI 生成例句").addToggle((toggle) => {
            toggle.onChange((value) => {
                this.withExample = value;
            });
        });

        this.infoEl = this.contentEl.createDiv("hl-vocab-progress");
        this.refreshInfo();

        new Setting(this.contentEl)
            .addButton((button) => {
                button.setButtonText("开始").setCta();
                this.startButton = button.buttonEl;
                button.onClick(() => void this.run());
            })
            .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private refreshInfo(): void {
        if (this.running || this.infoEl === null) return;
        const total = this.plugin.dictionary.listByTag(this.tag).length;
        this.infoEl.setText(`该词表共 ${total} 个词`);
    }

    private async run(): Promise<void> {
        if (this.running) return;

        this.running = true;
        if (this.startButton !== null) this.startButton.disabled = true;

        const settings = this.plugin.settings;
        const folder = settings.vocabOutputFolder;
        const words = this.plugin.dictionary.listByTag(this.tag).slice(0, this.count);
        const useAi = this.withExample && VocabAi.isConfigured(settings);

        let created = 0;
        let skipped = 0;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            this.infoEl?.setText(`创建中 ${i + 1}/${words.length}`);

            const entry = this.plugin.dictionary.query(word);
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

        await this.plugin.refreshSidebar();

        const message = `已创建 ${created} 张，跳过 ${skipped} 个`;
        this.infoEl?.setText(message);
        new Notice(message);
    }
}
