import { App, TFile, WorkspaceLeaf } from "obsidian";

import { SettingsManager } from "src/data/settings-manager";
import SRPlugin from "src/main";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import {
    REVIEW_SIDEBAR_VIEW_TYPE,
    SRReviewSidebarView,
} from "src/ui/obsidian-ui-components/item-views/review-sidebar-view";
import {
    REVIEW_QUEUE_VIEW_TYPE,
    ReviewQueueListView,
} from "src/ui/obsidian-ui-components/item-views/review-queue-list-view";

export class SidebarManager {
    private plugin: SRPlugin;
    private settingsManager: SettingsManager;
    private reviewQueueListView: ReviewQueueListView | null = null;
    private reviewSidebarView: SRReviewSidebarView | null = null;

    private get app(): App {
        return this.plugin.app;
    }

    constructor(plugin: SRPlugin, settingsManager: SettingsManager) {
        this.plugin = plugin;
        this.settingsManager = settingsManager;
    }

    redraw(): void {
        if (this.reviewQueueListView === null) return;
        this.reviewQueueListView.redraw();
    }

    private getActiveLeaf(type: string): WorkspaceLeaf | null {
        const leaves = this.app.workspace.getLeavesOfType(type);
        if (leaves.length === 0) {
            return this.app.workspace.getRightLeaf(false);
        }

        return leaves[0];
    }

    init(): void {
        this.plugin.registerView(REVIEW_QUEUE_VIEW_TYPE, (leaf) => {
            return (this.reviewQueueListView = new ReviewQueueListView(
                leaf,
                this.plugin.nextNoteReviewHandler,
                this.settingsManager.settings,
                this.plugin,
            ));
        });

        this.plugin.registerView(REVIEW_SIDEBAR_VIEW_TYPE, (leaf) => {
            return (this.reviewSidebarView = new SRReviewSidebarView(
                leaf,
                this.plugin,
                this.settingsManager,
            ));
        });
    }

    /**
     * Opens the review dashboard sidebar view and prepares it for the given review mode.
     */
    async openReviewSidebarView(
        mode: FlashcardReviewMode,
        singleNote: TFile | null,
    ): Promise<void> {
        const leaf = this.getActiveLeaf(REVIEW_SIDEBAR_VIEW_TYPE);
        if (!leaf) return;

        await leaf.setViewState({
            type: REVIEW_SIDEBAR_VIEW_TYPE,
            active: true,
        });

        await this.app.workspace.revealLeaf(leaf);

        if (this.reviewSidebarView) {
            this.reviewSidebarView.prepareReview(mode, singleNote);
        }
    }

    /**
     * Opens the review sidebar and shows a single word card.
     */
    async openWordCard(word: string): Promise<void> {
        const leaf = this.getActiveLeaf(REVIEW_SIDEBAR_VIEW_TYPE);
        if (!leaf) return;

        await leaf.setViewState({
            type: REVIEW_SIDEBAR_VIEW_TYPE,
            active: true,
        });

        await this.app.workspace.revealLeaf(leaf);

        this.reviewSidebarView?.showWordCard(word);
    }

    async activateReviewQueueViewPanel(): Promise<void> {
        if (this.settingsManager.settings.enableNoteReviewPaneOnStartup) {
            const activeLeaf = this.getActiveLeaf(REVIEW_QUEUE_VIEW_TYPE);
            if (!activeLeaf) return;

            await activeLeaf.setViewState({
                type: REVIEW_QUEUE_VIEW_TYPE,
                active: true,
            });
        }
    }

    async openReviewQueueView(): Promise<void> {
        const reviewQueueLeaf = this.getActiveLeaf(REVIEW_QUEUE_VIEW_TYPE);
        if (!reviewQueueLeaf) return;
        await this.app.workspace.revealLeaf(reviewQueueLeaf);
    }
}
