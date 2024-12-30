# Known Issues

## Android TextInput wrapper focus

When TextInput is wrapped by the component-level View (added for padding/border/background), tapping the wrapper focuses the field but Android keeps the caret at the start of the text. Attempts to adjust the selection from JS led to rendering regressions, so the caret positioning remains a known limitation for now.
