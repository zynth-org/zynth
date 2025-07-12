package com.rune.components.alert

import android.content.Context
import android.content.DialogInterface
import android.view.View
import android.widget.FrameLayout
import androidx.appcompat.app.AlertDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONArray
import org.json.JSONObject

/**
 * Data class representing a button configuration
 */
data class AlertButtonConfig(
  val text: String,
  val style: String // "default", "cancel", "destructive"
)

/**
 * Listener interface for alert events
 */
interface RuneAlertListener {
  fun onButtonPress(nodeId: Int, index: Int)
  fun onDismiss(nodeId: Int)
}

/**
 * Native alert view that wraps Material 3 AlertDialog.
 * This is a placeholder view - the actual dialog is shown separately.
 */
class RuneAlertLayout(context: Context) : FrameLayout(context) {
  
  var nodeId: Int = -1
  var listener: RuneAlertListener? = null
  
  private var alertTitle: String? = null
  private var alertMessage: String? = null
  private var buttonsConfig: List<AlertButtonConfig> = emptyList()
  private var alertDialog: AlertDialog? = null
  
  fun setAlertTitle(title: String?) {
    alertTitle = title
  }
  
  fun setAlertMessage(message: String?) {
    alertMessage = message
  }
  
  fun setButtons(buttonsJson: String?) {
    if (buttonsJson.isNullOrBlank()) {
      buttonsConfig = emptyList()
      return
    }
    
    try {
      val jsonArray = JSONArray(buttonsJson)
      val buttons = mutableListOf<AlertButtonConfig>()
      
      for (i in 0 until jsonArray.length()) {
        val buttonObj = jsonArray.getJSONObject(i)
        val text = buttonObj.optString("text", "Button")
        val style = buttonObj.optString("style", "default")
        buttons.add(AlertButtonConfig(text, style))
      }
      
      buttonsConfig = buttons
    } catch (e: Exception) {
      buttonsConfig = emptyList()
    }
  }
  
  fun handleCommand(commandJson: String?) {
    if (commandJson.isNullOrBlank()) return
    
    try {
      val command = JSONObject(commandJson)
      when (command.optString("type")) {
        "show" -> show()
        "dismiss" -> dismiss()
      }
    } catch (e: Exception) {
      // Ignore invalid commands
    }
  }
  
  fun show() {
    if (alertDialog != null) return
    
    val activityContext = context
    
    val builder = MaterialAlertDialogBuilder(activityContext)
      .setTitle(alertTitle)
      .setMessage(alertMessage)
      .setCancelable(false) // Non-dismissable on backdrop tap for platform parity
    
    // Configure buttons based on their styles
    // Material 3 AlertDialog supports positive, negative, and neutral buttons
    // We map styles as follows:
    // - "destructive" -> positive (first action button, can be styled)
    // - "cancel" -> negative (typically on the left)
    // - "default" -> positive or neutral based on position
    
    if (buttonsConfig.isEmpty()) {
      // Default OK button
      builder.setPositiveButton("OK") { _, _ ->
        listener?.onButtonPress(nodeId, 0)
      }
    } else {
      assignButtons(builder, buttonsConfig)
    }
    
    val dialog = builder.create()
    
    dialog.setOnDismissListener {
      alertDialog = null
      listener?.onDismiss(nodeId)
    }
    
    // Set up destructive button styling before showing
    dialog.setOnShowListener {
      applyDestructiveButtonStyle(dialog)
    }
    
    alertDialog = dialog
    dialog.show()
  }
  
  fun dismiss() {
    alertDialog?.dismiss()
    alertDialog = null
  }
  
  fun reset() {
    dismiss()
    listener = null
    alertTitle = null
    alertMessage = null
    buttonsConfig = emptyList()
  }
  
