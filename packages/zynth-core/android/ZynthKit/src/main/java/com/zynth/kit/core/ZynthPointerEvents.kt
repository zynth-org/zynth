package com.zynth.kit.core

import android.view.View
import java.util.Collections
import java.util.WeakHashMap

internal object ZynthPointerEvents {
  enum class Mode {
    AUTO,
    NONE,
    BOX_NONE,
    BOX_ONLY,
  }

  private val store = Collections.synchronizedMap(WeakHashMap<View, Mode>())

  fun set(view: View, mode: Mode?) {
    if (mode == null || mode == Mode.AUTO) {
      store.remove(view)
      return
    }
    store[view] = mode
  }

  fun mode(view: View): Mode {
    return store[view] ?: Mode.AUTO
  }

  fun fromString(raw: String?): Mode {
    return when (raw) {
      "none" -> Mode.NONE
      "box-none" -> Mode.BOX_NONE
      "box-only" -> Mode.BOX_ONLY
      else -> Mode.AUTO
    }
  }
}
