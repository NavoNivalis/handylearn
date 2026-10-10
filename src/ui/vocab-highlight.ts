import { normalizePath, TFile } from "obsidian";

import type HandyLearnPlugin from "src/main";

const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]*/g;

/** 这些容器里的文字不参与高亮。 */
const SKIP_SELECTOR = "code, pre, a, .hl-known-word";

/** 单次渲染处理的文本节点上限，避免超长文档卡顿。 */
const MAX_TEXT_NODES = 2000;

/**
 * 阅读模式里高亮已经建过卡的单词，点击在侧栏打开单词卡。
 * 只在 reading view（Markdown post processor）生效。
 */
export class VocabHighlighter {
    private knownWords = new Set<string>();
    private needsReload = true;

    constructor(private plugin: HandyLearnPlugin) {}

    register(): void {
        this.plugin.registerMarkdownPostProcessor((el, ctx) => {
            if (this.plugin.settings.highlightEnabled) {
                this.process(el, ctx.sourcePath);
            }
        });

        const invalidate = (file: unknown): void => {
            if (!(file instanceof TFile)) return;
            if (file.extension !== "md") return;
            if (file.parent?.path !== this.folder()) return;
            this.needsReload = true;
        };

        this.plugin.registerEvent(this.plugin.app.vault.on("create", invalidate));
        this.plugin.registerEvent(this.plugin.app.vault.on("delete", invalidate));
        this.plugin.registerEvent(this.plugin.app.vault.on("rename", invalidate));
    }

    private folder(): string {
        return normalizePath(this.plugin.settings.vocabOutputFolder);
    }

    private ensureLoaded(): void {
        if (!this.needsReload) return;
        this.needsReload = false;
        this.knownWords.clear();

        const folder = this.folder();
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            if (file.parent?.path !== folder) continue;
            this.knownWords.add(file.basename.toLowerCase());
        }
    }

    private process(el: HTMLElement, sourcePath: string): void {
        // 词卡笔记自己不高亮
        if (sourcePath.startsWith(`${this.folder()}/`)) return;

        this.ensureLoaded();
        if (this.knownWords.size === 0) return;

        const textNodes: Text[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node !== null) {
            const parent = (node as Text).parentElement;
            if (parent !== null && parent.closest(SKIP_SELECTOR) === null) {
                textNodes.push(node as Text);
            }
            node = walker.nextNode();
        }

        if (textNodes.length > MAX_TEXT_NODES) return;

        for (const textNode of textNodes) this.markTextNode(textNode);

        if (!el.hasClass("hl-highlight-bound")) {
            el.addClass("hl-highlight-bound");
            el.addEventListener("click", (event) => this.handleClick(event));
        }
    }

    private markTextNode(node: Text): void {
        const text = node.nodeValue ?? "";
        if (text.length === 0) return;

        WORD_PATTERN.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let matched = false;
        let match: RegExpExecArray | null;

        while ((match = WORD_PATTERN.exec(text)) !== null) {
            if (!this.knownWords.has(match[0].toLowerCase())) continue;

            matched = true;
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
            }

            const span = document.createElement("span");
            span.className = "hl-known-word";
            span.textContent = match[0];
            fragment.appendChild(span);

            lastIndex = match.index + match[0].length;
        }

        if (!matched) return;
        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        node.parentNode?.replaceChild(fragment, node);
    }

    private handleClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (target === null || !target.hasClass("hl-known-word")) return;

        event.preventDefault();
        const word = target.textContent ?? "";
        if (word.length > 0) {
            void this.plugin.openWordCard(word);
        }
    }
}
