# DatePicker

`DatePicker` is a native component for date and range selection. It provides a standard picker with support for multiple selection modes: single date, date range, and year-only selection.

## Basic Usage

The component acts as a controlled or uncontrolled input, where `value` and `onChange` handle the synchronization of selected timestamps.

```tsx
import { DatePicker, View, Text } from "@zynth/components";

function Picker() {
  const [date, setDate] = createSignal(Date.now());

  return (
    <View>
      <Text>Selected: {new Date(date()).toLocaleDateString()}</Text>
      
      <DatePicker 
        mode="date" 
        value={date()} 
        onChange={setDate}
      >
        <DatePicker.Trigger>
          <View style={{ padding: 12, border: "1px solid #ccc" }}>
            <Text>Choose a date</Text>
          </View>
        </DatePicker.Trigger>
      </DatePicker>
    </View>
  );
}
```

## Date Range Selection

Use `mode="range"` to enable selecting a start and end interval. This mode returns a `DateRangeValue` object containing timestamps for both points.

```tsx
function RangePicker() {
  const [range, setRange] = createSignal<DateRangeValue>({ 
    start: null, 
    end: null 
  });

  return (
    <DatePicker 
      mode="range" 
      value={range()} 
      onRangeChange={setRange}
      confirmText="Apply Range"
    />
  );
}
```

## Year Selection

For use cases where only the year is required (e.g., birth years or financial periods), set `mode="year"`.

```tsx
<DatePicker 
  mode="year" 
  title="Select Fiscal Year"
  onChange={(year) => console.log("Year selected:", year)}
/>
```

## Customized Buttons

The `confirmText` and `cancelText` props allow for modifying the primary and secondary action labels within the picker UI.

```tsx
<DatePicker 
  confirmText="Done" 
  cancelText="Go Back"
  onCancel={() => console.log("User cancelled")}
/>
```

## Props

| Prop | Type | Description |
|---|---|---|
| `mode` | `date` \| `range` \| `year` | Picker selection mode. |
| `title` | `string` | Header text shown on the picker. |
| `value` | `number \| Date \| DateRangeValue` | The selected timestamp or range. |
| `defaultValue` | `number \| Date \| DateRangeValue` | Initial value if uncontrolled. |
| `confirmText` | `string` | Label for the positive action. |
| `cancelText` | `string` | Label for the negative action. |
| `onChange` | `(value: number) => void` | Event for single `date` and `year` picks. |
| `onRangeChange` | `(value: DateRangeValue) => void` | Event for `range` mode selection. |
| `onCancel` | `() => void` | Event triggered by the cancel action. |
| `onDismiss` | `() => void` | Event triggered when the picker is closed. |
| `style` | `Style` | Outer container styling. |
| `children` | `JSX.Element` | Content placed inside the picker root (triggers). |

## Imperative Ref

A `ref` provides an interface to manually control the picker's visibility:

```tsx
const pickerRef = createDatePickerRef();

// Opens the picker programmatically
pickerRef.open();

// Closes the picker programmatically
pickerRef.dismiss();
```
