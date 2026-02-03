package com.zynth.components.bottomsheet

import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry

class ZynthBottomSheetRegistrar : ZynthComponentRegistrar {
  override fun register(registry: ZynthComponentRegistry) {
    registry.register(ZynthBottomSheetDescriptor.create())
  }
}
