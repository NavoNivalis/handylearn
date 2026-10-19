import { Menu } from "obsidian";

import type HandyLearnPlugin from "src/main";
import { CreateVocabCardModal } from "src/ui/modals/create-vocab-card-modal";

const WORD_CHAR = /[A-Za-z'’-]/;
const WORD_FULL = /^[A-Za-z][A-Za-z'’-]*$/;

/** 取词时可以跨过的行内元素（BioRead 等会把单词前半部分包进 <b>/<span>）。 */
const INLINE_TAGS = new Set([
    "B",
    "STRONG",
    "EM",
    "I",
    "SPAN",
    "A",
    "MARK",
    "U",
    "S",
    "DEL",
    "INS",
    "SUB",
    "SUP",
    "SMALL",
    "CODE",
    "FONT",
]);

function isInline(node: Node): boolean {
    return node.nodeType === Node.ELEMENT_NODE && INLINE_TAGS.has((node as Element).tagName);
}

/** 节点内第一个文本节点；遇到块级元素返回 null。 */
function firstTextNode(node: Node): Text | null {
    if (node.nodeType === Node.TEXT_NODE) {
        return (node as Text).data.length > 0 ? (node as Text) : null;
    }
    if (!isInline(node)) return null;
    for (const child of Array.from(node.childNodes)) {
        const found = firstTextNode(child);
        if (found !== null) return found;
    }
    return null;
}

/** 节点内最后一个文本节点；遇到块级元素返回 null。 */
function lastTextNode(node: Node): Text | null {
    if (node.nodeType === Node.TEXT_NODE) {
        return (node as Text).data.length > 0 ? (node as Text) : null;
    }
    if (!isInline(node)) return null;
    const children = Array.from(node.childNodes);
    for (let i = children.length - 1; i >= 0; i--) {
        const found = lastTextNode(children[i]);
        if (found !== null) return found;
    }
    return null;
}

/** 同一行内上下文里的上一个文本节点（不跨块级元素）。 */
function previousTextNode(node: Text): Text | null {
    let current: Node = node;
    while (true) {
        let sibling = current.previousSibling;
        while (sibling !== null) {
            const found = lastTextNode(sibling);
            if (found !== null) return found;
            if (sibling.nodeType === Node.ELEMENT_NODE && !isInline(sibling)) return null;
            sibling = sibling.previousSibling;
        }
        const parent = current.parentNode;
        if (parent === null) return null;
        if (parent.nodeType === Node.ELEMENT_NODE && !isInline(parent)) return null;
        current = parent;
    }
}

/** 同一行内上下文里的下一个文本节点（不跨块级元素）。 */
function nextTextNode(node: Text): Text | null {
    let current: Node = node;
    while (true) {
        let sibling = current.nextSibling;
        while (sibling !== null) {
            const found = firstTextNode(sibling);
            if (found !== null) return found;
            if (sibling.nodeType === Node.ELEMENT_NODE && !isInline(sibling)) return null;
            sibling = sibling.nextSibling;
        }
        const parent = current.parentNode;
        if (parent === null) return null;
        if (parent.nodeType === Node.ELEMENT_NODE && !isInline(parent)) return null;
        current = parent;
    }
}

/**
 * 阅读模式：右键一个英文单词即可自动选中并建卡，免去手动划选。
 * 只在 reading view（Markdown post processor）生效；live preview 的编辑部分不在此列。
 */
export class WordContextMenu {
    constructor(private plugin: HandyLearnPlugin) {}

    register(): void {
        this.plugin.registerMarkdownPostProcessor((el, ctx) => {
            if (el.hasClass("hl-word-menu-bound")) return;
            el.addClass("hl-word-menu-bound");
            el.addEventListener("contextmenu", (event) => this.handleContextMenu(event, ctx.sourcePath));
        });
    }

    private handleContextMenu(event: MouseEvent, sourcePath: string): void {
        const word = this.wordAtPoint(event.clientX, event.clientY);
        if (word === null) return;

        event.preventDefault();
        event.stopPropagation();

        // 视觉上选中这个词
        const selection = window.getSelection();
        if (selection !== null) {
            selection.removeAllRanges();
            selection.addRange(word.range);
        }

        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle(`建词卡：${word.text}`)
                .setIcon("book-plus")
                .onClick(() => {
                    new CreateVocabCardModal(
                        this.plugin.app,
                        this.plugin,
                        word.text,
                        this.sourceFromPath(sourcePath),
                    ).open();
                }),
        );
        menu.showAtMouseEvent(event);
    }

    /** 从笔记路径生成 [[笔记名]] 出处；拿不到就返回 null。 */
    private sourceFromPath(sourcePath: string): string | null {
        const name = sourcePath.split("/").pop()?.replace(/\.md$/i, "");
        return name ? `[[${name}]]` : null;
    }

    private wordAtPoint(x: number, y: number): { text: string; range: Range } | null {
        const caret = document.caretRangeFromPoint(x, y);
        if (caret === null) return null;

        const node = caret.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return null;
        const textNode = node as Text;

        const content = textNode.data;
        let start = caret.startOffset;
        let end = caret.endOffset;

        while (start > 0 && WORD_CHAR.test(content[start - 1])) start--;
        while (end < content.length && WORD_CHAR.test(content[end])) end++;

        let firstNode = textNode;
        let firstOffset = start;
        let lastNode = textNode;
        let lastOffset = end;
        let word = content.slice(start, end);

        // BioRead 等会把单词拆成多个行内节点（如 <b>emer</b>ge），这里跨节点拼回整词
        while (firstOffset === 0) {
            const prev = previousTextNode(firstNode);
            if (prev === null) break;
            const prevText = prev.data;
            let prevStart = prevText.length;
            while (prevStart > 0 && WORD_CHAR.test(prevText[prevStart - 1])) prevStart--;
            if (prevStart === prevText.length) break;
            word = prevText.slice(prevStart) + word;
            firstNode = prev;
            firstOffset = prevStart;
        }

        while (lastOffset === lastNode.data.length) {
            const next = nextTextNode(lastNode);
            if (next === null) break;
            const nextText = next.data;
            let nextEnd = 0;
            while (nextEnd < nextText.length && WORD_CHAR.test(nextText[nextEnd])) nextEnd++;
            if (nextEnd === 0) break;
            word += nextText.slice(0, nextEnd);
            lastNode = next;
            lastOffset = nextEnd;
        }

        if (!WORD_FULL.test(word)) return null;

        const wordRange = document.createRange();
        wordRange.setStart(firstNode, firstOffset);
        wordRange.setEnd(lastNode, lastOffset);
        return { text: word, range: wordRange };
    }
}
