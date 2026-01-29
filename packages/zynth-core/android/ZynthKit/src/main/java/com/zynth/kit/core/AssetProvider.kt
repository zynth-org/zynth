package com.zynth.kit.core

import android.graphics.Typeface

/**
 * Interface for providing custom assets to the Zynth renderer.
 * Modules can implement this to expose fonts, images, or other resources.
 */
interface AssetProvider {
  fun getTypeface(family: String): Typeface?
}
