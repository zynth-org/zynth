package com.zynth.kit.components

import android.content.Context
import android.view.View
import com.zynth.kit.core.ZynthUIManager
import com.zynth.kit.layout.Style
import java.util.ServiceLoader
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Represents a native component that can be registered with the Zynth host.
 *
 * Component packages should register an instance via [ZynthComponentRegistry.register]
 * (typically from a [ZynthComponentRegistrar]) so the host can create views, apply props,
 * and manage event handlers for the component.
 */
data class ZynthComponentDescriptor(
  val type: String,
  val createView: (context: Context, nodeId: Int) -> View,
  val hasMeasureFunc: Boolean = false,
  val onNodeCreated: (manager: ZynthUIManager, node: ZynthUIManager.Node) -> Unit = { _, _ -> },
  val applyProperty: (node: ZynthUIManager.Node, name: String, value: String?) -> Boolean = { _, _, _ -> false },
  val onSetHandler: (node: ZynthUIManager.Node, event: String) -> Boolean = { _, _ -> false },
  val onSetInputHandler: (node: ZynthUIManager.Node, workletId: Int) -> Boolean = { _, _ -> false },
  val onSyncInputState: (node: ZynthUIManager.Node, text: String, selectionStart: Int, selectionEnd: Int) -> Boolean = { _, _, _, _ -> false },
  val onStyleApplied: (node: ZynthUIManager.Node, style: Style) -> Unit = { _, _ -> },
  val onReset: (node: ZynthUIManager.Node) -> Unit = { _ -> },
  val onChildInserted: (manager: ZynthUIManager, parent: ZynthUIManager.Node, child: ZynthUIManager.Node, index: Int) -> Unit = { _, _, _, _ -> },
  val onChildRemoved: (manager: ZynthUIManager, parent: ZynthUIManager.Node, child: ZynthUIManager.Node) -> Unit = { _, _, _ -> },
  val inspectState: (manager: ZynthUIManager, node: ZynthUIManager.Node) -> Map<String, Any?>? = { _, node ->
    (node.view as? ZynthInspectableComponent)?.inspectState()
  },
)

/**
 * Service provider interface for component packages. Implementations should be declared
 * via `META-INF/services/com.zynth.kit.components.ZynthComponentRegistrar` so they can be
 * discovered automatically.
 */
interface ZynthComponentRegistrar {
  fun register(registry: ZynthComponentRegistry)
}

/**
 * Optional protocol for views/components that can expose native inspection data.
 * Snapshot tooling can consume this without per-component custom wiring.
 */
interface ZynthInspectableComponent {
  fun inspectState(): Map<String, Any?>
}

/**
 * Global registry for native component descriptors. Components register themselves
 * via [ZynthComponentRegistrar] and the host queries descriptors by type when needed.
 */
object ZynthComponentRegistry {
  private val descriptors = ConcurrentHashMap<String, ZynthComponentDescriptor>()
  private val registrarsLoaded = AtomicBoolean(false)

  fun register(descriptor: ZynthComponentDescriptor) {
    descriptors[descriptor.type] = descriptor
  }

  fun getDescriptor(type: String?): ZynthComponentDescriptor? {
    if (type.isNullOrEmpty()) return null
    ensureRegistrarsLoaded()
    return descriptors[type]
  }

  fun allDescriptors(): Collection<ZynthComponentDescriptor> {
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
          ?: ZynthComponentRegistry::class.java.classLoader
        ServiceLoader.load(ZynthComponentRegistrar::class.java, loader).forEach { registrar ->
          runCatching { registrar.register(this) }.onFailure { error ->
            android.util.Log.e("ZynthKit", "Failed to register component: ${error.message}", error)
          }
        }
      }.onFailure { error ->
        android.util.Log.e("ZynthKit", "Unable to load Zynth component registrars: ${error.message}", error)
      }
    }
  }
}
