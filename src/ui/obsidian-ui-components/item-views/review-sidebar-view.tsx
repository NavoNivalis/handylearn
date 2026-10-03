import "src/ui/obsidian-ui-components/item-views/review-sidebar-view.css";
import { ItemView, Menu, Notice, normalizePath, TFile, WorkspaceLeaf } from "obsidian";

import { Deck } from "src/data/data-structures/deck/deck";
import { DictEntry } from "src/data/dictionary/ecdict";
import {
    firstGloss,
    formatExchange,
    formatTags,
    parseExample,
    TECHNICAL_DECK_NAME,
    translationLines,
} from "src/data/dictionary/vocab-card";
import {
    ExtractGroupId,
    groupOrder,
    groupWord,
} from "src/data/dictionary/vocab-extract";
import { collectVocabRecords } from "src/data/dictionary/vocab-library";
import { vocabNotePath } from "src/data/dictionary/vocab-vault";
import { SettingsManager } from "src/data/settings-manager";
import { StudyGroup } from "src/data/study/study-plan";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { RepItemState } from "src/scheduling/algorithms/base/repetition-item";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import ContentManager from "src/ui/obsidian-ui-components/content-container/content-manager";
import { ReviewQueueLoader } from "src/ui/review-queue-loader";
import { vocabGroupLabel } from "src/ui/vocab-groups";

export const REVIEW_SIDEBAR_VIEW_TYPE = "sr-review-sidebar-view";

/** Beyond Words 的生成器命令 */
const BEYOND_WORDS_COMMAND = "beyond-words:open-generator";

/** 间隔达到这个天数就算「已掌握」 */
const MATURE_INTERVAL_DAYS = 21;

/** 复习分三段：当前组 → 全局（都不含专业词）→ 专业词单独复习。 */
type ReviewStage = "group" | "all" | "technical";

/** 统计待复习卡片，跳过专业词卡组 */
function countExcludingTechnical(deck: Deck): number {
    if (deck.deckName === TECHNICAL_DECK_NAME) return 0;

    let total = deck.newRepItems.length + deck.dueRepItems.length;
    for (const subdeck of deck.subdecks) {
        total += countExcludingTechnical(subdeck);
    }
    return total;
}

/**
 * Right-sidebar view that hosts the study dashboard and the flashcard review UI.
 *
 * Today's flow: learn the current group (10 new words) first, then work through
 * everything else that is due. Finishing both checks you in for the day.
 */
export class SRReviewSidebarView extends ItemView {
    private plugin: SRPlugin;
    private settingsManager: SettingsManager;
    private contentManager: ContentManager | null = null;

    private reviewMode: FlashcardReviewMode = FlashcardReviewMode.Review;
    private singleNote: TFile | null = null;

    private stage: ReviewStage = "all";
    private groupFiles: TFile[] | null = null;
    private technicalFiles: TFile[] = [];

    private dashboardEl: HTMLElement | null = null;
    private reviewEl: HTMLElement | null = null;
    private libraryEl: HTMLElement | null = null;
    private libraryListEl: HTMLElement | null = null;
    private wordCardEl: HTMLElement | null = null;

    private libraryQuery = "";
    private libraryFilter: ExtractGroupId | "all" = "all";
    private librarySort: "frequency" | "alpha" | "recent" = "frequency";

