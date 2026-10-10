import { App, TFile } from "obsidian";

import { CardSchedule, ReviewCard } from "src/engine/card";
import { NEW_CARD_DUE, parseSchedules, parseVocabNote, updateNoteSchedules } from "src/engine/parser";
import { ReviewRating, schedule } from "src/engine/scheduler";

/** Fisher-Yates 洗牌，返回新数组。 */
function shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export interface ScanResult {
    /** 词卡笔记篇数。 */
    totalNotes: number;
    /** 卡片总数（每篇笔记两张）。 */
    totalCards: number;
    /** 到期卡片数（含新卡）。 */
    dueCards: number;
    /** 到期通用词卡数。 */
    dueGeneral: number;
    /** 到期专业词卡数。 */
    dueTechnical: number;
    /** 全部卡片（供后续阶段复习使用）。 */
    cards: ReviewCard[];
}

export class VocabStore {
    constructor(private app: App) {}

    private today(): string {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    /** YYYY-MM-DD 字符串可直接按字典序比较，即等于按日期先后比较。 */
    private isDue(schedule: CardSchedule, today: string): boolean {
        return schedule.due <= today;
    }

    async scan(folder: string): Promise<ScanResult> {
        const today = this.today();
        const files = this.app.vault
            .getMarkdownFiles()
            .filter((file) => file.path.startsWith(`${folder}/`));

        const cards: ReviewCard[] = [];
        for (const file of files) {
            const text = await this.app.vault.read(file);
            cards.push(...parseVocabNote(text, file.path));
        }

        const dueCards = cards.filter((card) => this.isDue(card.schedule, today));
        const dueGeneral = dueCards.filter((card) => card.wordClass === "general").length;
        const dueTechnical = dueCards.filter((card) => card.wordClass === "technical").length;

        return {
            totalNotes: files.length,
            totalCards: cards.length,
            dueCards: dueCards.length,
            dueGeneral,
            dueTechnical,
            cards,
        };
    }

    /** 今天的复习队列：到期的通用词卡，随机打乱避免同词认词+拼写连出。 */
    async getDueCards(folder: string): Promise<ReviewCard[]> {
        const today = this.today();
        const result = await this.scan(folder);
        const due = result.cards.filter(
            (card) => card.wordClass === "general" && this.isDue(card.schedule, today),
        );
        return shuffle(due);
    }

    /** 复习一张卡后，更新其调度并写回笔记。 */
    async applyReview(card: ReviewCard, rating: ReviewRating): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(card.notePath);
        if (!(file instanceof TFile)) return;

        const text = await this.app.vault.read(file);

        const schedules = parseSchedules(text);
        const recognition = schedules[0] ?? { due: NEW_CARD_DUE, interval: 1, ease: 250 };
        const spelling = schedules[1] ?? { due: NEW_CARD_DUE, interval: 1, ease: 250 };

        const index = card.kind === "recognition" ? 0 : 1;
        const current = index === 0 ? recognition : spelling;
        const next = schedule(rating, current, this.today());

        const newSchedules: CardSchedule[] = index === 0 ? [next, spelling] : [recognition, next];
        await this.app.vault.modify(file, updateNoteSchedules(text, newSchedules));
    }
}
