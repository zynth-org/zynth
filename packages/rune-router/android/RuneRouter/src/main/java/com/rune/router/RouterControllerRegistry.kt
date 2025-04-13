package com.rune.router

import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

internal object RouterControllerRegistry {
  private val controllers = ConcurrentHashMap<String, WeakReference<StackController>>()

  fun register(key: String, controller: StackController) {
    controllers[key] = WeakReference(controller)
  }

  fun resolve(key: String): StackController? {
    val controller = controllers[key]?.get()
    if (controller == null) {
      controllers.remove(key)
    }
    return controller
  }
}
