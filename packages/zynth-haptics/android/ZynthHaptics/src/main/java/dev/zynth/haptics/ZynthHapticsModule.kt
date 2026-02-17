package dev.zynth.haptics

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

/**
 * Bridge module that exposes haptics functionality to JavaScript.
 */
class ZynthHapticsModule(
    private val activity: Activity
) : ZynthModule {
    override val name: String = "ZynthHaptics"

    override val exportedMethods: List<String> = listOf(
        "notificationAsync",
        "impactAsync",
        "selectionAsync",
        "performHapticsAsync",
    )

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "notificationAsync" -> handleNotification(args)
            "impactAsync" -> handleImpact(args)
            "selectionAsync" -> handleSelection()
            "performHapticsAsync" -> handlePerformHaptics(args)
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun handleNotification(args: ZynthArgs): JSONObject {
        val type = args.getString("type")
        val pattern = notificationPatterns[type.lowercase()] ?: throw IllegalArgumentException("Invalid notification type: $type")
        vibrate(pattern)
        return resultResponse(null)
    }

    private fun handleImpact(args: ZynthArgs): JSONObject {
        val style = args.getString("style")
        val pattern = impactPatterns[style.lowercase()] ?: throw IllegalArgumentException("Invalid impact style: $style")
        vibrate(pattern)
        return resultResponse(null)
    }

    private fun handleSelection(): JSONObject {
        vibrate(selectionPattern)
        return resultResponse(null)
    }

    private fun handlePerformHaptics(args: ZynthArgs): JSONObject {
        val type = args.getString("type")
        if (type == "no-haptics") {
            return resultResponse(null)
        }

        val feedbackType = resolveHapticFeedbackConstant(type)
            ?: throw IllegalArgumentException("Unsupported haptic type: $type")

        val view = findHapticsView()
            ?: throw IllegalStateException("Could not find view for haptic feedback")

        activity.runOnUiThread {
            view.performHapticFeedback(feedbackType)
        }

        return resultResponse(null)
    }

    private fun findHapticsView(): View? {
        return activity.findViewById(android.R.id.content)
            ?: activity.window?.decorView
    }

    private fun resolveHapticFeedbackConstant(type: String): Int? {
        val normalized = type.uppercase().replace('-', '_')
        return try {
            val field = HapticFeedbackConstants::class.java.getDeclaredField(normalized)
            field.getInt(null)
        } catch (_: NoSuchFieldException) {
            when (normalized) {
                "CLOCK_TICK" -> HapticFeedbackConstants.CLOCK_TICK
                "CONTEXT_CLICK" -> HapticFeedbackConstants.CONTEXT_CLICK
                "KEYBOARD_TAP" -> HapticFeedbackConstants.KEYBOARD_TAP
                "LONG_PRESS" -> HapticFeedbackConstants.LONG_PRESS
                "VIRTUAL_KEY" -> HapticFeedbackConstants.VIRTUAL_KEY
                "VIRTUAL_KEY_RELEASE" -> HapticFeedbackConstants.VIRTUAL_KEY
                else -> null
            }
        } catch (_: IllegalAccessException) {
            null
        }
    }

    private fun vibrate(pattern: VibrationPattern) {
        val vibrator = getVibrator() ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val effect = VibrationEffect.createWaveform(pattern.timings, pattern.amplitudes, -1)
            vibrator.vibrate(effect)
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern.oldSdkPattern, -1)
        }
    }

    private fun getVibrator(): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            manager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().apply {
            put("result", result ?: JSONObject.NULL)
        }
    }

    private data class VibrationPattern(
        val timings: LongArray,
        val amplitudes: IntArray,
        val oldSdkPattern: LongArray
    )

    private companion object {
        private val notificationPatterns = mapOf(
            "success" to VibrationPattern(
                longArrayOf(0, 40, 100, 40),
                intArrayOf(0, 50, 0, 60),
                longArrayOf(0, 40, 100, 40)
            ),
            "warning" to VibrationPattern(
                longArrayOf(0, 40, 120, 60),
                intArrayOf(0, 40, 0, 60),
                longArrayOf(0, 40, 120, 60)
            ),
            "error" to VibrationPattern(
                longArrayOf(0, 60, 100, 40, 80, 50),
                intArrayOf(0, 50, 0, 40, 0, 50),
                longArrayOf(0, 60, 100, 40, 80, 50)
            )
        )

        private val impactPatterns = mapOf(
            "light" to VibrationPattern(
                longArrayOf(0, 50),
                intArrayOf(0, 30),
                longArrayOf(0, 20)
            ),
            "soft" to VibrationPattern(
                longArrayOf(0, 50),
                intArrayOf(0, 30),
                longArrayOf(0, 20)
            ),
            "medium" to VibrationPattern(
                longArrayOf(0, 43),
                intArrayOf(0, 50),
                longArrayOf(0, 43)
            ),
            "rigid" to VibrationPattern(
                longArrayOf(0, 43),
                intArrayOf(0, 50),
                longArrayOf(0, 43)
            ),
            "heavy" to VibrationPattern(
                longArrayOf(0, 60),
                intArrayOf(0, 70),
                longArrayOf(0, 61)
            )
        )

        private val selectionPattern = VibrationPattern(
            timings = longArrayOf(0, 50),
            amplitudes = intArrayOf(0, 30),
            oldSdkPattern = longArrayOf(0, 70)
        )
    }
}
