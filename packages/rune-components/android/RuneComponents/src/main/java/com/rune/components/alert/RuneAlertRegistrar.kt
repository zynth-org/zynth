package com.rune.components.alert

import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry

class RuneAlertRegistrar : RuneComponentRegistrar {
  override fun register(registry: RuneComponentRegistry) {
    registry.register(RuneAlertDescriptor.create())
  }
}
