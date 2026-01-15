package com.zynth.components.textinput

import android.content.Context
import android.util.AttributeSet

internal class ZynthSecureTextInputView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : ZynthTextInputView(context, attrs) {

  init {
    applySecureEntry(true)
  }
}
