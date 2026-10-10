import { Component, ItemView, MarkdownRenderer, Notice, Scope, setIcon, WorkspaceLeaf } from "obsidian";

import { ReviewCard } from "src/engine/card";
import { pronounce } from "src/utils/pronounce";
import { ReviewRating } from "src/engine/scheduler";
import { VocabStore } from "src/engine/store";
import { collectVocabRecords, VocabRecord } from "src/dictionary/vocab-library";
import { firstGloss } from "src/dictionary/vocab-card";
import { parseVocabNote } from "src/engine/parser";
import type HandyLearnPlugin from "src/main";

export const REVIEW_VIEW_TYPE = "handylearn-view";

/** 右侧栏主页：词库统计 + 词库列表 + 复习 + 单词卡，四合一，不遮挡阅读。 */
export class ReviewSidebarView extends ItemView {
    private plugin: HandyLearnPlugin;
    private store: VocabStore;
    private component = new Component();

    // 复习状态
    private reviewing = false;
    private queue: ReviewCard[] = [];
    private index = 0;
    private shown = false;

    // 单词卡状态
    private showingWord: VocabRecord | null = null;

    // 拼写卡是否已答错、等待「继续」
    private spellingPendingContinue = false;

    constructor(leaf: WorkspaceLeaf, plugin: HandyLearnPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.store = new VocabStore(this.app);
    }

    getViewType(): string {
        return REVIEW_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "顺手学";
    }

    getIcon(): string {
        return "book-open";
    }

    async onOpen(): Promise<void> {
        this.component.load();

        this.scope = new Scope(this.app.scope);
        this.scope.register([], " ", () => {
            if (!this.reviewing) return;
            const card = this.queue[this.index];
            if (card.kind === "spelling") {
                if (this.spellingPendingContinue) void this.finishSpelling("again");
                return;
            }
            if (!this.shown) this.flip();
        });
        this.scope.register([], "0", () => void this.rate("again"));
        this.scope.register([], "1", () => void this.rate("hard"));
        this.scope.register([], "2", () => void this.rate("good"));
        this.scope.register([], "3", () => void this.rate("easy"));

        await this.renderDashboard();
    }

    async onClose(): Promise<void> {
        this.component.unload();
    }

    /** 刷新当前显示（词库变化后由外部调用）。 */
    async refresh(): Promise<void> {
        if (this.reviewing) return;
        if (this.showingWord) await this.showWordCard(this.showingWord.word);
        else await this.renderDashboard();
    }

    private resetContent(): void {
        this.contentEl.empty();
        this.component.unload();
        this.component = new Component();
        this.component.load();
    }

    // ---------- 主页 ----------

    async renderDashboard(): Promise<void> {
        this.reviewing = false;
        this.showingWord = null;
        this.resetContent();

        const folder = this.plugin.settings.vocabOutputFolder;
        const scan = await this.store.scan(folder);
        const records = collectVocabRecords(this.app, folder, this.plugin.dictionary).sort(
            (a, b) => b.modifiedMs - a.modifiedMs,
        );

        const header = this.contentEl.createDiv({ cls: "hl-header" });
        header.createEl("h4", { text: "顺手学" });

        const stats = this.contentEl.createDiv({ cls: "hl-stats" });
        stats.createSpan({
            text: `词卡 ${scan.totalNotes} 篇 · 到期 ${scan.dueGeneral} 张`,
        });

        const startBtn = this.contentEl.createEl("button", {
            text: "开始今日学习",
            cls: "hl-primary-btn",
        });
        startBtn.addEventListener("click", () => void this.startReview());

        const extractBtn = this.contentEl.createEl("button", {
            text: "从当前笔记提取生词",
            cls: "hl-primary-btn",
        });
        extractBtn.addEventListener("click", () => void this.plugin.extractFromActiveNote());

        const listHeader = this.contentEl.createDiv({ cls: "hl-list-header" });
        listHeader.setText(`词库（${records.length}）`);

        const list = this.contentEl.createDiv({ cls: "hl-word-list" });
        if (records.length === 0) {
            list.createDiv({ text: "还没有词卡，去阅读模式右键建卡吧。", cls: "hl-empty" });
        }
        for (const record of records) {
            const item = list.createDiv({ cls: "hl-word-item" });
            const word = item.createSpan({ text: record.word, cls: "hl-word" });
            const gloss = item.createSpan({
                text: record.entry ? firstGloss(record.entry) : "",
                cls: "hl-gloss",
            });
            word.setAttribute("aria-label", record.word);
            gloss.setAttribute("aria-label", record.entry ? firstGloss(record.entry) : "");
            item.addEventListener("click", () => void this.showWordCard(record.word));
        }
    }

