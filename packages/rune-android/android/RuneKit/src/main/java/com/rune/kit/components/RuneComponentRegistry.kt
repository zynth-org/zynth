package com.rune.kit.components

import android.content.Context
import android.view.View
import com.rune.kit.core.RuneUIManager
import com.rune.kit.layout.Style
import java.util.ServiceLoader
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Represents a native component that can be registered with the Rune host.
 *
 * Component packages should register an instance via [RuneComponentRegistry.register]
 * (typically from a [RuneComponentRegistrar]) so the host can create views, apply props,
 * and manage event handlers for the component.
 */
data class RuneComponentDescriptor(
  val type: String,
  val createView: (context: Context, nodeId: Int) -> View,
  val onNodeCreated: (manager: RuneUIManager, node: RuneUIManager.Node) -> Unit = { _, _ -> },
  val applyProperty: (node: RuneUIManager.Node, name: String, value: String?) -> Boolean = { _, _, _ -> false },
  val onSetHandler: (node: RuneUIManager.Node, event: String) -> Boolean = { _, _ -> false },
  val onStyleApplied: (node: RuneUIManager.Node, style: Style) -> Unit = { _, _ -> },
  val onReset: (node: RuneUIManager.Node) -> Unit = { _ -> },
)

/**
 * Service provider interface for component packages. Implementations should be declared
 * via `META-INF/services/com.rune.kit.components.RuneComponentRegistrar` so they can be
 * discovered automatically.
 */
interface RuneComponentRegistrar {
  fun register(registry: RuneComponentRegistry)
}

/**
 * Global registry for native component descriptors. Components register themselves
 * via [RuneComponentRegistrar] and the host queries descriptors by type when needed.
 */
object RuneComponentRegistry {
  private val descriptors = ConcurrentHashMap<String, RuneComponentDescriptor>()
  private val registrarsLoaded = AtomicBoolean(false)

  fun register(descriptor: RuneComponentDescriptor) {
    descriptors[descriptor.type] = descriptor
  }

  fun getDescriptor(type: String?): RuneComponentDescriptor? {
    if (type.isNullOrEmpty()) return null
    ensureRegistrarsLoaded()
    return descriptors[type]
  }

  fun allDescriptors(): Collection<RuneComponentDescriptor> {
    ensureRegistrarsLoaded()
    return descriptors.values
  }

  fun ensureInitialized() {
    ensureRegistrarsLoaded()
  }

  private fun ensureRegistrarsLoaded() {
    if (registrarsLoaded.compareAndSet(false, true)) {
      runCatching {
        val loader = Thread.currentThread().contextClassLoader
          ?: RuneComponentRegistry::class.java.classLoader
        ServiceLoader.load(RuneComponentRegistrar::class.java, loader).forEach { registrar ->
          runCatching { registrar.register(this) }.onFailure { error ->
            android.util.Log.e("RuneKit", "Failed to register component: ${error.message}", error)
          }
        }
      }.onFailure { error ->
        android.util.Log.e("RuneKit", "Unable to load Rune component registrars: ${error.message}", error)
      }
    }
  }
}
