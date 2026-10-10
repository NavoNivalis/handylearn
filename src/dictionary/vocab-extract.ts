import { App } from "obsidian";

import { DictEntry, Ecdict } from "src/dictionary/ecdict";
import { TECHNICAL_FRQ_THRESHOLD } from "src/dictionary/vocab-card";

/** 词频排名比这个还高的词太基础，不算生词（the / work / time 之类）。 */
const TOO_COMMON_FRQ = 3000;

/** 按词频分组时「高频」的上限。 */
const HIGH_FRQ = 5000;

export type ExtractGroupId =
    | "zk"
    | "gk"
    | "cet4"
    | "cet6"
    | "ky"
    | "toefl"
    | "ielts"
    | "gre"
    | "high"
    | "mid"
    | "technical";

export type ExtractMode = "exam" | "frequency";

/** 考试分组，从基础到进阶。 */
export const EXAM_TAG_ORDER: ExtractGroupId[] = [
    "zk",
    "gk",
    "cet4",
    "cet6",
    "ky",
    "toefl",
    "ielts",
    "gre",
];

const EXAM_GROUP_ORDER: ExtractGroupId[] = [...EXAM_TAG_ORDER, "high", "technical"];
const FREQUENCY_GROUP_ORDER: ExtractGroupId[] = ["high", "mid", "technical"];

export function groupOrder(mode: ExtractMode): ExtractGroupId[] {
    return mode === "exam" ? EXAM_GROUP_ORDER : FREQUENCY_GROUP_ORDER;
}

export interface ExtractedWord {
    word: string;
    entry: DictEntry;
    /** 在正文里出现的次数。 */
    count: number;
    group: ExtractGroupId;
}

/** 取词频：当代语料库和 BNC 里更靠前的那个。 */
function frequencyRank(entry: DictEntry): number {
    const ranks = [entry.frq, entry.bnc]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
    return ranks.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...ranks);
}

/** 一个词该归到哪组；返回 null 表示不值得学（太基础）。 */
function groupOf(entry: DictEntry, mode: ExtractMode): ExtractGroupId | null {
    const rank = frequencyRank(entry);

    if (mode === "frequency") {
        if (rank <= TOO_COMMON_FRQ) return null;
        if (rank <= HIGH_FRQ) return "high";
        if (rank <= TECHNICAL_FRQ_THRESHOLD) return "mid";
        return "technical";
    }

    const tags = (entry.tag ?? "").split(/\s+/).filter(Boolean);
    const exam = EXAM_TAG_ORDER.find((id) => tags.includes(id));
    if (exam !== undefined) return exam;

    if (rank <= TOO_COMMON_FRQ) return null;
    if (rank <= TECHNICAL_FRQ_THRESHOLD) return "high";
    return "technical";
}

/** 切出英文单词并统计出现次数；frontmatter、代码块、行内代码、链接会被忽略。 */
function countWords(text: string): Map<string, number> {
    const cleaned = text
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/https?:\/\/\S+/g, " ");

    const counts = new Map<string, number>();
    for (const raw of cleaned.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []) {
        const word = raw.toLowerCase().replace(/^['’-]+|['’-]+$/g, "");
        if (word.length < 3) continue;
        counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return counts;
}

/** 变形词的原形（ECDICT 的 exchange 里 0: 表示原型）。 */
function lemmaOf(entry: DictEntry): string | null {
    const match = /(?:^|\/)0:([A-Za-z][A-Za-z'’-]*)/.exec(entry.ex ?? "");
    return match === null ? null : match[1].toLowerCase();
}

/** 把变形词并到原形上，出现次数累加，释义/音标用原形的。 */
function mergeToLemma(
    counts: Map<string, number>,
    dict: Ecdict,
): Map<string, { count: number; entry: DictEntry }> {
    const merged = new Map<string, { count: number; entry: DictEntry }>();

    for (const [rawWord, count] of counts) {
        const rawEntry = dict.query(rawWord);
        if (rawEntry === null) continue;

        let word = rawWord;
        let entry = rawEntry;

        const lemma = lemmaOf(rawEntry);
        if (lemma !== null && lemma !== rawWord) {
            const lemmaEntry = dict.query(lemma);
            if (lemmaEntry !== null) {
                word = lemma;
                entry = lemmaEntry;
            }
        }

        const existing = merged.get(word);
        if (existing === undefined) merged.set(word, { count, entry });
        else existing.count += count;
    }

    return merged;
}

/** 已有词卡的单词（目录里的 .md 文件名就是单词）。 */
export function existingVocabWords(app: App, folder: string): Set<string> {
    const target = folder.replace(/^\/+|\/+$/g, "");
    const words = new Set<string>();

    for (const file of app.vault.getMarkdownFiles()) {
        if (file.parent?.path !== target) continue;
        words.add(file.basename.toLowerCase());
    }
    return words;
}

/**
 * 从一段英文里抽出值得学的生词，纯本地计算。
 * 已经有词卡的词、以及用户自定义的简单词会被跳过。
 */
export function extractWords(
    text: string,
    dict: Ecdict,
    alreadyKnown: Set<string>,
    ignoreWords: Set<string>,
    mode: ExtractMode,
): ExtractedWord[] {
    const result: ExtractedWord[] = [];

    for (const [word, { count, entry }] of mergeToLemma(countWords(text), dict)) {
        if (alreadyKnown.has(word) || ignoreWords.has(word)) continue;

        const group = groupOf(entry, mode);
        if (group === null) continue;

        result.push({ word, entry, count, group });
    }

    return result.sort((a, b) => {
        const rankDiff = frequencyRank(a.entry) - frequencyRank(b.entry);
        return rankDiff === 0 ? b.count - a.count : rankDiff;
    });
}
