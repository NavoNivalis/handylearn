import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";

import { Ecdict } from "src/dictionary/ecdict";
import { DEFAULT_SETTINGS, HandyLearnSettings } from "src/settings";
import { BatchVocabModal } from "src/ui/modals/batch-vocab-modal";
import { CreateVocabCardModal } from "src/ui/modals/create-vocab-card-modal";
import { ExtractWordsModal } from "src/ui/modals/extract-words-modal";
import { REVIEW_VIEW_TYPE, ReviewSidebarView } from "src/ui/review-sidebar-view";
import { HandyLearnSettingTab } from "src/ui/settings-tab";
import { VocabHighlighter } from "src/ui/vocab-highlight";
import { WordContextMenu } from "src/ui/word-context-menu";

export default class HandyLearnPlugin extends Plugin {
    settings: HandyLearnSettings = { ...DEFAULT_SETTINGS };
    dictionary = new Ecdict();

    async onload(): Promise<void> {
        await this.loadSettings();
        await this.dictionary.load(this.app, this.manifest.id);

        this.addSettingTab(new HandyLearnSettingTab(this.app, this));

        this.registerView(REVIEW_VIEW_TYPE, (leaf) => new ReviewSidebarView(leaf, this));

        this.addRibbonIcon("book-open", "打开顺手学", () => void this.openSidebar());

        this.addCommand({
            id: "open-sidebar",
            name: "打开顺手学",
            callback: () => void this.openSidebar(),
        });

        this.addCommand({
            id: "create-vocab-card",
            name: "新建词卡",
            callback: () => new CreateVocabCardModal(this.app, this).open(),
        });

        this.addCommand({
            id: "extract-words",
            name: "从当前笔记提取生词",
            callback: () => void this.extractFromActiveNote(),
        });

        this.addCommand({
            id: "batch-vocab",
            name: "批量建卡",
            callback: () => new BatchVocabModal(this.app, this).open(),
        });

        new VocabHighlighter(this).register();
        new WordContextMenu(this).register();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /** 打开右侧栏主页。 */
    async openSidebar(): Promise<void> {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf === null) return;
        await leaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
    }

    /** 打开右侧栏并定位到某个单词卡（复用已有视图，不新建）。 */
    async openWordCard(word: string): Promise<void> {
        let leaf: WorkspaceLeaf | null =
            this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE)[0] ?? null;
        if (leaf === null) {
            leaf = this.app.workspace.getRightLeaf(false);
            if (leaf === null) return;
        }
        // 无论复用还是新建，都要 setViewState 激活视图：
        // 后台/折叠的 leaf 会处于 deferred 状态，view 不是 ReviewSidebarView，直接 showWordCard 会失效。
        await leaf.setViewState({ type: REVIEW_VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
        if (leaf.view instanceof ReviewSidebarView) {
            await leaf.view.showWordCard(word);
        }
    }

    /** 词库变化后刷新右侧栏。 */
    async refreshSidebar(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType(REVIEW_VIEW_TYPE)) {
            if (leaf.view instanceof ReviewSidebarView) {
                await leaf.view.refresh();
            }
        }
    }

    async extractFromActiveNote(): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (file === null) {
            new Notice("请先打开一篇笔记");
            return;
        }
        const text = await this.app.vault.read(file);
        new ExtractWordsModal(this.app, this, text, file as TFile).open();
    }
}
