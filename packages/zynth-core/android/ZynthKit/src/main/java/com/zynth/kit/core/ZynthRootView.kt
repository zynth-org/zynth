package com.zynth.kit.core

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout

class ZynthRootView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
  val explicitRootId: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {
  val rootId: Int = explicitRootId
}
