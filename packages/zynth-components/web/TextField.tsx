/** @jsxImportSource solid-js */
import { createEffect, createMemo, omit, untrack } from "solid-js";
import { registerComponent } from "@zynthjs/core";

const resolveInputType = (keyboardType?: string, secure?: boolean) => {
  if (secure) return "password";
  if (keyboardType === "email") return "email";
  if (keyboardType === "url") return "url";
  return "text";
};

const resolveInputMode = (keyboardType?: string) => {
  switch (keyboardType) {
    case "numeric":
      return "numeric";
    case "phone":
      return "tel";
    case "email":
      return "email";
    case "url":
      return "url";
    default:
      return undefined;
  }
};

const resolveVariantStyle = (variant?: string) => {
  switch (variant) {
    case "outlined":
      return {
        backgroundColor: "transparent",
        borderWidth: 1,
      };
    case "none":
      return {
        backgroundColor: "transparent",
        borderWidth: 0,
      };
    default:
      return {
        backgroundColor: "rgba(148, 163, 184, 0.12)",
        borderWidth: 1,
      };
  }
};

const UNIT_KEYS = new Set([
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "width",
  "height",
  "font-size",
  "line-height",
]);

const camelToKebab = (value: string) =>
  value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

const normalizeStyleValue = (key: string, value: any) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && UNIT_KEYS.has(key)) {
    return `${value}px`;
  }
  return String(value);
};

export const TextField = (props: any) => {
  const local = props;
  const rest = omit(
    props,
    "value",
    "defaultValue",
    "placeholder",
    "disabled",
    "editable",
    "secureTextEntry",
    "keyboardType",
    "returnKeyType",
    "autoCapitalize",
    "autoCorrect",
    "maxLength",
    "variant",
    "onChange",
    "onFocus",
    "onBlur",
    "onSubmit",
    "style",
    "class",
    "backgroundColor",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "textColor",
    "placeholderColor",
    "requestFocus",
    "requestBlur"
  );

  let ref: HTMLInputElement | undefined;
  let lastStyleKeys = new Set<string>();

  createEffect(
    () => local.value,
    (val) => {
      if (!ref) return;
      if (val !== undefined && ref.value !== val) {
        ref.value = val;
      }
    }
  );

  createEffect(
    () => ({ value: local.value, defaultValue: local.defaultValue }),
    ({ value, defaultValue }) => {
      if (!ref) return;
      if (value !== undefined) return;
      if (defaultValue !== undefined && ref.value !== defaultValue) {
        ref.value = defaultValue;
      }
    }
  );

  createEffect(
    () => local.requestFocus,
    (shouldFocus) => {
      if (!ref) return;
      if (shouldFocus) {
        ref.focus();
      }
    }
  );

  createEffect(
    () => local.requestBlur,
    (shouldBlur) => {
      if (!ref) return;
      if (shouldBlur) {
        ref.blur();
      }
    }
  );

  const baseStyle = createMemo(() => {
    const variantStyle = resolveVariantStyle(local.variant);
    const resolvedBorderWidth =
      local.borderWidth ?? variantStyle.borderWidth ?? 0;
    const resolvedBorderRadius = local.borderRadius ?? 10;
    const borderWidthValue =
      typeof resolvedBorderWidth === "number"
        ? `${resolvedBorderWidth}px`
        : resolvedBorderWidth;
    const borderRadiusValue =
      typeof resolvedBorderRadius === "number"
        ? `${resolvedBorderRadius}px`
        : resolvedBorderRadius;
    const base: Record<string, any> = {
      width: "100%",
      "box-sizing": "border-box",
      padding: "10px 12px",
      "border-width": borderWidthValue,
      "border-color": local.borderColor ?? "rgba(148, 163, 184, 0.35)",
      "border-radius": borderRadiusValue,
      "border-style":
        typeof resolvedBorderWidth === "number" && resolvedBorderWidth > 0
          ? "solid"
          : resolvedBorderWidth
          ? "solid"
          : "none",
      "background-color": local.backgroundColor ?? variantStyle.backgroundColor,
      color: local.textColor ?? "inherit",
      "font-family": "inherit",
      "font-size": "inherit",
      outline: "none",
    };

    if (local.style) {
      if (Array.isArray(local.style)) {
        return Object.assign(base, ...local.style);
      }
      return Object.assign(base, local.style);
    }
    return base;
  });

  const inputStyle = createMemo(() => {
    const placeholderColor =
      local.placeholderColor ?? "rgba(148, 163, 184, 0.7)";
    return {
      "--zynth-placeholder-color": placeholderColor,
    } as Record<string, any>;
  });

  const applyInlineStyle = () => {
    if (!ref) return;
    const styles = {
      ...baseStyle(),
      ...inputStyle(),
    } as Record<string, any>;

    const nextKeys = new Set<string>();
    for (const [rawKey, rawValue] of Object.entries(styles)) {
      const key = rawKey.startsWith("--") ? rawKey : camelToKebab(rawKey);
      const value = normalizeStyleValue(key, rawValue);
      if (value === "") continue;
      ref.style.setProperty(key, value);
      nextKeys.add(key);
    }

    for (const key of lastStyleKeys) {
      if (!nextKeys.has(key)) {
        ref.style.removeProperty(key);
      }
    }
    lastStyleKeys = nextKeys;
  };

  createEffect(
    () => ({ base: baseStyle(), input: inputStyle(), hasRef: !!ref }),
    () => {
      untrack(applyInlineStyle);
    }
  );

  const handleInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    local.onChange?.({ value: target.value });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    local.onSubmit?.({ value: (event.target as HTMLInputElement).value });
  };

  return (
    <div style="display: contents">
      <input
        ref={ref}
        class={`zynth-text-field${local.class ? ` ${local.class}` : ""}`}
        type={resolveInputType(local.keyboardType, local.secureTextEntry)}
        inputmode={resolveInputMode(local.keyboardType)}
        enterkeyhint={local.returnKeyType}
        autocapitalize={local.autoCapitalize}
        autocorrect={local.autoCorrect === false ? "off" : "on"}
        value={local.value ?? undefined}
        placeholder={local.placeholder}
        maxlength={local.maxLength}
        disabled={local.disabled || local.editable === false}
        onInput={handleInput}
        onFocus={() => local.onFocus?.()}
        onBlur={() => local.onBlur?.()}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      <style>
        {`
          .zynth-text-field::placeholder {
            color: var(--zynth-placeholder-color);
          }
        `}
      </style>
    </div>
  );
};

registerComponent("text-field", TextField);
