import { App, normalizePath, parseYaml, stringifyYaml } from "obsidian";

import { DictEntry } from "src/dictionary/ecdict";
import { GeneratedExample } from "src/dictionary/vocab-ai";
import { buildVocabNote, SOURCE_LINE_PREFIX } from "src/dictionary/vocab-card";

/** 某个单词词卡笔记的路径。 */
export function vocabNotePath(folder: string, word: string): string {
    return normalizePath(`${folder}/${word.toLowerCase()}.md`);
}

export async function vocabNoteExists(app: App, folder: string, word: string): Promise<boolean> {
    return app.vault.adapter.exists(vocabNotePath(folder, word));
}

export async function ensureVocabFolder(app: App, folder: string): Promise<void> {
    const path = normalizePath(folder);
    if (!(await app.vault.adapter.exists(path))) {
        await app.vault.createFolder(path);
    }
}

function readSources(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    if (typeof value === "string" && value.length > 0) return [value];
    return [];
}

/**
 * 把新出处追加到已有词卡上（frontmatter 的 source 数组 + 正文「出处」行）。
 * 记过同一个出处就什么都不做。返回是否发生改动。
 */
async function appendSource(app: App, folder: string, word: string, source: string): Promise<boolean> {
    const path = vocabNotePath(folder, word);
    const file = app.vault.getFileByPath(path);
    if (file === null) return false;

    const text = await app.vault.read(file);

    const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (frontmatterMatch === null) return false;

    const parsed = parseYaml(frontmatterMatch[1]) as Record<string, unknown> | null;
    if (parsed === null || typeof parsed !== "object") return false;

    const sources = readSources(parsed.source);
    if (sources.includes(source)) return false;

    sources.push(source);
    parsed.source = sources;

    let updated = text.replace(
        frontmatterMatch[0],
        `---\n${stringifyYaml(parsed).trimEnd()}\n---`,
    );

    const sourceLine = `${SOURCE_LINE_PREFIX}${sources.join(" ")}`;
    updated = updated.includes(SOURCE_LINE_PREFIX)
        ? updated.replace(new RegExp(`^${SOURCE_LINE_PREFIX}.*$`, "m"), sourceLine)
        : `${updated.trimEnd()}\n${sourceLine}\n`;

    await app.vault.modify(file, updated);
    return true;
}

/**
 * 写一个单词的词卡笔记。
 * 已存在则追加出处（无出处则返回 false）；不存在则新建。
 */
export async function createVocabNote(
    app: App,
    folder: string,
    word: string,
    entry: DictEntry,
    example?: GeneratedExample | null,
    source?: string | null,
): Promise<boolean> {
    if (await vocabNoteExists(app, folder, word)) {
        if (!source) return false;
        return appendSource(app, folder, word, source);
    }

    await ensureVocabFolder(app, folder);
    await app.vault.create(
        vocabNotePath(folder, word),
        buildVocabNote(word, entry, example, source),
    );
    return true;
}
