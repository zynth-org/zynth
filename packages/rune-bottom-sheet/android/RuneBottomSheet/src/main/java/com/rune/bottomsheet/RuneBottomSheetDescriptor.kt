package com.rune.bottomsheet

import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.core.RuneUIManager

/** Placeholder descriptor for the RuneBottomSheet component until native logic is implemented. */
object RuneBottomSheetDescriptor {
  fun create(): RuneComponentDescriptor {
    return RuneComponentDescriptor(
      type = "RuneBottomSheet",
      createView = { context, _ -> RuneBottomSheetLayout(context) },
      onNodeCreated = { _, _ ->
        // Native lifecycle wiring will be added later.
      },
      applyProperty = { _, _, _ ->
        // Handled by JS bridge once we restore native implementation.
        false
      },
      onSetHandler = { _, _ ->
        // Events will be forwarded when the native sheet is wired up.
        false
      },
      onStyleApplied = { _, _ ->
        // Keep placeholder until styling requirements are defined.
      },
      onReset = { _ ->
        // Reset logic lives here once the sheet behavior is restored.
      },
    )
  }
}
