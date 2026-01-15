package dev.zynth.keyboard

import com.zynth.kit.components.ZynthComponentRegistrar
import com.zynth.kit.components.ZynthComponentRegistry

class ZynthKeyboardViewsRegistrar : ZynthComponentRegistrar {
    override fun register(registry: ZynthComponentRegistry) {
        registry.register(ZynthKeyboardAvoidingViewDescriptor.create())
        registry.register(ZynthKeyboardStickyViewDescriptor.create())
        registry.register(ZynthKeyboardAwareScrollViewDescriptor.create())
    }
}
