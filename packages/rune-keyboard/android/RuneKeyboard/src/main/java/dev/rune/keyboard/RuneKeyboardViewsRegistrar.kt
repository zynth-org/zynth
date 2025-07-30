package dev.rune.keyboard

import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry

class RuneKeyboardViewsRegistrar : RuneComponentRegistrar {
    override fun register(registry: RuneComponentRegistry) {
        registry.register(RuneKeyboardAvoidingViewDescriptor.create())
        registry.register(RuneKeyboardStickyViewDescriptor.create())
        registry.register(RuneKeyboardAwareScrollViewDescriptor.create())
    }
}
