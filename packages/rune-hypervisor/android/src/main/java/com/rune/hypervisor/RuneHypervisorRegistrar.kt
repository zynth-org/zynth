package com.rune.hypervisor

import android.view.View
import com.rune.kit.components.RuneComponentDescriptor
import com.rune.kit.components.RuneComponentRegistrar
import com.rune.kit.components.RuneComponentRegistry
import com.rune.kit.core.RuneUIManager
import org.json.JSONObject

class RuneHypervisorRegistrar : RuneComponentRegistrar {
    override fun register(registry: RuneComponentRegistry) {
        registry.register(
            RuneComponentDescriptor(
                type = "rune-hypervisor-view",
                createView = { context, _ -> RuneHypervisorView(context) },
                applyProperty = { node, name, value ->
                    val view = node.view as? RuneHypervisorView ?: return@applyProperty false
                    when (name) {
                        "source" -> {
                            val json = try {
                                if (value != null) JSONObject(value) else null
                            } catch (e: Exception) {
                                null
                            }
                            view.setSource(json)
                            true
                        }
                        "onLoad" -> {
                            // In Kotlin, value will be the JS callback ID or reference.
                            // For now, we'll store a simple lambda.
                            // This will be properly bridged in Phase 4.
                            view.onLoad = { android.util.Log.d("RuneHypervisor", "onLoad event triggered natively") }
                            true
                        }
                        "onError" -> {
                            view.onError = { msg -> android.util.Log.e("RuneHypervisor", "onError event triggered natively: $msg") }
                            true
                        }
                        "onMessage" -> {
                            view.onMessage = { msg -> android.util.Log.d("RuneHypervisor", "onMessage event triggered natively: $msg") }
                            true
                        }
                        "reload" -> {
                            if (value is Boolean && value) {
                                view.reload()
                            }
                            true
                        }
                        "destroy" -> {
                            if (value is Boolean && value) {
                                view.destroy()
                            }
                            true
                        }
                        else -> false
                    }
                },
                // Add onNodeCreated to ensure destroy is called if node is removed by UI manager
                onNodeCreated = { manager, node ->
                    // No-op for now, destroy is handled in onDetachedFromWindow and setSource
                },
                onReset = { node ->
                    (node.view as? RuneHypervisorView)?.destroy()
                }
            )
        )
    }
}

