import { FieldSide, FieldTemplate, LOCKED_FIELD_LABELS } from "src/engine/card";
import { normalizeFieldTemplates } from "src/settings";

/**
 * 渲染默认字段模板编辑器。
 * 任何改动都会归一化后通过 onChange 回传，由调用方保存并重绘。
 */
export function renderTemplateEditor(
    container: HTMLElement,
    templates: FieldTemplate[],
    onChange: (next: FieldTemplate[]) => void,
): void {
    container.empty();

    templates.forEach((template, index) => {
        const locked = LOCKED_FIELD_LABELS.includes(template.label);
        const row = container.createDiv({ cls: "hl-field-row" });

        if (locked) {
            row.createSpan({ cls: "hl-field-label", text: template.label });
        } else {
            const input = row.createEl("input", { cls: "hl-field-label", type: "text" });
            input.value = template.label;
            input.addEventListener("change", () => {
                const value = input.value.trim();
                const duplicate = templates.some(
                    (item, itemIndex) => itemIndex !== index && item.label === value,
                );
                if (value === "" || duplicate) {
                    input.value = template.label;
                    return;
                }
                const next = templates.map((item) => ({ ...item }));
                next[index].label = value;
                onChange(normalizeFieldTemplates(next));
            });
        }

        const side = row.createEl("select", { cls: "hl-field-side" });
        side.createEl("option", { value: "front", text: "正面" });
        side.createEl("option", { value: "back", text: "背面" });
        side.value = template.side;
        side.disabled = locked;
        side.addEventListener("change", () => {
            const next = templates.map((item) => ({ ...item }));
            next[index].side = side.value as FieldSide;
            onChange(normalizeFieldTemplates(next));
        });

        const actions = row.createDiv({ cls: "hl-field-actions" });

        const up = actions.createEl("button", { text: "↑" });
        up.disabled = index === 0;
        up.addEventListener("click", () => {
            const next = templates.map((item) => ({ ...item }));
            [next[index - 1], next[index]] = [next[index], next[index - 1]];
            onChange(normalizeFieldTemplates(next));
        });

        const down = actions.createEl("button", { text: "↓" });
        down.disabled = index === templates.length - 1;
        down.addEventListener("click", () => {
            const next = templates.map((item) => ({ ...item }));
            [next[index], next[index + 1]] = [next[index + 1], next[index]];
            onChange(normalizeFieldTemplates(next));
        });

        if (!locked) {
            const remove = actions.createEl("button", { text: "✕" });
            remove.addEventListener("click", () => {
                const next = templates.filter((_, itemIndex) => itemIndex !== index);
                onChange(normalizeFieldTemplates(next));
            });
        }
    });

    const add = container.createEl("button", { text: "+ 添加字段" });
    add.addEventListener("click", () => {
        onChange(
            normalizeFieldTemplates([...templates, { label: "新字段", side: "back" }]),
        );
    });
}