    private groupEl: HTMLElement | null = null;
    private summaryEl: HTMLElement | null = null;
    private dashboardBackBtn: HTMLElement | null = null;
    private dueTodayEl: HTMLElement | null = null;
    private reviewedTodayEl: HTMLElement | null = null;
    private totalEl: HTMLElement | null = null;
    private streakEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SRPlugin, settingsManager: SettingsManager) {
        super(leaf);
        this.plugin = plugin;
        this.settingsManager = settingsManager;
    }

    getViewType(): string {
        return REVIEW_SIDEBAR_VIEW_TYPE;
    }

    getDisplayText(): string {
        return t("REVIEW_CARDS");
    }

    getIcon(): string {
        return "SpacedRepIcon";
    }

    onHeaderMenu(menu: Menu): void {
        menu.addItem((item) => {
            item.setTitle(t("CLOSE"))
                .setIcon("cross")
                .onClick(() => {
                    this.app.workspace.detachLeavesOfType(REVIEW_SIDEBAR_VIEW_TYPE);
                });
        });
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass("sr-review-sidebar-view");
        this.renderDashboard();
    }

    async onClose(): Promise<void> {
        if (this.contentManager) this.contentManager.close();
        this.contentManager = null;
    }

    /**
     * Sets the review mode/single note and refreshes the dashboard numbers.
     */
    prepareReview(mode: FlashcardReviewMode, singleNote: TFile | null): void {
        this.reviewMode = mode;
        this.singleNote = singleNote;
        this.refreshDashboardStats();
    }

    private renderDashboard(): void {
        this.contentEl.empty();
        this.dashboardEl = this.contentEl.createDiv("sr-review-dashboard");

        // 复习中的「返回词库」入口，默认隐藏
        this.dashboardBackBtn = this.dashboardEl.createDiv("sr-dashboard-back");
        this.dashboardBackBtn.setText(t("VOCAB_BACK_TO_LIBRARY"));
        this.dashboardBackBtn.addClass("sr-is-hidden");
        this.dashboardBackBtn.onClickEvent(() => this.exitReview());

        const titleEl = this.dashboardEl.createDiv("sr-dashboard-title");
        titleEl.setText(t("STUDY_TODAY_TITLE"));

        this.groupEl = this.dashboardEl.createDiv("sr-study-group");
        this.groupEl.onClickEvent(() => {
            void this.toggleSummary();
        });

        this.summaryEl = this.dashboardEl.createDiv("sr-study-summary");
        this.summaryEl.addClass("sr-is-hidden");

        this.streakEl = this.dashboardEl.createDiv("sr-study-streak");

        const statsRow = this.dashboardEl.createDiv("sr-dashboard-stats");
        this.dueTodayEl = this.createStatCard(statsRow, t("DUE_TODAY"), "sr-stat-due").value;
        this.reviewedTodayEl = this.createStatCard(
            statsRow,
            t("REVIEWED_TODAY"),
            "sr-stat-reviewed",
        ).value;

        const totalCard = this.createStatCard(statsRow, t("TOTAL_CARDS"), "sr-stat-total");
        this.totalEl = totalCard.value;

        const startBtn = this.dashboardEl.createDiv("sr-dashboard-start");
        startBtn.addClass("sr-bg-blue");
        startBtn.setText(t("STUDY_START"));
        startBtn.onClickEvent(() => {
            void this.startToday();
        });

        const articleBtn = this.dashboardEl.createDiv("sr-dashboard-secondary");
        articleBtn.setText(t("STUDY_ARTICLE"));
        articleBtn.onClickEvent(() => this.openBeyondWords());

        const newGroupBtn = this.dashboardEl.createDiv("sr-dashboard-secondary");
        newGroupBtn.setText(t("STUDY_NEW_GROUP"));
        newGroupBtn.onClickEvent(() => {
            void this.startNewGroup();
        });

        const technicalBtn = this.dashboardEl.createDiv("sr-dashboard-secondary");
        technicalBtn.setText(t("STUDY_TECHNICAL"));
        technicalBtn.onClickEvent(() => {
            void this.startTechnicalReview();
        });

        // 词库浏览（主页面下半部分，占满剩余空间）
        this.libraryEl = this.contentEl.createDiv("sr-vocab-library");
        this.renderLibrary();

        // 单词卡详情（点击单词后替换词库列表）
        this.wordCardEl = this.contentEl.createDiv("sr-word-card");
        this.wordCardEl.addClass("sr-is-hidden");

        this.reviewEl = this.contentEl.createDiv("sr-review-content");
        this.reviewEl.addClass("sr-is-hidden");

        this.refreshDashboardStats();
    }

    /** 词库工具条 + 列表容器（只在初始化时构建一次）。 */
    private renderLibrary(): void {
        if (this.libraryEl === null) return;
        this.libraryEl.empty();

        this.libraryEl.createDiv({ cls: "sr-library-title", text: t("VOCAB_LIBRARY_TITLE") });

        const toolbar = this.libraryEl.createDiv("sr-library-toolbar");

        const searchInput = toolbar.createEl("input", { cls: "sr-library-search", type: "text" });
        searchInput.placeholder = t("VOCAB_SEARCH_PLACEHOLDER");
        searchInput.value = this.libraryQuery;

        const runSearch = (): void => {
            this.libraryQuery = searchInput.value.trim();
            void this.renderWordList();
        };

        const searchBtn = toolbar.createDiv("sr-library-search-btn");
        searchBtn.setText(t("VOCAB_SEARCH_BUTTON"));
        searchBtn.onClickEvent(runSearch);
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") runSearch();
        });

        const filterSelect = toolbar.createEl("select", { cls: "sr-library-select" });
        filterSelect.append(this.createSelectOption("all", t("VOCAB_FILTER_ALL")));
        for (const group of groupOrder("exam")) {
            filterSelect.append(this.createSelectOption(group, vocabGroupLabel(group)));
        }
        filterSelect.value = this.libraryFilter;
        filterSelect.addEventListener("change", () => {
            this.libraryFilter = filterSelect.value as ExtractGroupId | "all";
            void this.renderWordList();
        });

        const sortSelect = toolbar.createEl("select", { cls: "sr-library-select" });
        sortSelect.append(this.createSelectOption("frequency", t("VOCAB_SORT_FREQUENCY")));
        sortSelect.append(this.createSelectOption("alpha", t("VOCAB_SORT_ALPHA")));
        sortSelect.append(this.createSelectOption("recent", t("VOCAB_SORT_RECENT")));
        sortSelect.value = this.librarySort;
        sortSelect.addEventListener("change", () => {
            this.librarySort = sortSelect.value as "frequency" | "alpha" | "recent";
            void this.renderWordList();
        });

        this.libraryListEl = this.libraryEl.createDiv("sr-library-list");
        void this.renderWordList();
    }

    private createSelectOption(value: string, label: string): HTMLOptionElement {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    }

    /** 渲染词库列表：有搜索词走词典搜索，否则按 筛选→排序 展示词卡。 */
    private async renderWordList(): Promise<void> {
        if (this.libraryListEl === null) return;

        const dict = this.plugin.dictionary;
        if (!dict.isLoaded()) {
            await dict.load(this.app, this.plugin.manifest.id);
        }

        this.libraryListEl.empty();
        const folder = normalizePath(this.settingsManager.settings.vocabOutputFolder);

        if (this.libraryQuery.trim() !== "") {
            const results = dict.search(this.libraryQuery, 100);
            if (results.length === 0) {
                this.libraryListEl.createDiv({
                    cls: "sr-library-empty",
                    text: t("VOCAB_NO_RESULTS"),
                });
                return;
            }
            for (const item of results) {
                this.createWordRow(item.word, item.entry);
            }
            return;
        }

        const records = collectVocabRecords(this.app, folder, dict);
        const filtered =
            this.libraryFilter === "all"
                ? records
                : records.filter(
                      (record) =>
                          record.entry !== null &&
                          groupWord(record.entry) === this.libraryFilter,
                  );

        const sorted = [...filtered].sort((a, b) => {
            if (this.librarySort === "alpha") {
                return a.word.toLowerCase().localeCompare(b.word.toLowerCase());
            }
            if (this.librarySort === "recent") {
                return b.modifiedMs - a.modifiedMs;
            }
            return this.frequencyRank(a.entry) - this.frequencyRank(b.entry);
        });

        if (sorted.length === 0) {
            this.libraryListEl.createDiv({
                cls: "sr-library-empty",
                text: t("VOCAB_NO_RESULTS"),
            });
            return;
        }

        for (const record of sorted) {
            this.createWordRow(record.word, record.entry);
        }
    }

    private createWordRow(word: string, entry: DictEntry | null): void {
        if (this.libraryListEl === null) return;
        const row = this.libraryListEl.createDiv("sr-library-row");
        row.createDiv({ cls: "sr-library-word", text: word });
        row.createDiv({
            cls: "sr-library-gloss",
            text: entry === null ? "" : firstGloss(entry),
        });
        row.onClickEvent(() => this.showWordCard(word));
    }

    private frequencyRank(entry: DictEntry | null): number {
        if (entry === null) return Number.MAX_SAFE_INTEGER;
        const ranks = [entry.frq, entry.bnc]
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0);
        return ranks.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...ranks);
    }

    /** 隐藏词库，展示单个单词卡（供高亮词点击等外部入口调用）。 */
    public showWordCard(word: string): void {
        this.libraryEl?.addClass("sr-is-hidden");
        this.wordCardEl?.removeClass("sr-is-hidden");
        void this.renderWordCard(word);
    }

    /** 渲染单词卡：单词 + 音标 + 释义 + 例句 + 词形 + 考试 + 词频。 */
    private async renderWordCard(word: string): Promise<void> {
        if (this.wordCardEl === null) return;
        this.wordCardEl.empty();

        const backBtn = this.wordCardEl.createDiv("sr-word-card-back");
        backBtn.setText(t("VOCAB_BACK_TO_LIBRARY"));
        backBtn.onClickEvent(() => this.backToLibrary());

        this.wordCardEl.createDiv({ cls: "sr-word-card-word", text: word });

        const entry = this.plugin.dictionary.query(word);
        if (entry === null) {
            this.wordCardEl.createDiv({
                cls: "sr-word-card-gloss",
                text: t("VOCAB_WORD_NOT_FOUND"),
            });
            return;
        }

        if (entry.ipa) {
            this.wordCardEl.createDiv({ cls: "sr-word-card-ipa", text: entry.ipa });
        }

        for (const line of translationLines(entry)) {
            this.wordCardEl.createDiv({ cls: "sr-word-card-gloss", text: line });
        }

        // 例句与翻译来自词卡笔记正文（AI 生成时写入）
        const folder = normalizePath(this.settingsManager.settings.vocabOutputFolder);
        const file = this.app.vault.getFileByPath(vocabNotePath(folder, word));
        if (file !== null) {
            const content = await this.app.vault.cachedRead(file);
            const example = parseExample(content);
            if (example !== null) {
                this.wordCardEl.createDiv({ cls: "sr-word-card-example", text: example.sentence });
                if (example.translation) {
                    this.wordCardEl.createDiv({
                        cls: "sr-word-card-example-tr",
                        text: example.translation,
                    });
                }
            }
        }

        const exchange = formatExchange(entry.ex);
        if (exchange) {
            this.wordCardEl.createDiv({ cls: "sr-word-card-meta", text: exchange });
        }

        const tags = formatTags(entry.tag);
        if (tags) {
            this.wordCardEl.createDiv({ cls: "sr-word-card-meta", text: tags });
        }

        const frqParts: string[] = [];
        if (entry.frq) frqParts.push(`当代 ${entry.frq}`);
        if (entry.bnc) frqParts.push(`BNC ${entry.bnc}`);
        if (frqParts.length > 0) {
            this.wordCardEl.createDiv({
                cls: "sr-word-card-meta",
                text: `${t("VOCAB_FREQUENCY")}：${frqParts.join(" / ")}`,
            });
        }
    }

    /** 从单词卡返回词库列表。 */
    private backToLibrary(): void {
        this.wordCardEl?.addClass("sr-is-hidden");
        this.libraryEl?.removeClass("sr-is-hidden");
        void this.renderWordList();
    }

    /** 进入复习：隐藏词库与单词卡，显示复习区。 */
    private showReviewView(): void {
        this.libraryEl?.addClass("sr-is-hidden");
        this.wordCardEl?.addClass("sr-is-hidden");
        this.reviewEl?.removeClass("sr-is-hidden");
        this.dashboardBackBtn?.removeClass("sr-is-hidden");
    }

    /** 退出复习，回到词库主页面（不影响已复习进度，可随时再进入）。 */
    private exitReview(): void {
        if (this.contentManager) {
            this.contentManager.close();
            this.contentManager = null;
        }
        this.reviewEl?.empty();
        this.reviewEl?.addClass("sr-is-hidden");
        this.wordCardEl?.addClass("sr-is-hidden");
        this.libraryEl?.removeClass("sr-is-hidden");
        this.dashboardBackBtn?.addClass("sr-is-hidden");
        void this.renderWordList();
    }

    private createStatCard(
        parent: HTMLElement,
        label: string,
        extraClass: string,
    ): { card: HTMLElement; value: HTMLElement } {
        const card = parent.createDiv(`sr-stat-card ${extraClass}`);
        const value = card.createDiv("sr-stat-value");
        card.createDiv("sr-stat-label").setText(label);
        return { card, value };
    }

    private refreshDashboardStats(): void {
        const osrCore = this.plugin.dataManager.osrCore;
        const dueCount =
            osrCore.remainingDeckTree?.getRepItemCount(RepItemState.AnyItem, true) ?? 0;
        const totalCount = osrCore.reviewableDeckTree.getDistinctRepItemCount(
            RepItemState.AnyItem,
            true,
        );
        const reviewedCount = this.plugin.dataManager.getReviewedTodayCount();

        this.dueTodayEl?.setText(String(dueCount));
        this.reviewedTodayEl?.setText(String(reviewedCount));
        this.totalEl?.setText(String(totalCount));

        const summary = this.plugin.groupManager.summary();
        this.groupEl?.setText(
            summary.group === null || summary.isNewDay
                ? t("STUDY_NO_GROUP")
                : t("STUDY_GROUP_LABEL", {
                      id: summary.group.id,
                      count: summary.group.words.length,
                  }),
        );

        if (this.streakEl !== null) {
            const streak = t("STUDY_STREAK", { days: summary.streak });
            this.streakEl.setText(summary.checkedIn ? `${streak} · ${t("STUDY_CHECKED_IN")}` : streak);
        }
    }

    /** 展开/收起本组小结 */
    private async toggleSummary(): Promise<void> {
        if (this.summaryEl === null) return;

        if (!this.summaryEl.hasClass("sr-is-hidden")) {
            this.summaryEl.addClass("sr-is-hidden");
            return;
        }

        this.summaryEl.removeClass("sr-is-hidden");
        await this.renderSummary();
    }

    /** 列出所有组，当前组默认展开 */
    private async renderSummary(): Promise<void> {
        if (this.summaryEl === null) return;
        this.summaryEl.empty();

        const groups = [...this.plugin.studyPlan.plan.groups].reverse();
        if (groups.length === 0) {
            this.summaryEl.setText(t("STUDY_NO_GROUP"));
            return;
        }

        const currentId = this.plugin.studyPlan.plan.currentGroupId;

        for (const group of groups) {
            const row = this.summaryEl.createDiv("sr-group-row");

            const header = row.createDiv("sr-group-header");
            header.createSpan({ cls: "sr-group-title", text: t("STUDY_GROUP_TITLE", { id: group.id }) });
            header.createSpan({
                cls: "sr-group-meta",
                text: t("STUDY_GROUP_META", {
                    date: group.createdAt,
                    count: group.words.length,
                }),
            });

            const detail = row.createDiv("sr-group-detail");
            detail.addClass("sr-is-hidden");
            header.onClickEvent(() => {
                void this.toggleGroupDetail(group, detail);
            });

            if (group.id === currentId) {
                await this.toggleGroupDetail(group, detail);
            }
        }
    }

    private async toggleGroupDetail(group: StudyGroup, detail: HTMLElement): Promise<void> {
        if (!detail.hasClass("sr-is-hidden")) {
            detail.addClass("sr-is-hidden");
            return;
        }

        detail.removeClass("sr-is-hidden");
        if (detail.childElementCount > 0) return;

        await this.renderGroupDetail(group, detail);
    }

    /** 某组的明细：每个词的「认 / 拼」两张卡各自的掌握情况 */
    private async renderGroupDetail(group: StudyGroup, detail: HTMLElement): Promise<void> {
        const folder = this.settingsManager.settings.vocabOutputFolder;
        let mastered = 0;
        let learning = 0;
        let fresh = 0;

        for (const word of group.words) {
            const row = detail.createDiv("sr-summary-row");
            row.createDiv({ cls: "sr-summary-word", text: word });
            const cells = row.createDiv("sr-summary-cards");

            const file = this.app.vault.getFileByPath(vocabNotePath(folder, word));
            const note = file === null ? null : await this.plugin.dataManager.loadNote(file);
            const cards = note?.questionList.flatMap((question) => question.cards) ?? [];

            if (cards.length === 0) {
                cells.createSpan({ cls: "sr-summary-status", text: t("STUDY_STATUS_NEW") });
                fresh += 1;
                continue;
            }

            for (const card of cards) {
                const label =
                    card.cardIdx === 0 ? t("STUDY_CARD_RECALL") : t("STUDY_CARD_SPELL");
                const info = card.scheduleInfo;

                let text: string;
                let cls = "sr-summary-status";
                if (info === null) {
                    text = t("STUDY_STATUS_NEW");
                    fresh += 1;
                } else if (info.interval >= MATURE_INTERVAL_DAYS) {
                    text = t("STUDY_STATUS_MASTERED", { days: info.interval });
                    cls += " sr-summary-mastered";
                    mastered += 1;
                } else {
                    text = t("STUDY_STATUS_LEARNING", { days: info.interval });
                    learning += 1;
                }

                cells.createSpan({ cls, text: `${label} ${text}` });
            }
        }

        const footer = detail.createDiv("sr-summary-footer");
        footer.setText(
            t("STUDY_SUMMARY_TOTAL", {
                total: group.words.length,
                mastered,
                learning,
                fresh,
            }),
        );

        const progress = this.plugin.groupManager.wordListProgress();
        const progressEl = detail.createDiv("sr-summary-footer");
        progressEl.setText(
            t("STUDY_LIST_PROGRESS", { done: progress.done, total: progress.total }),
        );
    }

    /** 立即再开一组新词（不受「每天一组」限制） */
    private async startNewGroup(): Promise<void> {
        if (this.contentManager !== null || this.reviewEl === null) return;

        let group: StudyGroup | null = null;
        try {
            group = await this.plugin.groupManager.createNextGroup();
        } catch (error) {
            console.error("Failed to create a new group:", error);
        }

        if (group === null) {
            new Notice(t("STUDY_NO_MORE_WORDS"));
            return;
        }

        this.groupFiles = this.resolveGroupFiles(group);
        this.stage = this.groupFiles.length > 0 ? "group" : "all";
        this.showReviewView();
        await this.runStage();
    }

    /** 「开始今日学习」：先保证今天有一组新词，然后从这组开始复习 */
    private async startToday(): Promise<void> {
        if (this.contentManager !== null || this.reviewEl === null) return;

        let group: StudyGroup | null = null;
        try {
            group = await this.plugin.groupManager.startToday();
        } catch (error) {
            console.error("Failed to prepare today's group:", error);
            new Notice(t("STUDY_NO_GROUP"));
        }

        this.groupFiles = group === null ? null : this.resolveGroupFiles(group);
        this.stage = this.groupFiles !== null && this.groupFiles.length > 0 ? "group" : "all";

        this.showReviewView();
        await this.runStage();
    }

    /**
     * 跑当前阶段。这一阶段没有卡可复习就自动往后走；
     * 两个阶段都跑完就打卡。
     */
    private async runStage(): Promise<void> {
        if (this.reviewEl === null) return;

        let remaining: number;
        try {
            remaining = await this.countRemaining();
        } catch (error) {
            console.error("Failed to count the review queue:", error);
            new Notice(t("STUDY_QUEUE_FAILED"));
            return;
        }

        if (remaining > 0) {
            await this.openContentManager();
            return;
        }

        if (this.stage === "group") {
            this.stage = "all";
            await this.runStage();
            return;
        }

        if (this.stage === "technical") {
            // 专业词复习完，回仪表盘（不打卡）
            this.reviewEl.addClass("sr-is-hidden");
            this.renderDashboard();
            return;
        }

        await this.finishToday();
    }

    /** 单独复习专业词（#flashcards/technical 卡组） */
    private async startTechnicalReview(): Promise<void> {
        if (this.contentManager !== null || this.reviewEl === null) return;

        this.technicalFiles = await this.findTechnicalNoteFiles();
        if (this.technicalFiles.length === 0) {
            new Notice(t("STUDY_NO_TECHNICAL"));
            return;
        }

        this.stage = "technical";
        this.showReviewView();
        await this.runStage();
    }

    /** 找出目录里 frontmatter 标了 class: technical 的词汇笔记 */
    private async findTechnicalNoteFiles(): Promise<TFile[]> {
        const folder = normalizePath(this.settingsManager.settings.vocabOutputFolder);
        const result: TFile[] = [];

        for (const file of this.app.vault.getMarkdownFiles()) {
            if (file.parent?.path !== folder) continue;
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter?.class === "technical") result.push(file);
        }

        return result;
    }

    /** 当前阶段还剩多少张卡要复习 */
    private async countRemaining(): Promise<number> {
        const stageFiles =
            this.stage === "group"
                ? this.groupFiles
                : this.stage === "technical"
                  ? this.technicalFiles
                  : null;

        if (stageFiles !== null && stageFiles.length > 0) {
            const { remainingDeckTree } = await this.createLoader().getPreparedDecksForNotes(
                stageFiles,
                this.reviewMode,
            );
            return remainingDeckTree.getRepItemCount(RepItemState.AnyItem, true);
        }

        // 日常复习不统计专业词卡组
        return countExcludingTechnical(this.plugin.dataManager.osrCore.remainingDeckTree);
    }

    private createLoader(): ReviewQueueLoader {
        if (this.stage === "technical") {
            return new ReviewQueueLoader(
                this.plugin,
                this.plugin.dataManager.osrCore,
                this.singleNote,
                this.reviewMode,
                this.technicalFiles,
            );
        }

        return new ReviewQueueLoader(
            this.plugin,
            this.plugin.dataManager.osrCore,
            this.singleNote,
            this.reviewMode,
            this.stage === "group" ? this.groupFiles : null,
            true, // 日常复习跳过专业词卡组
        );
    }

    private async openContentManager(): Promise<void> {
        if (this.reviewEl === null) return;

        const manager = new ContentManager(
            this.app,
            this.plugin,
            this.createLoader(),
            this.settingsManager.settings,
            this.reviewEl,
            () => this.onStageDone(),
            () => this.refreshDashboardStats(),
            true,
        );

        this.contentManager = manager;
        this.plugin.uiManager.setContentManager(manager);

        try {
            await manager.open();
        } catch (error) {
            console.error("Failed to open the review view:", error);
            new Notice(t("STUDY_QUEUE_FAILED"));
            this.contentManager = null;
            this.reviewEl.addClass("sr-is-hidden");
            this.wordCardEl?.addClass("sr-is-hidden");
            this.libraryEl?.removeClass("sr-is-hidden");
            this.dashboardBackBtn?.addClass("sr-is-hidden");
        }
    }

    /** 一个阶段复习完：先当前组，再全局，最后打卡；专业词复习完直接回仪表盘 */
    private onStageDone(): void {
        if (this.contentManager) this.contentManager.close();
        this.contentManager = null;
        this.reviewEl?.empty();

        if (this.stage === "technical") {
            this.reviewEl?.addClass("sr-is-hidden");
            this.renderDashboard();
            return;
        }

        if (this.stage === "group") {
            this.stage = "all";
        }

        void this.runStage();
    }

    private async finishToday(): Promise<void> {
        await this.plugin.studyPlan.setCheckedIn(true);

        this.reviewEl?.addClass("sr-is-hidden");
        this.refreshDashboardStats();
        new Notice(t("STUDY_CHECKED_IN"));
    }

    /** 打开 Beyond Words 的生成器（词表文件已由 GroupManager 写好） */
    private openBeyondWords(): void {
        // Obsidian 没有公开 app.commands 的类型定义，这里按社区通行做法做一次窄化
        const registry = (
            this.app as unknown as {
                commands?: {
                    findCommand(id: string): unknown;
                    executeCommandById(id: string): boolean;
                };
            }
        ).commands;

        if (!registry || registry.findCommand(BEYOND_WORDS_COMMAND) === null) {
            new Notice(t("STUDY_BW_MISSING"));
            return;
        }

        registry.executeCommandById(BEYOND_WORDS_COMMAND);
    }

    private resolveGroupFiles(group: StudyGroup): TFile[] {
        const folder = this.settingsManager.settings.vocabOutputFolder;
        const files: TFile[] = [];

        for (const word of group.words) {
            const file = this.app.vault.getFileByPath(vocabNotePath(folder, word));
            if (file) files.push(file);
        }

        return files;
    }
}
