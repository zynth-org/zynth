package com.rune.kit.core

import android.animation.TimeInterpolator
import android.os.Build
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.AccelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import kotlin.math.max
import kotlin.math.min

enum class LayoutEasing {
  LINEAR,
  EASE,
  EASE_IN,
  EASE_OUT,
  EASE_IN_OUT,
  EASE_OUT_CUBIC;

  fun toInterpolator(): TimeInterpolator {
    return when (this) {
      LINEAR -> LinearInterpolator()
      EASE -> AccelerateDecelerateInterpolator()
      EASE_IN -> AccelerateInterpolator()
      EASE_OUT -> DecelerateInterpolator()
      EASE_IN_OUT -> AccelerateDecelerateInterpolator()
      EASE_OUT_CUBIC -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
          PathInterpolator(0.215f, 0.61f, 0.355f, 1f)
        } else {
          TimeInterpolator { input ->
            val t = min(1f, max(0f, input))
            val inv = 1f - t
            1f - inv * inv * inv
          }
        }
      }
    }
  }

  companion object {
    fun fromName(name: String?): LayoutEasing {
      return when (name) {
        "linear" -> LINEAR
        "ease" -> EASE
        "easeIn" -> EASE_IN
        "easeOut" -> EASE_OUT
        "easeInOut" -> EASE_IN_OUT
        "easeOutCubic" -> EASE_OUT_CUBIC
        else -> EASE_OUT_CUBIC
      }
    }
  }
}

data class LayoutTransitionConfig(
  val type: String,
  val durationMs: Long,
  val delayMs: Long,
  val easing: LayoutEasing,
)
