import { CardSchedule, ReviewCard, WordClass } from "src/engine/card";

/** 从未复习过的占位到期日。 */
export const NEW_CARD_DUE = "2000-01-01";

/** 匹配开头的一段 YAML frontmatter。 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** 匹配调度注释 <!--SR:!...-->。 */
const SR_COMMENT_RE = /<!--SR:!([\s\S]*?)-->/;

/** 把一段 "日期,间隔,难度" 解析成调度数据。 */
function parseScheduleEntry(entry: string): CardSchedule {
    const [due, interval, ease] = entry.split(",");
    return {
        due: due ?? NEW_CARD_DUE,
        interval: Number(interval ?? 1),
        ease: Number(ease ?? 250),
    };
}

/**
 * 解析 <!--SR:!...--> 注释，按 `!` 切出多段调度（`??` 会生成两张卡，故通常有两段）。
 * 没有注释时返回空数组（表示从未复习）。
 */
export function parseSchedules(text: string): CardSchedule[] {
    const match = SR_COMMENT_RE.exec(text);
    if (match === null) return [];
    return match[1]
        .split("!")
        .filter((entry) => entry.trim().length > 0)
        .map(parseScheduleEntry);
}

/** 把一段调度序列化成 "日期,间隔,难度"。 */
function serializeSchedule(schedule: CardSchedule): string {
    return `${schedule.due},${schedule.interval},${schedule.ease}`;
}

/** 把多段调度序列化成 <!--SR:!...--> 注释。 */
export function serializeSchedules(schedules: CardSchedule[]): string {
    return `<!--SR:!${schedules.map(serializeSchedule).join("!")}-->`;
}

/**
 * 用新的调度替换笔记里的 <!--SR:!...--> 注释；没有注释（新卡）就在末尾追加。
 */
export function updateNoteSchedules(text: string, schedules: CardSchedule[]): string {
    const comment = serializeSchedules(schedules);
    if (SR_COMMENT_RE.test(text)) {
        return text.replace(SR_COMMENT_RE, comment);
    }
    return text.replace(/\s*$/, "") + "\n" + comment + "\n";
}

/**
 * 从一篇词卡笔记的完整正文解析出复习卡片。
 *
 * 词卡笔记格式（由建卡逻辑生成）：
 *   frontmatter（word / class 等）
 *   #flashcards（或 #flashcards/technical）
 *   {单词}
 *   ??
 *   {释义、例句等}
 *   <!--SR:!...-->（可选，复习后才写入）
 */
export function parseVocabNote(text: string, notePath = ""): ReviewCard[] {
    const body = text.replace(FRONTMATTER_RE, "");

    const wordClass: WordClass = /^class:\s*technical\s*$/m.test(text) ? "technical" : "general";

    const schedules = parseSchedules(body);
    const recognition = schedules[0] ?? { due: NEW_CARD_DUE, interval: 1, ease: 250 };
    const spelling = schedules[1] ?? { due: NEW_CARD_DUE, interval: 1, ease: 250 };

    // 去掉调度注释和 #flashcards 标签行，剩下的按 `??` 切出正面/背面
    const cleanLines = body
        .replace(SR_COMMENT_RE, "")
        .split("\n")
        .filter((line) => !/^#flashcards/.test(line.trim()));

    const sepIndex = cleanLines.findIndex((line) => line.trim() === "??");
    if (sepIndex === -1) return [];

    const front = cleanLines.slice(0, sepIndex).join("\n").trim();
    const back = cleanLines.slice(sepIndex + 1).join("\n").trim();

    const wordMatch = /^word:\s*(.+)$/m.exec(text);
    const word = wordMatch?.[1]?.trim() || front;

    return [
        { word, kind: "recognition", wordClass, front, back, schedule: recognition, notePath },
        { word, kind: "spelling", wordClass, front: back, back: front, schedule: spelling, notePath },
    ];
}
