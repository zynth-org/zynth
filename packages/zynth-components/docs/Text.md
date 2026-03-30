# Text

`Text` is the primitive component for displaying text in Zynth. It supports nesting, controlled truncation, and synchronous style updates.

## Basic Usage

Text components can render string children or a `text` prop. Nesting `Text` components allows for complex inline styling where the child inherits and overrides properties from its parent.

```tsx
import { Text, View } from "@zynth/components";

function Typography() {
  return (
    <View>
      <Text style={{ fontSize: 18, fontWeight: "bold" }}>
        Main Heading
        <Text style={{ color: "#7c3aed" }}> with highlights</Text>
      </Text>
      
      <Text numberOfLines={1}>
        This is a very long line that will be truncated with an ellipsis because of the numberOfLines prop.
      </Text>
    </View>
  );
}
```

## Nested Text

Unlike `View`, `Text` components use an inline layout model when nested. This is useful for building rich-text blocks where certain spans require different colors or weights while maintaining line-wrapping integrity.

```tsx
<Text style={{ color: "#000" }}>
  By clicking sign up, you agree to our 
  <Text 
    style={{ fontWeight: "700", color: "#3b82f6" }} 
    onPress={showTerms}
  >
    Terms of Service
  </Text>
</Text>
```

## Truncation

The `numberOfLines` prop restricts the text to a specific number of lines. If the text exceeds this limit, it will be truncated with an ellipsis.

```tsx
<Text numberOfLines={3}>
  {/* Long content truncated after 3 lines */}
</Text>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | Content to render. Supports nested `Text` components. |
| `text` | `string` | Optional explicit text content. |
| `numberOfLines` | `number` | Limit the number of lines before truncation. |
| `style` | `StyleProp \| () => StyleProp` | Component styles. Supports reactive accessor functions for high-frequency updates. |
| `ref` | `(node: HostNode) => void` | Access the underlying native host node. |

## Notes

- **Inheritance**: Nested `Text` components inherit styles from their parents, similar to CSS.
- **Updates**: Passing a function to the `style` prop allows Zynth to update specific properties (like opacity or color) during animations without re-running the SolidJS render phase.
