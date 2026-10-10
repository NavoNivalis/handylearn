import { CardSchedule } from "src/engine/card";

/** 复习评分四档。 */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** 难度系数（ease）下限，即 1.3。 */
const EASE_MIN = 130;

/** YYYY-MM-DD 加上若干天，返回 YYYY-MM-DD。 */
export function addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

/**
 * SM2 调度：根据评分和当前调度，算出下一轮调度。
 *
 * | 档位 | 新间隔 | 新难度 |
 * |------|--------|--------|
 * | 忘记 | 1      | -20（≥130） |
 * | 较难 | round(间隔×1.2) | -15（≥130） |
 * | 记得 | round(间隔×难度) | 不变 |
 * | 简单 | round(间隔×难度×1.3) | +15 |
 */
export function schedule(rating: ReviewRating, current: CardSchedule, today: string): CardSchedule {
    const factor = current.ease / 100;
    let interval: number;
    let ease: number;

    switch (rating) {
        case "again":
            interval = 1;
            ease = Math.max(EASE_MIN, current.ease - 20);
            break;
        case "hard":
            interval = Math.max(1, Math.round(current.interval * 1.2));
            ease = Math.max(EASE_MIN, current.ease - 15);
            break;
        case "good":
            interval = Math.max(1, Math.round(current.interval * factor));
            ease = current.ease;
            break;
        case "easy":
            interval = Math.max(1, Math.round(current.interval * factor * 1.3));
            ease = current.ease + 15;
            break;
    }

    return { due: addDays(today, interval), interval, ease };
}
