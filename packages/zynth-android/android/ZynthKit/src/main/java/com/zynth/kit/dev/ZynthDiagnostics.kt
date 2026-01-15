package com.zynth.kit.dev

import android.app.Activity
import android.content.Context
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import com.zynth.kit.debug.ZynthRedBoxView

/**
 * Unified diagnostics reporting system for Zynth.
 * Similar to iOS ZynthDiagnostics.swift.
 */
object ZynthDiagnostics {
    private const val TAG = "ZynthDiagnostics"
    
    @Volatile
    private var currentRedBox: ZynthRedBoxView? = null
    
    @Volatile
    private var context: Context? = null
    
    /**
     * Initialize diagnostics with a context (usually Activity).
     * Call this from your Activity's onCreate.
     */
    fun initialize(context: Context) {
        this.context = context
    }
    
    /**
     * Report a diagnostic error with phase, message, and optional stack trace.
     * This is the main entry point called from both native code and Kotlin.
     */
    @JvmStatic
    fun report(phase: String, message: String, stack: String?) {
        Log.e(TAG, "[$phase] $message")
        if (!stack.isNullOrBlank()) {
            Log.e(TAG, "Stack: $stack")
        }
        
        // Show RedBox on main thread
        context?.let { ctx ->
            if (ctx is Activity) {
                ctx.runOnUiThread {
                    showRedBox(ctx, "[$phase] $message", stack)
                }
            }
        }
    }
    
    /**
     * Show RedBox error dialog.
     */
    private fun showRedBox(activity: Activity, message: String, stack: String?) {
        dismiss() // Dismiss any existing RedBox
        
        val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
        val redBox = ZynthRedBoxView(activity).apply {
            setError(message, stack ?: "No stack trace available")
            setOnDismissListener { dismiss() }
            setOnCloseAppListener { 
                dismiss()
                activity.finishAffinity() 
            }
        }
        
        contentView.addView(
            redBox,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        
        currentRedBox = redBox
    }
    
    /**
     * Dismiss the current RedBox if showing.
     */
    fun dismiss() {
        currentRedBox?.let { redBox ->
            val parent = redBox.parent as? ViewGroup
            parent?.removeView(redBox)
            currentRedBox = null
        }
    }
}

/**
 * JNI function called from C++ bridge when errors occur.
 * This implementation simply forwards to the Kotlin report function.
 */
@Suppress("unused")
fun zynthDiagnosticsReportJNI(phase: String, message: String, stack: String?) {
    ZynthDiagnostics.report(phase, message, stack)
}