    // ---------- 单词卡 ----------

    async showWordCard(word: string, fromReview = false): Promise<void> {
        if (!fromReview) this.reviewing = false;
        this.resetContent();

        const folder = this.plugin.settings.vocabOutputFolder;
        const record = collectVocabRecords(this.app, folder, this.plugin.dictionary).find(
            (r) => r.word.toLowerCase() === word.toLowerCase(),
        );
        if (record === undefined) {
            if (fromReview) await this.renderReviewCard();
            else await this.renderDashboard();
            return;
        }
        this.showingWord = record;

        const backBtn = this.contentEl.createEl("button", {
            text: fromReview ? "← 返回复习" : "← 返回词库",
            cls: "hl-back-btn",
        });
        backBtn.addEventListener("click", () => {
            if (fromReview) void this.renderReviewCard();
            else void this.renderDashboard();
        });

        const title = this.contentEl.createDiv({ cls: "hl-wordcard-title" });
        title.setText(record.word);
        if (record.entry?.ipa) {
            title.createSpan({ text: ` ${record.entry.ipa}`, cls: "hl-wordcard-ipa" });
        }
        this.addSpeakButton(title, record.word);

        const text = await this.app.vault.read(record.file);
        const back = parseVocabNote(text, record.file.path)[0]?.back ?? "";

        const body = this.contentEl.createDiv({ cls: "hl-wordcard-body" });
        await MarkdownRenderer.render(this.app, back, body, record.file.path, this.component);
    }

    // ---------- 复习 ----------

    async startReview(): Promise<void> {
        const folder = this.plugin.settings.vocabOutputFolder;
        const cards = await this.store.getDueCards(folder);
        if (cards.length === 0) {
            new Notice("今天没有到期词卡");
            return;
        }
        this.queue = cards;
        this.index = 0;
        this.shown = false;
        this.reviewing = true;
        this.showingWord = null;
        await this.renderReviewCard();
    }

    private flip(): void {
        this.shown = true;
        void this.renderReviewCard();
    }

    private async rate(rating: ReviewRating): Promise<void> {
        if (!this.reviewing || !this.shown) return;

        const card = this.queue[this.index];
        // 拼写卡走输入框判分，不响应数字快捷键
        if (card.kind === "spelling") return;
        await this.store.applyReview(card, rating);

        this.index++;
        this.shown = false;

        if (this.index >= this.queue.length) {
            new Notice(`今日复习完成，共 ${this.queue.length} 张`);
            this.reviewing = false;
            await this.renderDashboard();
            return;
        }
        await this.renderReviewCard();
    }

    private async renderReviewCard(): Promise<void> {
        this.resetContent();

        const card = this.queue[this.index];

        const top = this.contentEl.createDiv({ cls: "hl-review-top" });
        const backBtn = top.createEl("button", { text: "← 返回词库", cls: "hl-back-btn" });
        backBtn.addEventListener("click", () => void this.renderDashboard());

        const progress = this.contentEl.createDiv({ cls: "hl-progress" });
        progress.setText(
            `第 ${this.index + 1} / ${this.queue.length} 张 · ${card.kind === "recognition" ? "认词" : "拼写"}`,
        );

        if (card.kind === "spelling") {
            await this.renderSpellingCard(card);
            return;
        }

        const frontEl = this.contentEl.createDiv({ cls: "hl-card-front" });
        await MarkdownRenderer.render(this.app, card.front, frontEl, "", this.component);
        frontEl.addEventListener("click", () => void this.showWordCard(card.word, true));
        this.addSpeakButton(frontEl, card.word);

        if (this.shown) {
            const divider = this.contentEl.createDiv({ cls: "hl-divider" });
            divider.setText("答案");

            const backEl = this.contentEl.createDiv({ cls: "hl-card-back" });
            await MarkdownRenderer.render(this.app, card.back, backEl, "", this.component);

            const btnRow = this.contentEl.createDiv({ cls: "hl-buttons" });
            this.addRateButton(btnRow, "忘记", "again", "0");
            this.addRateButton(btnRow, "较难", "hard", "1");
            this.addRateButton(btnRow, "记得", "good", "2");
            this.addRateButton(btnRow, "简单", "easy", "3");
        } else {
            const showBtn = this.contentEl.createEl("button", {
                text: "显示答案（空格）",
                cls: "hl-show-btn",
            });
            showBtn.addEventListener("click", () => this.flip());
        }
    }

