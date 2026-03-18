package dev.zynth.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import android.util.Log
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Native UI utility module.
 *
 * Add generic UI-level native helpers here as they are introduced.
 */
class ZynthUIModule : ZynthModule, ZynthSyncModule {
    companion object {
        private const val TAG = "ZynthUI.QR"
    }

    override val name: String = "ZynthUI"

    override val exportedMethods: List<String> = listOf("generateQRCode")

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "generateQRCode" -> resultResponse(generateQRCodeObject(args))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any {
        return when (method) {
            "generateQRCode" -> {
                val result = generateQRCodeObject(args)
                Log.d(
                    TAG,
                    "callSync generateQRCode -> keys=${result.keys().asSequence().toList()} " +
                        "hasImageData=${result.optString("imageData").isNotBlank()} " +
                        "mime=${result.optString("mimeType")} " +
                        "width=${result.optInt("width")} height=${result.optInt("height")}"
                )
                result
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun generateQRCodeObject(args: ZynthArgs): JSONObject {
        val size = args.getInt("size", 192).coerceAtLeast(1)
        val matrix = parseMatrix(args)
        val moduleCount = matrix.size
        if (moduleCount == 0) {
            throw IllegalArgumentException("QR matrix cannot be empty")
        }

        val darkColor = parseColor(args.getString("color", "#000000"), Color.BLACK)
        val lightColor = parseColor(args.getString("backgroundColor", "#FFFFFF"), Color.WHITE)
        Log.d(
            TAG,
            "generateQRCode size=$size moduleCount=$moduleCount " +
                "darkColor=${Integer.toHexString(darkColor)} lightColor=${Integer.toHexString(lightColor)}"
        )

        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(lightColor)

        val modulePixelSize = (size / moduleCount).coerceAtLeast(1)
        val drawSize = modulePixelSize * moduleCount
        val drawOffset = ((size - drawSize) / 2).coerceAtLeast(0)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = darkColor
            style = Paint.Style.FILL
        }

        for (row in 0 until moduleCount) {
            val values = matrix[row]
            var col = 0
            while (col < values.size) {
                if (!values[col]) {
                    col += 1
                    continue
                }
                val start = col
                while (col < values.size && values[col]) {
                    col += 1
                }
                val left = drawOffset + start * modulePixelSize
                val top = drawOffset + row * modulePixelSize
                val width = (col - start) * modulePixelSize
                canvas.drawRect(
                    left.toFloat(),
                    top.toFloat(),
                    (left + width).toFloat(),
                    (top + modulePixelSize).toFloat(),
                    paint,
                )
            }
        }

        val output = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
        bitmap.recycle()

        val bytes = output.toByteArray()
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        Log.d(TAG, "generateQRCode encoded pngBytes=${bytes.size} base64Len=${encoded.length}")

        return JSONObject()
            .put("imageData", encoded)
            .put("mimeType", "image/png")
            .put("width", size)
            .put("height", size)
    }

    private fun parseMatrix(args: ZynthArgs): List<List<Boolean>> {
        val rawRows = args.getList("matrix")
        if (rawRows.isEmpty()) {
            throw IllegalArgumentException("QR matrix cannot be empty")
        }

        val rows = mutableListOf<List<Boolean>>()
        var expectedColumns = -1

        for (rawRow in rawRows) {
            if (rawRow !is List<*>) {
                throw IllegalArgumentException("QR matrix rows must be arrays")
            }
            if (expectedColumns == -1) {
                expectedColumns = rawRow.size
            }
            if (rawRow.size != expectedColumns) {
                throw IllegalArgumentException("QR matrix must be square")
            }

            val parsedRow = mutableListOf<Boolean>()
            for (cell in rawRow) {
                val isDark = when (cell) {
                    is Boolean -> cell
                    is Number -> cell.toInt() != 0
                    else -> false
                }
                parsedRow.add(isDark)
            }
            rows.add(parsedRow)
        }

        if (rows.size != expectedColumns) {
            throw IllegalArgumentException("QR matrix must be square")
        }

        Log.d(TAG, "parseMatrix rows=${rows.size} cols=$expectedColumns")
        return rows
    }

    private fun parseColor(value: String, fallback: Int): Int {
        return try {
            Color.parseColor(value)
        } catch (_: IllegalArgumentException) {
            fallback
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
