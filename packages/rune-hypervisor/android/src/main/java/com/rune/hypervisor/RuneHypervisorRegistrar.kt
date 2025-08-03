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
                    val view = node.view
                    if (view is RuneHypervisorView) {
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
                                view.enableOnLoadHandler()
                                true
                            }
                            "onError" -> {
                                view.enableOnErrorHandler()
                                true
                            }
                            "onMessage" -> {
                                view.enableOnMessageHandler()
                                true
                            }
                            "reload" -> {
                                if (value?.toString() == "true") {
                                    view.reload()
                                }
                                true
                            }
                            "destroy" -> {
                                if (value?.toString() == "true") {
                                    view.destroy()
                                }
                                true
                            }
                            "postMessage" -> {
                                if (value != null) {
                                    try {
                                        val json = JSONObject(value)
                                        view.postMessage(json)
                                    } catch (e: Exception) {
                                        view.postMessage(value)
                                    }
                                }
                                true
                            }
                            else -> false
                        }
                    } else {
                        false
                    }
                },
                // Add onNodeCreated to ensure destroy is called if node is removed by UI manager
                onNodeCreated = { manager, node ->
                    (node.view as? RuneHypervisorView)?.bindNode(manager, node.id)
                },
                onReset = { node ->
                    (node.view as? RuneHypervisorView)?.destroy()
                }
            )
        )
    }
}