  private fun assignButtons(builder: MaterialAlertDialogBuilder, buttons: List<AlertButtonConfig>) {
    // Strategy for mapping buttons to Material 3 dialog positions:
    // 1 button: positive
    // 2 buttons: negative (cancel/left), positive (action/right)
    // 3 buttons: neutral (left), negative (center), positive (right)
    
    when (buttons.size) {
      1 -> {
        builder.setPositiveButton(buttons[0].text) { _, _ ->
          listener?.onButtonPress(nodeId, 0)
        }
      }
      2 -> {
        // Find cancel button if any, put it on left (negative)
        val cancelIndex = buttons.indexOfFirst { it.style == "cancel" }
        
        if (cancelIndex >= 0) {
          val actionIndex = if (cancelIndex == 0) 1 else 0
          
          builder.setNegativeButton(buttons[cancelIndex].text) { _, _ ->
            listener?.onButtonPress(nodeId, cancelIndex)
          }
          builder.setPositiveButton(buttons[actionIndex].text) { _, _ ->
            listener?.onButtonPress(nodeId, actionIndex)
          }
        } else {
          // No explicit cancel, put first on left, second on right
          builder.setNegativeButton(buttons[0].text) { _, _ ->
            listener?.onButtonPress(nodeId, 0)
          }
          builder.setPositiveButton(buttons[1].text) { _, _ ->
            listener?.onButtonPress(nodeId, 1)
          }
        }
      }
      3 -> {
        // Find cancel button, put it in negative position
        val cancelIndex = buttons.indexOfFirst { it.style == "cancel" }
        val destructiveIndex = buttons.indexOfFirst { it.style == "destructive" }
        
        val indices = mutableListOf(0, 1, 2)
        
        var negativeIdx = if (cancelIndex >= 0) cancelIndex else 0
        indices.remove(negativeIdx)
        
        var positiveIdx = if (destructiveIndex >= 0 && destructiveIndex != negativeIdx) {
          destructiveIndex
        } else {
          indices.lastOrNull() ?: 2
        }
        indices.remove(positiveIdx)
        
        val neutralIdx = indices.firstOrNull() ?: 1
        
        builder.setNeutralButton(buttons[neutralIdx].text) { _, _ ->
          listener?.onButtonPress(nodeId, neutralIdx)
        }
        builder.setNegativeButton(buttons[negativeIdx].text) { _, _ ->
          listener?.onButtonPress(nodeId, negativeIdx)
        }
        builder.setPositiveButton(buttons[positiveIdx].text) { _, _ ->
          listener?.onButtonPress(nodeId, positiveIdx)
        }
      }
    }
  }
  
  private fun applyDestructiveButtonStyle(dialog: AlertDialog) {
    // Apply red color to destructive buttons
    buttonsConfig.forEachIndexed { index, config ->
      if (config.style == "destructive") {
        val buttonId = when (buttonsConfig.size) {
          1 -> DialogInterface.BUTTON_POSITIVE
          2 -> {
            val cancelIndex = buttonsConfig.indexOfFirst { it.style == "cancel" }
            if (cancelIndex >= 0 && cancelIndex != index) {
              DialogInterface.BUTTON_POSITIVE
            } else if (cancelIndex < 0 && index == 1) {
              DialogInterface.BUTTON_POSITIVE
            } else {
              DialogInterface.BUTTON_NEGATIVE
            }
          }
          3 -> {
            // Match the assignment logic in assignButtons
            val cancelIndex = buttonsConfig.indexOfFirst { it.style == "cancel" }
            val destructiveIndex = buttonsConfig.indexOfFirst { it.style == "destructive" }
            val indices = mutableListOf(0, 1, 2)
            
            val negativeIdx = if (cancelIndex >= 0) cancelIndex else 0
            indices.remove(negativeIdx)
            
            val positiveIdx = if (destructiveIndex >= 0 && destructiveIndex != negativeIdx) {
              destructiveIndex
            } else {
              indices.lastOrNull() ?: 2
            }
            
            when (index) {
              positiveIdx -> DialogInterface.BUTTON_POSITIVE
              negativeIdx -> DialogInterface.BUTTON_NEGATIVE
              else -> DialogInterface.BUTTON_NEUTRAL
            }
          }
          else -> return@forEachIndexed
        }
        
        dialog.getButton(buttonId)?.setTextColor(
          context.getColor(com.google.android.material.R.color.design_default_color_error)
        )
      }
    }
  }
}
