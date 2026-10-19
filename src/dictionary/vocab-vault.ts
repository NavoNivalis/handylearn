import { App, normalizePath, parseYaml, stringifyYaml, TFile } from "obsidian";

import { CardField, FieldTemplate, FIELD_SOURCE } from "src/engine/card";
import { parseVocabNote, renderFields } from "src/engine/parser";
import { DictEntry } from "src/dictionary/ecdict";
import { GeneratedExample } from "src/dictionary/vocab-ai";
import { buildVocabNote } from "src/dictionary/vocab-card";

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
 * 用字段重建整篇词卡笔记，保留 frontmatter、#flashcards 标签和 SR 调度注释。
 */
export function rebuildNote(text: string, fields: CardField[]): string {
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---/.exec(text)?.[0] ?? "";
    const tag = /^#flashcards[^\n]*$/m.exec(text)?.[0] ?? "#flashcards";
    const sr = /<!--SR:![\s\S]*?-->/.exec(text)?.[0] ?? "";

    const front = renderFields(fields.filter((field) => field.side === "front"));
    const back = renderFields(fields.filter((field) => field.side === "back"));

    const parts: string[] = [];
    if (frontmatter.length > 0) parts.push(frontmatter);
    parts.push(tag, `${front}\n??\n${back}`);

    return `${parts.join("\n\n")}\n${sr ? `\n${sr}\n` : ""}`;
}

/** 覆盖一篇词卡的字段（保留 frontmatter / 标签 / 调度）。 */
export async function updateNoteFields(
    app: App,
    file: TFile,
    fields: CardField[],
): Promise<void> {
    const text = await app.vault.read(file);
    await app.vault.modify(file, rebuildNote(text, fields));
}

/**
 * 把新出处追加到已有词卡上（frontmatter 的 source 数组 + 正文「出处」字段）。
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

    // 正文出处字段同步：有就更新，没有就补一个背面字段
    const fields = parseVocabNote(updated)[0]?.fields;
    if (fields !== undefined && fields.length > 0) {
        const joined = sources.join(" ");
        const existing = fields.find((field) => field.label === FIELD_SOURCE);
        if (existing !== undefined) existing.value = joined;
        else fields.push({ label: FIELD_SOURCE, value: joined, side: "back" });
        updated = rebuildNote(updated, fields);
    }

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
    templates?: FieldTemplate[],
    content?: string,
): Promise<boolean> {
    if (await vocabNoteExists(app, folder, word)) {
        if (!source) return false;
        return appendSource(app, folder, word, source);
    }

    await ensureVocabFolder(app, folder);
    await app.vault.create(
        vocabNotePath(folder, word),
        content ?? buildVocabNote(word, entry, example, source, templates),
    );
    return true;
}
