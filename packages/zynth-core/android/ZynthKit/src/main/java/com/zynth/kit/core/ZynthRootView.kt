package com.zynth.kit.core

import android.content.Context
import android.util.AttributeSet
import java.util.concurrent.atomic.AtomicInteger

class ZynthRootView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
  explicitRootId: Int? = null,
) : ZynthLayoutView(context, attrs, defStyleAttr) {
  val rootId: Int = explicitRootId ?: allocateRootId()

  constructor(context: Context, explicitRootId: Int) : this(context, null, 0, explicitRootId)

  companion object {
    private const val SURFACE_ID_OFFSET = 1 shl 20
    private val NEXT_ROOT_ID = AtomicInteger(SURFACE_ID_OFFSET)

    @JvmStatic
    fun allocateRootId(): Int = NEXT_ROOT_ID.getAndIncrement()
  }
}
