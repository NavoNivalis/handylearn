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
 * 生成一个单词的词卡笔记 markdown。
 *
 * 格式：frontmatter（word/class/source） + #flashcards + {单词} ?? {释义+例句+音标+词形+考试+词频+出处}。
 * 注意：多行卡片的背面行之间不能有空行，否则解析会提前结束。
 */
export function buildVocabNote(
    word: string,
    entry: DictEntry,
    example?: GeneratedExample | null,
    source?: string | null,
): string {
    const translation = (entry.t ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");

    const backLines: string[] = [translation];

    if (example?.sentence) {
        backLines.push(`**例句：** ${example.sentence}`);
        if (example.translation) backLines.push(`**翻译：** ${example.translation}`);
    }

    if (entry.ipa) backLines.push(`**音标：** ${entry.ipa}`);

    const exchange = formatExchange(entry.ex);
    if (exchange) backLines.push(`**词形：** ${exchange}`);

    const tags = formatTags(entry.tag);
    if (tags) backLines.push(`**考试：** ${tags}`);

    const frqParts: string[] = [];
    if (entry.frq) frqParts.push(`当代 ${entry.frq}`);
    if (entry.bnc) frqParts.push(`BNC ${entry.bnc}`);
    if (frqParts.length > 0) backLines.push(`**词频：** ${frqParts.join(" / ")}`);

    if (source) backLines.push(SOURCE_LINE_PREFIX + source);

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

    return `${frontmatter}\n\n${flashcardTag}\n\n${word}\n??\n${backLines.join("\n")}\n`;
}
