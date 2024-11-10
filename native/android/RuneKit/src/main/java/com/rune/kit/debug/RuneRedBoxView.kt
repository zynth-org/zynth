package com.rune.kit.debug

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

class RuneRedBoxView(context: Context) : FrameLayout(context) {
  private val messageView: TextView
  private val stackView: TextView
  private var onDismiss: (() -> Unit)? = null
  private var onCloseApp: (() -> Unit)? = null

  init {
    setBackgroundColor(Color.parseColor("#D9000000"))
    isClickable = true
    isFocusable = true

    val container = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.parseColor("#FF3B30"))
      setPadding(24.dp(), 24.dp(), 24.dp(), 24.dp())
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply {
        gravity = Gravity.CENTER
        setMargins(16.dp(), 16.dp(), 16.dp(), 16.dp())
      }
    }

    val titleView = TextView(context).apply {
      text = "Something went wrong"
      textSize = 20f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(Color.WHITE)
    }
    container.addView(titleView)

    messageView = TextView(context).apply {
      textSize = 16f
      setTextColor(Color.WHITE)
      setPadding(0, 12.dp(), 0, 12.dp())
    }
    container.addView(messageView)

    stackView = TextView(context).apply {
      textSize = 13f
      typeface = Typeface.MONOSPACE
      setTextColor(Color.parseColor("#FFF1F1"))
    }

    val scroll = ScrollView(context).apply {
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        200.dp(),
      ).apply {
        bottomMargin = 16.dp()
      }
      addView(stackView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
      setBackgroundColor(Color.parseColor("#CC211715"))
    }
    container.addView(scroll)

    val buttonRow = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
    }

    val dismissButton = Button(context).apply {
      text = "Dismiss"
      setOnClickListener { onDismiss?.invoke() }
    }

    val closeAppButton = Button(context).apply {
      text = "Close App"
      setOnClickListener { onCloseApp?.invoke() }
    }

    buttonRow.addView(dismissButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    buttonRow.addView(closeAppButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      leftMargin = 12.dp()
    })

    container.addView(buttonRow)

    addView(container)
  }

  fun setError(message: String, stack: String?) {
    messageView.text = message
    stackView.text = stack?.takeIf { it.isNotBlank() } ?: "No stack trace available"
  }

  fun setOnDismissListener(listener: (() -> Unit)?) {
    onDismiss = listener
  }

  fun setOnCloseAppListener(listener: (() -> Unit)?) {
    onCloseApp = listener
  }

  private fun Int.dp(): Int = ((this * resources.displayMetrics.density) + 0.5f).toInt()
}
