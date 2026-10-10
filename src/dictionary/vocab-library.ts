import { App, normalizePath, TFile } from "obsidian";

import { DictEntry, Ecdict } from "src/dictionary/ecdict";

/** 词库里的一条记录：词卡目录下的一个单词。 */
export interface VocabRecord {
    word: string;
    entry: DictEntry | null;
    file: TFile;
    /** 文件修改时间，供「按添加时间」排序。 */
    modifiedMs: number;
}

/** 收集词卡目录下所有已建卡的单词，单词优先取 frontmatter 的 word，否则用文件名。 */
export function collectVocabRecords(app: App, folder: string, dict: Ecdict): VocabRecord[] {
    const target = normalizePath(folder);
    const records: VocabRecord[] = [];

    for (const file of app.vault.getMarkdownFiles()) {
        if (file.parent?.path !== target) continue;

        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        const word =
            typeof frontmatter?.word === "string" ? frontmatter.word : file.basename;

        records.push({
            word,
            entry: dict.query(word),
            file,
            modifiedMs: file.stat.mtime,
        });
    }

    return records;
}
