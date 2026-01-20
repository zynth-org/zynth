package com.zynth.kit.core

import android.content.Context
import android.util.AttributeSet

class ZynthRootView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0,
  val explicitRootId: Int = 0,
) : ZynthLayoutView(context, attrs, defStyleAttr) {
  val rootId: Int = explicitRootId
}
