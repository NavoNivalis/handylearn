import { TFile } from "obsidian";

import { OsrCore } from "src/data/core";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import { TECHNICAL_DECK_NAME } from "src/data/dictionary/vocab-card";
import {
    DeckOrder,
    DeckTreeIterator,
    IDeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { SRSettings } from "src/data/settings";
import SRPlugin from "src/main";
import { Note } from "src/note/note";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
    IFlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";

/**
 * 复制卡组树，并去掉专业词卡组（#flashcards/technical）。
 * 卡片对象仍是同一批引用（评分才能落到真实卡片上），只复制树的结构。
 */
function excludeTechnicalDecks(deck: Deck): Deck {
    const clone = new Deck(deck.deckName, null);
    clone.newRepItems = [...deck.newRepItems];
    clone.dueRepItems = [...deck.dueRepItems];
    for (const sub of deck.subdecks) {
        if (sub.deckName === TECHNICAL_DECK_NAME) continue;
        const subClone = excludeTechnicalDecks(sub);
        subClone.parent = clone;
        clone.subdecks.push(subClone);
    }
    return clone;
}

export class ReviewQueueLoader {
    private plugin: SRPlugin;
    private osrCore: OsrCore;
    private singleNote: TFile | null = null;
    /** 只复习这几篇笔记里的卡片（用于「先复习当前组」） */
    private noteFiles: TFile[] | null = null;
    private reviewMode: FlashcardReviewMode;
    /** 是否把专业词卡组排除在队列外（日常复习用） */
    private skipTechnicalDecks: boolean;

    constructor(
        plugin: SRPlugin,
        osrCore: OsrCore,
        singleNote: TFile | null,
        reviewMode: FlashcardReviewMode,
        noteFiles: TFile[] | null = null,
        skipTechnicalDecks: boolean = false,
    ) {
        this.osrCore = osrCore;
        this.singleNote = singleNote;
        this.reviewMode = reviewMode;
        this.noteFiles = noteFiles;
        this.skipTechnicalDecks = skipTechnicalDecks;
        this.plugin = plugin;
    }

    public getSingleNote(): TFile | null {
        return this.singleNote;
    }

    public getReviewMode(): FlashcardReviewMode {
        return this.reviewMode;
    }

    setReviewMode(reviewMode: FlashcardReviewMode) {
        this.reviewMode = reviewMode;
    }

    public async loadReviewQueue(): Promise<IFlashcardReviewSequencer> {
        if (this.plugin === null || this.plugin.dataManager.osrCore === null)
            throw new Error("SR plugin or OSR app core not initialized!!!");

        if (!this.plugin.dataManager.syncLock) {
            await this.plugin.dataManager.sync();
        }

        let deckTree: Deck;
        let remainingDeckTree: Deck;

        if (this.noteFiles !== null && this.noteFiles.length > 0) {
            const notesData = await this.getPreparedDecksForNotes(this.noteFiles, this.reviewMode);
            deckTree = notesData.deckTree;
            remainingDeckTree = notesData.remainingDeckTree;
        } else if (this.singleNote) {
            const singleNoteDeckData = await this.getPreparedDecksForSingleNoteReview(
                this.singleNote,
                this.reviewMode,
            );

            deckTree = singleNoteDeckData.deckTree;
            remainingDeckTree = singleNoteDeckData.remainingDeckTree;
        } else {
            if (this.skipTechnicalDecks) {
                // 日常复习不含专业词卡组，避免生僻术语污染队列
                deckTree = excludeTechnicalDecks(this.osrCore.reviewableDeckTree);
                remainingDeckTree = excludeTechnicalDecks(
                    this.reviewMode === FlashcardReviewMode.Cram
                        ? this.osrCore.reviewableDeckTree
                        : this.osrCore.remainingDeckTree,
                );
            } else {
                deckTree = this.osrCore.reviewableDeckTree;
                remainingDeckTree =
                    this.reviewMode === FlashcardReviewMode.Cram
                        ? this.osrCore.reviewableDeckTree
                        : this.osrCore.remainingDeckTree;
            }
        }

        const reviewSequencerData = this.getPreparedReviewSequencer(
            deckTree,
            remainingDeckTree,
            this.reviewMode,
        );

        return reviewSequencerData.reviewSequencer;
    }

    public getPreparedReviewSequencer(
        fullDeckTree: Deck,
        remainingDeckTree: Deck,
        reviewMode: FlashcardReviewMode,
    ): { reviewSequencer: IFlashcardReviewSequencer; mode: FlashcardReviewMode } {
        const deckIterator: IDeckTreeIterator = this.createDeckTreeIterator(
            this.plugin.dataManager.data.settings,
        );

        const reviewSequencer: IFlashcardReviewSequencer = new FlashcardReviewSequencer(
            reviewMode,
            deckIterator,
            this.plugin.dataManager.data.settings,
            SRAlgorithm.getInstance(),
            this.plugin.dataManager.osrCore.questionPostponementList,
            this.plugin.dataManager.osrCore.dueDateFlashcardHistogram,
        );

        reviewSequencer.setDeckTree(fullDeckTree, remainingDeckTree);
        return { reviewSequencer, mode: reviewMode };
    }

    /** 把多篇笔记的卡片合成一个队列（用于按「组」复习） */
    public async getPreparedDecksForNotes(
        files: TFile[],
        mode: FlashcardReviewMode,
    ): Promise<{ deckTree: Deck; remainingDeckTree: Deck; mode: FlashcardReviewMode }> {
        const deckTree = new Deck("root", null);

        for (const file of files) {
            const note: Note | null = await this.plugin.dataManager.loadNote(file);
            if (note) note.appendCardsToDeck(deckTree);
        }

        const remainingDeckTree = DeckTreeFilter.filterForRemainingRepItems(
            this.plugin.dataManager.osrCore.questionPostponementList,
            deckTree,
            mode,
        );

        return { deckTree, remainingDeckTree, mode };
    }

    public async getPreparedDecksForSingleNoteReview(
        file: TFile,
        mode: FlashcardReviewMode,
    ): Promise<{ deckTree: Deck; remainingDeckTree: Deck; mode: FlashcardReviewMode }> {
        const note: Note | null = await this.plugin.dataManager.loadNote(file);

        const deckTree = new Deck("root", null);
        if (note) {
            note.appendCardsToDeck(deckTree);
        }
        const remainingDeckTree = DeckTreeFilter.filterForRemainingRepItems(
            this.plugin.dataManager.osrCore.questionPostponementList,
            deckTree,
            mode,
        );

        return { deckTree, remainingDeckTree, mode };
    }

    private createDeckTreeIterator(settings: SRSettings): IDeckTreeIterator {
        let cardOrder: RepItemOrder =
            RepItemOrder[settings.flashcardCardOrder as keyof typeof RepItemOrder];
        if (cardOrder === undefined) cardOrder = RepItemOrder.DueFirstSequential;
        let deckOrder: DeckOrder = DeckOrder[settings.flashcardDeckOrder as keyof typeof DeckOrder];
        if (deckOrder === undefined) deckOrder = DeckOrder.PrevDeckComplete_Sequential;

        const iteratorOrder: IIteratorOrder = {
            deckOrder,
            repItemOrder: cardOrder,
        };
        return new DeckTreeIterator(iteratorOrder, null);
    }
}
