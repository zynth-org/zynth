# Rune Pressable

Pressable is the low-level primitive that powers tapable surfaces across Rune. It owns gesture semantics, keyboard parity, and accessibility state without imposing any styling so you can compose your own buttons, cards, and list items.

## Controller-first design

```ts
import { Pressable, createPressableController } from "@rune/components";

const controller = createPressableController();
```

The controller exposes stable Solid signals plus imperatives:

- `pressed()`, `hovered()`, `focused()`, `disabled()`, `longPressActive()`
- `focus()`, `blur()`, `click()` — synthesize interactions without re-rendering
- `cancel()` — abort an in-flight press (e.g. when a route changes)
- `setDisabled(value)` — mirror server responses or async flows

Pass the controller via the `controller` prop to keep the instance out of the render tree. Imperatives never trigger reflows, they emit commands to the host view.

## Core props

| Prop | Default | Notes |
| --- | --- | --- |
| `disabled` | `false` | Disables pointer & keyboard activation. Controller can override. |
| `style` | `undefined` | Either a static style or a resolver `(state) => style`. Only applied to the host container; Pressable never draws its own visuals. |
| `pressEffect` | `"none"` | `"highlight"` and `"ripple"` map to the underlying platform (ripple is Android-only). |
| `pressRetentionOffset` | `20` | Distance in px before cancelling an active press. |
| `delayPressInMs`, `delayPressOutMs` | `0` | Mirror web quirks for pointer down/up. |
| `delayLongPressMs` / `longPressMinDurationMs` | `500` | Delay before `onLongPress` fires. |
| `hitSlop` | `0` | Accepts number or edge map. Expands the touch target without affecting layout. |
| `enableDoublePress` | `false` | Emits `onDoublePress` inside the specified window. |
| `allowTouchPropagation` | `false` | When `true`, parent pressables receive the event after the child succeeds. |
| `cancelOnOutside` | `true` | Pointer drifting past the retention offset emits `onPressOut` with `cancelled`. |
| `activateKeys` | By role | Defaults to `Enter`/`Space` for `role="button"`, `Enter` for `role="link"`. |

## Event payloads

`onPressIn`, `onPressOut`, `onPress`, and `onDoublePress` receive:

```ts
{
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  timestamp: number; // ms
  pointerType: "touch" | "mouse" | "pen" | "keyboard" | "programmatic";
  button?: number;
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
  cancelled?: boolean; // only on onPressOut
}
```

`onLongPress` gets `{ durationMs: number }` (with the actual measured value on native).

Keyboard events bubble via `onKeyDown` / `onKeyUp` with `{ key, repeat, modifiers }` payloads.

## Composition tips

- Wrap your visual content inside Pressable and drive backgrounds through the `style` resolver.
- Use `pressEffect="highlight"` for platform-consistent state layers. When you need full control, provide your own overlay via render logic.
- Combine with `ScrollView`: when the scroll view wins the gesture, the host CANCEL event resets the controller and emits `onPressOut` with `cancelled: true` — no double activations.
- For nested pressables, leave `allowTouchPropagation` off so the innermost target wins by default. Opt-in only for advanced behaviors (e.g. tap to toggle + card-level action).
- Pair the controller imperatives with orchestrators: focus a new row after virtualized list insertions, or call `cancel()` when navigating away mid gesture.

## Demo

See `apps/components/src/components/controls/Pressables.tsx` for a playground that exercises highlight effects, double press, long press, and controller-driven flows.
