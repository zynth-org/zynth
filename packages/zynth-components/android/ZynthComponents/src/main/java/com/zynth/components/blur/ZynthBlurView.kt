package com.zynth.components.blur

import android.content.Context
import com.zynth.components.view.ZynthViewContainer

/**
 * Android fallback for BlurView.
 *
 * Without an additional blur backend dependency, Android cannot provide
 * a generic inline backdrop blur equivalent here, so this component acts
 * as a regular container view and renders its children normally.
 */
class ZynthBlurView(context: Context) : ZynthViewContainer(context)
