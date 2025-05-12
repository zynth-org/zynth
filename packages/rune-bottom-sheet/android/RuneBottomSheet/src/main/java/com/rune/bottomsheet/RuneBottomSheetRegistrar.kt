package com.rune.bottomsheet

import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry

class RuneBottomSheetRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(RuneBottomSheetDescriptor.create())
  }
}
