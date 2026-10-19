import {
    CardField,
    FieldTemplate,
    FIELD_EXAM,
    FIELD_EXAMPLE,
    FIELD_FORMS,
    FIELD_FREQUENCY,
    FIELD_GLOSS,
    FIELD_IPA,
    FIELD_SOURCE,
    FIELD_TRANSLATION,
} from "src/engine/card";
import { renderFields } from "src/engine/parser";
import { DEFAULT_FIELD_TEMPLATES } from "src/settings";
import { DictEntry } from "src/dictionary/ecdict";
import { GeneratedExample } from "src/dictionary/vocab-ai";

/** 支持的考试标签，按 UI 展示顺序。 */
export const EXAM_TAGS: { value: string; label: string }[] = [
    { value: "cet4", label: "四级" },
    { value: "cet6", label: "六级" },
    { value: "ky", label: "考研" },
    { value: "toefl", label: "托福" },
    { value: "ielts", label: "雅思" },
    { value: "gre", label: "GRE" },
    { value: "gk", label: "高考" },
    { value: "zk", label: "中考" },
];

/** 没有考试标签、词频也低于这个名次的词，视为专业术语。 */
export const TECHNICAL_FRQ_THRESHOLD = 20000;

export const GENERAL_FLASHCARD_TAG = "#flashcards";
export const TECHNICAL_FLASHCARD_TAG = "#flashcards/technical";

/** 卡片正文里「出处」那一行的前缀。 */
export const SOURCE_LINE_PREFIX = "**出处：** ";

export type WordClass = "general" | "technical";

/** 通用词还是专业术语：有考试标签或词频前 20000 名算通用词，否则算专业术语。 */
export function classifyWord(entry: DictEntry): WordClass {
    if ((entry.tag ?? "").trim().length > 0) return "general";

    const ranks = [entry.frq, entry.bnc]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (ranks.length === 0) return "technical";

    return Math.min(...ranks) <= TECHNICAL_FRQ_THRESHOLD ? "general" : "technical";
}

const TAG_LABELS: Record<string, string> = Object.fromEntries(
    EXAM_TAGS.map((item) => [item.value, item.label]),
);

const EXCHANGE_LABELS: Record<string, string> = {
    p: "过去式",
    d: "过去分词",
    i: "现在分词",
    "3": "三单",
    r: "比较级",
    t: "最高级",
    s: "复数",
};

/** "d:perceived/p:perceived/3:perceives" -> "过去式 perceived；三单 perceives" */
export function formatExchange(exchange: string | undefined): string {
    if (!exchange) return "";
    return exchange
        .split("/")
        .map((item) => {
            const [type, word] = item.split(":");
            const label = EXCHANGE_LABELS[type];
            return label && word ? `${label} ${word}` : null;
        })
        .filter(Boolean)
        .join("；");
}

export function formatTags(tag: string | undefined): string {
    if (!tag) return "";
    return tag
        .split(/\s+/)
        .filter(Boolean)
        .map((item) => TAG_LABELS[item] ?? item)
        .join(" · ");
}

/** 释义按行拆分并去掉空行。 */
export function translationLines(entry: DictEntry): string[] {
    return (entry.t ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

/** 第一行中文释义，供列表紧凑展示。 */
export function firstGloss(entry: DictEntry): string {
    return translationLines(entry)[0] ?? "";
}

/** 从词卡笔记正文解析 AI 例句与翻译；没有例句返回 null。 */
export function parseExample(noteContent: string): { sentence: string; translation: string } | null {
    const sentence = /^\*\*例句：\*\* (.+)$/m.exec(noteContent)?.[1] ?? null;
    if (sentence === null) return null;

    const translation = /^\*\*翻译：\*\* (.+)$/m.exec(noteContent)?.[1] ?? "";
    return { sentence, translation };
}

/**
 * 一个内置字段对应的内容。自定义字段没有自动内容，返回空串。
 */
function fieldValue(
    label: string,
    entry: DictEntry,
    example: GeneratedExample | null,
    source: string | null,
): string {
    switch (label) {
        case FIELD_GLOSS:
            return translationLines(entry).join("\n");
        case FIELD_IPA:
            return entry.ipa ?? "";
        case FIELD_EXAMPLE:
            return example?.sentence ?? "";
        case FIELD_TRANSLATION:
            return example?.translation ?? "";
        case FIELD_FORMS:
            return formatExchange(entry.ex);
        case FIELD_EXAM:
            return formatTags(entry.tag);
        case FIELD_FREQUENCY: {
            const parts: string[] = [];
            if (entry.frq) parts.push(`当代 ${entry.frq}`);
            if (entry.bnc) parts.push(`BNC ${entry.bnc}`);
            return parts.join(" / ");
        }
        case FIELD_SOURCE:
            return source ?? "";
        default:
            return "";
    }
}

/**
 * 生成一个单词的词卡笔记 markdown。
 *
 * 格式：frontmatter（word/class/source） + #flashcards + 正面字段 + `??` + 背面字段。
 * 字段顺序与所属面由模板决定；模板里的自定义字段会留空，等用户填写。
 * 注意：多行字段的续行之间不能有空行，否则解析会提前结束。
 */
export function buildVocabNote(
    word: string,
    entry: DictEntry,
    example?: GeneratedExample | null,
    source?: string | null,
    templates: FieldTemplate[] = DEFAULT_FIELD_TEMPLATES,
): string {
    const fields: CardField[] = [
        { label: "", value: word, side: "front" },
        ...templates.map((template) => ({
            label: template.label,
            value: fieldValue(template.label, entry, example ?? null, source ?? null),
            side: template.side,
        })),
    ];

    const front = renderFields(fields.filter((field) => field.side === "front"));
    const back = renderFields(fields.filter((field) => field.side === "back"));

    const wordClass = classifyWord(entry);
    const flashcardTag =
        wordClass === "technical" ? TECHNICAL_FLASHCARD_TAG : GENERAL_FLASHCARD_TAG;

    const frontmatter = [
        "---",
        `word: ${word}`,
        entry.ipa ? `phonetic: ${entry.ipa}` : null,
        `class: ${wordClass}`,
        source ? `source:\n  - "${source}"` : null,
        "tags: [vocabulary]",
        "---",
    ]
        .filter(Boolean)
        .join("\n");

    return `${frontmatter}\n\n${flashcardTag}\n\n${front}\n??\n${back}\n`;
}
