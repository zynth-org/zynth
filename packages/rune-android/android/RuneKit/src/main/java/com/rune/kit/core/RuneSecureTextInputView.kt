package com.rune.kit.core

import android.content.Context
import android.util.AttributeSet

internal class RuneSecureTextInputView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
) : RuneTextInputView(context, attrs) {

  init {
    applySecureEntry(true)
  }
}