    /** 从拼写卡正面（完整释义）里抽出中文释义 + 音标提示，避免英文例句/词形泄题。 */
    private spellingPrompt(card: ReviewCard): { gloss: string; ipa: string } {
        const glossLines: string[] = [];
        let ipa = "";
        let glossEnded = false;
        for (const line of card.front.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("**音标：**")) {
                ipa = trimmed.replace("**音标：**", "").trim();
            } else if (!glossEnded && trimmed.startsWith("**")) {
                glossEnded = true;
            } else if (!glossEnded && trimmed.length > 0) {
                glossLines.push(trimmed);
            }
        }
        return { gloss: glossLines.join("\n"), ipa };
    }

    private async renderSpellingCard(card: ReviewCard): Promise<void> {
        this.spellingPendingContinue = false;

        const prompt = this.spellingPrompt(card);

        const frontEl = this.contentEl.createDiv({ cls: "hl-card-front" });
        if (prompt.gloss) {
            await MarkdownRenderer.render(this.app, prompt.gloss, frontEl, "", this.component);
        }
        if (prompt.ipa) {
            frontEl.createDiv({ cls: "hl-spell-ipa", text: prompt.ipa });
        }

        const input = this.contentEl.createEl("input", {
            cls: "hl-spell-input",
            type: "text",
        });
        input.placeholder = "输入英文单词";

        const feedback = this.contentEl.createDiv({ cls: "hl-spell-feedback" });
        const btn = this.contentEl.createEl("button", { text: "提交", cls: "hl-show-btn" });

        const check = (): void => {
            if (this.spellingPendingContinue) {
                void this.finishSpelling("again");
                return;
            }
            const correct = input.value.trim().toLowerCase() === card.word.toLowerCase();
            if (correct) {
                void this.finishSpelling("good");
                return;
            }
            this.spellingPendingContinue = true;
            input.disabled = true;
            feedback.setText(`正确答案：${card.word}`);
            btn.setText("继续");
        };

        btn.addEventListener("click", check);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") check();
        });
        input.focus();
    }

    private async finishSpelling(rating: "good" | "again"): Promise<void> {
        if (!this.reviewing) return;
        this.spellingPendingContinue = false;
        const card = this.queue[this.index];
        await this.store.applyReview(card, rating);

        this.index++;
        this.shown = false;

        if (this.index >= this.queue.length) {
            new Notice(`今日复习完成，共 ${this.queue.length} 张`);
            this.reviewing = false;
            await this.renderDashboard();
            return;
        }
        await this.renderReviewCard();
    }

    /** 加一个发音按钮（喇叭图标），点击用系统语音朗读英文。 */
    private addSpeakButton(parent: HTMLElement, text: string): void {
        const btn = parent.createEl("button", {
            cls: "hl-speak-btn",
            attr: { "aria-label": "发音" },
        });
        setIcon(btn, "volume-2");
        btn.addEventListener("click", (event) => {
            event.stopPropagation();
            pronounce(text);
        });
    }

    private addRateButton(
        parent: HTMLElement,
        label: string,
        rating: ReviewRating,
        key: string,
    ): void {
        const btn = parent.createEl("button", { text: `${label} ${key}`, cls: "hl-rate-btn" });
        btn.addEventListener("click", () => void this.rate(rating));
    }
}
