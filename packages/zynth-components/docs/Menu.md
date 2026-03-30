# Menu

`Menu` is a native-driven hierarchical component for displaying lists of actions and hierarchical sub-menus. It maps to native context menus and dropdown systems on supported platforms.

## Basic Usage

The component consists of three main parts: the `Menu` root, `Menu.Trigger`, and one or more `Menu.Item` components.

```tsx
import { Menu, View, Text, SystemIcon } from "@zynth/components";

function ActionMenu() {
  const onProfilePress = () => console.log("Profile Tapped");
  const onSettingsPress = () => console.log("Settings Tapped");
  const onLogoutPress = () => console.log("Logging Out");

  return (
    <Menu 
      onOpen={() => console.log("Menu Opened")} 
      onClose={() => console.log("Menu Closed")}
    >
      <Menu.Trigger>
        <Text>Click for Menu</Text>
      </Menu.Trigger>

      <Menu.Item 
        label="Profile" 
        icon={<SystemIcon name="person" style={{ width: 20, height: 20 }} />} 
        onPress={onProfilePress} 
      />
      
      <Menu.Item 
        label="Settings" 
        icon={<SystemIcon name="gear" style={{ width: 20, height: 20 }} />} 
        onPress={onSettingsPress} 
      />
      
      <Menu.Item 
        label="Logout" 
        destructive={true} 
        onPress={onLogoutPress} 
      />
    </Menu>
  );
}
```

## Menu Icons

`Menu.Item` supports an `icon` prop. Use `SystemIcon` to provide visual context for each entry using platform-standard symbols.

```tsx
<Menu.Item 
  label="Copy Link" 
  icon={<SystemIcon name="doc.on.doc" style={{ width: 20, height: 20 }} />} 
/>
```

## Long Press Activation

By default, the menu opens on a simple press. To use it as a context menu, set `openOn="longPress"` on the `Menu.Trigger`.

```tsx
<Menu.Trigger openOn="longPress">
  <View style={{ padding: 12 }}>
    <Text>Long press me for options</Text>
  </View>
</Menu.Trigger>
```

## Destructive Actions

For actions that have permanent consequences (e.g., delete or logout), setting `destructive={true}` indicates to the native platform to apply specialized styling (e.g., red text style on iOS).

```tsx
<Menu.Item 
  label="Delete Folder" 
  destructive={true} 
  onPress={handleDelete} 
/>
```

## Disabling Items

`Menu.Item` can be disabled to prevent user interaction while still keeping it visible in the menu hierarchy.

```tsx
<Menu.Item 
  label="Paste" 
  disabled={true} 
  onPress={onPaste} 
/>
```

## Components

### Menu
The root component that manages the state and visibility of the native menu.

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | `Menu.Trigger` and `Menu.Item` components. |
| `onOpen` | `() => void` | Event triggered on menu open. |
| `onClose` | `() => void` | Event triggered on menu close. |

### Menu.Trigger
The visual element that toggles the menu when interacted with.

| Prop | Type | Description |
|---|---|---|
| `children` | `JSX.Element` | The interactive trigger element. |
| `openOn` | `press` \| `longPress` | Type of interaction that activates the menu. |

### Menu.Item
A single entry in the menu list.

| Prop | Type | Description |
|---|---|---|
| `label` | `string` | Text content of the item. |
| `icon` | `JSX.Element` | Visual icon displayed next to the label. |
| `onPress` | `() => void` | Triggered when the item is tapped. |
| `destructive` | `boolean` | Applies destructive styling. |
| `disabled` | `boolean` | Disables the item interaction. |
