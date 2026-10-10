/** 一张复习卡片的调度数据（SM2 格式）。 */
export interface CardSchedule {
    /** 到期日，格式 YYYY-MM-DD。"2000-01-01" 表示从未复习过（新卡，永远到期）。 */
    due: string;
    /** 间隔天数。 */
    interval: number;
    /** 难度系数（ease factor）乘以 100，默认 250（即 2.5）。 */
    ease: number;
}

/** 卡片类型：认词（英→中）/ 拼写（中→英）。 */
export type CardKind = "recognition" | "spelling";

/** 词类：通用词 / 专业术语。 */
export type WordClass = "general" | "technical";

/** 一张可复习的卡片。每篇词卡笔记用 `??` 会拆出两张（认词 + 拼写）。 */
export interface ReviewCard {
    word: string;
    kind: CardKind;
    wordClass: WordClass;
    /** 正面（认词=单词，拼写=中文释义）。 */
    front: string;
    /** 背面（认词=释义，拼写=单词）。 */
    back: string;
    schedule: CardSchedule;
    /** 来源笔记路径，复习写回时用。 */
    notePath: string;
}
