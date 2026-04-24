/** @jsxImportSource solid-js */
import { createMemo, splitProps, createEffect, on } from "solid-js";
import { registerComponent } from "@zynthjs/core";
import type { Style } from "@zynthjs/core";

export const TextInput = (props: any) => {
  const [local, rest] = splitProps(props, [
    "value",
    "defaultValue",
    "multiline",
    "placeholder",
    "editable",
    "maxLength",
    "secureTextEntry",
    "inputMode",
    "onChangeText",
    "onChange",
    "handler",
    "onFocus",
    "onBlur",
    "onKeyPress",
    "onSelectionChange",
    "onSubmitEditing",
    "style",
    "class",
  ]);

  let ref: HTMLInputElement | HTMLTextAreaElement | undefined;

  // Sync value from props to DOM
  createEffect(
    on(
      () => local.value,
      (val) => {
        if (ref && val !== undefined && ref.value !== val) {
          ref.value = val;
        }
      }
    )
  );

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    if (local.onChangeText) {
      local.onChangeText({ text: value });
    }

    if (local.onChange) {
      local.onChange({
        textAfter: value,
        composing: false,
        range: {
          start: target.selectionStart ?? 0,
          end: target.selectionEnd ?? 0,
        },
      });
    }
  };

  const handleBeforeInput = (e: InputEvent) => {
    if (typeof local.handler !== "function") return;
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target) return;

    const currentText = target.value ?? "";
    const incoming = typeof e.data === "string" ? e.data : "";
    const next = local.handler(currentText, incoming);
    if (typeof next !== "string" || next === currentText) {
      if (next === currentText) {
        e.preventDefault();
      }
      return;
    }

    e.preventDefault();
    target.value = next;
    const cursor = next.length;
    try {
      target.setSelectionRange(cursor, cursor);
    } catch {
      // ignore selection update failures on unsupported inputs
    }

    local.onChangeText?.({ text: next });
    local.onChange?.({
      textAfter: next,
      composing: false,
      range: {
        start: cursor,
        end: cursor,
      },
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (local.onKeyPress) {
      local.onKeyPress({
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
    }

    if (e.key === "Enter" && !local.multiline) {
      if (local.onSubmitEditing) {
        local.onSubmitEditing({ text: (e.target as HTMLInputElement).value });
      }
    }
  };

  const handleSelect = (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (local.onSelectionChange) {
      local.onSelectionChange({
        selection: {
          start: target.selectionStart ?? 0,
          end: target.selectionEnd ?? 0,
        },
      });
    }
  };

  const baseStyle = createMemo(() => {
    const s = local.style;
    const base: any = {
      border: "none",
      outline: "none",
      background: "transparent",
      padding: "0",
      margin: "0",
      width: "100%",
      height: "100%",
      "font-family": "inherit",
      "font-size": "inherit",
      color: "inherit",
      resize: "none",
      "box-sizing": "border-box",
    };

    if (Array.isArray(s)) {
      return Object.assign(base, ...s);
    }
    return Object.assign(base, s);
  });

  return (
    <div style="display: contents">
      {local.multiline ? (
        <textarea
          ref={ref as HTMLTextAreaElement}
          class={`zynth-text-input${local.class ? ` ${local.class}` : ""}`}
          placeholder={local.placeholder}
          disabled={local.editable === false}
          maxlength={local.maxLength}
          onInput={handleInput}
          onBeforeInput={handleBeforeInput}
          onFocus={() => local.onFocus?.()}
          onBlur={() => local.onBlur?.()}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          style={baseStyle()}
          {...rest}
        >
          {local.defaultValue}
        </textarea>
      ) : (
        <input
          ref={ref as HTMLInputElement}
          type={local.secureTextEntry ? "password" : "text"}
          class={`zynth-text-input${local.class ? ` ${local.class}` : ""}`}
          value={local.value ?? local.defaultValue ?? ""}
          placeholder={local.placeholder}
          disabled={local.editable === false}
          maxlength={local.maxLength}
          inputmode={local.inputMode}
          onInput={handleInput}
          onBeforeInput={handleBeforeInput}
          onFocus={() => local.onFocus?.()}
          onBlur={() => local.onBlur?.()}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          style={baseStyle()}
          {...rest}
        />
      )}
    </div>
  );
};

registerComponent("text-input", TextInput);
registerComponent("secure-text-input", TextInput);
