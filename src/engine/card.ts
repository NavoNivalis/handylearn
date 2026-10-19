/** 认词卡间隔达到这个天数，视为「已记熟」，阅读模式不再高亮。 */
export const MATURE_INTERVAL_DAYS = 21;

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

/** 字段属于正面还是背面。 */
export type FieldSide = "front" | "back";

/** 词卡里的一个字段。 */
export interface CardField {
    /** 字段名，如 释义 / 音标 / 例句；正面裸文本为空串。 */
    label: string;
    /** 字段内容，可多行。 */
    value: string;
    side: FieldSide;
}

/** 字段模板：新建词卡时按这个顺序和所属面生成字段。 */
export interface FieldTemplate {
    label: string;
    side: FieldSide;
}

/** 内置字段名。 */
export const FIELD_GLOSS = "释义";
export const FIELD_IPA = "音标";
export const FIELD_EXAMPLE = "例句";
export const FIELD_TRANSLATION = "翻译";
export const FIELD_FORMS = "词形";
export const FIELD_EXAM = "考试";
export const FIELD_FREQUENCY = "词频";
export const FIELD_SOURCE = "出处";

/** 锁定字段：名字不可改、不能删（拼写卡依赖它们出题）。 */
export const LOCKED_FIELD_LABELS: string[] = [FIELD_GLOSS, FIELD_IPA];

/** 一张可复习的卡片。每篇词卡笔记用 `??` 会拆出两张（认词 + 拼写）。 */
export interface ReviewCard {
    word: string;
    kind: CardKind;
    wordClass: WordClass;
    /** 正面（认词=单词，拼写=中文释义）。 */
    front: string;
    /** 背面（认词=释义，拼写=单词）。 */
    back: string;
    /** 结构化的全部字段（认词、拼写两张卡共用）。 */
    fields: CardField[];
    schedule: CardSchedule;
    /** 来源笔记路径，复习写回时用。 */
    notePath: string;
}
