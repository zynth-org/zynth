package com.zynth.kit.core

import android.graphics.Color
import androidx.core.graphics.ColorUtils
import java.util.Locale
import kotlin.math.roundToInt

object ZynthColorParser {
    private val NAMED_COLORS = mapOf(
        "aliceblue" to 0xfff0f8ff.toInt(),
        "antiquewhite" to 0xfffaebd7.toInt(),
        "aqua" to 0xff00ffff.toInt(),
        "aquamarine" to 0xff7fffd4.toInt(),
        "azure" to 0xfff0ffff.toInt(),
        "beige" to 0xfff5f5dc.toInt(),
        "bisque" to 0xffffe4c4.toInt(),
        "black" to 0xff000000.toInt(),
        "blanchedalmond" to 0xffffebcd.toInt(),
        "blue" to 0xff0000ff.toInt(),
        "blueviolet" to 0xff8a2be2.toInt(),
        "brown" to 0xffa52a2a.toInt(),
        "burlywood" to 0xffdeb887.toInt(),
        "cadetblue" to 0xff5f9ea0.toInt(),
        "chartreuse" to 0xff7fff00.toInt(),
        "chocolate" to 0xffd2691e.toInt(),
        "coral" to 0xffff7f50.toInt(),
        "cornflowerblue" to 0xff6495ed.toInt(),
        "cornsilk" to 0xfffff8dc.toInt(),
        "crimson" to 0xffdc143c.toInt(),
        "cyan" to 0xff00ffff.toInt(),
        "darkblue" to 0xff00008b.toInt(),
        "darkcyan" to 0xff008b8b.toInt(),
        "darkgoldenrod" to 0xffb8860b.toInt(),
        "darkgray" to 0xffa9a9a9.toInt(),
        "darkgreen" to 0xff006400.toInt(),
        "darkgrey" to 0xffa9a9a9.toInt(),
        "darkkhaki" to 0xffbdb76b.toInt(),
        "darkmagenta" to 0xff8b008b.toInt(),
        "darkolivegreen" to 0xff556b2f.toInt(),
        "darkorange" to 0xffff8c00.toInt(),
        "darkorchid" to 0xff9932cc.toInt(),
        "darkred" to 0xff8b0000.toInt(),
        "darksalmon" to 0xffe9967a.toInt(),
        "darkseagreen" to 0xff8fbc8f.toInt(),
        "darkslateblue" to 0xff483d8b.toInt(),
        "darkslategrey" to 0xff2f4f4f.toInt(),
        "darkturquoise" to 0xff00ced1.toInt(),
        "darkviolet" to 0xff9400d3.toInt(),
        "deeppink" to 0xffff1493.toInt(),
        "deepskyblue" to 0xff00bfff.toInt(),
        "dimgray" to 0xff696969.toInt(),
        "dimgrey" to 0xff696969.toInt(),
        "dodgerblue" to 0xff1e90ff.toInt(),
        "firebrick" to 0xffb22222.toInt(),
        "floralwhite" to 0xfffffaf0.toInt(),
        "forestgreen" to 0xff228b22.toInt(),
        "fuchsia" to 0xffff00ff.toInt(),
        "gainsboro" to 0xffdcdcdc.toInt(),
        "ghostwhite" to 0xfff8f8ff.toInt(),
        "gold" to 0xffffd700.toInt(),
        "goldenrod" to 0xffdaa520.toInt(),
        "gray" to 0xff808080.toInt(),
        "green" to 0xff008000.toInt(),
        "greenyellow" to 0xffadff2f.toInt(),
        "grey" to 0xff808080.toInt(),
        "honeydew" to 0xfff0fff0.toInt(),
        "hotpink" to 0xffff69b4.toInt(),
        "indianred" to 0xffcd5c5c.toInt(),
        "indigo" to 0xff4b0082.toInt(),
        "ivory" to 0xfffffff0.toInt(),
        "khaki" to 0xfff0e68c.toInt(),
        "lavender" to 0xffe6e6fa.toInt(),
        "lavenderblush" to 0xfffff0f5.toInt(),
        "lawngreen" to 0xff7cfc00.toInt(),
        "lemonchiffon" to 0xfffffacd.toInt(),
        "lightblue" to 0xffadd8e6.toInt(),
        "lightcoral" to 0xfff08080.toInt(),
        "lightcyan" to 0xffe0ffff.toInt(),
        "lightgoldenrodyellow" to 0xfffafad2.toInt(),
        "lightgray" to 0xffd3d3d3.toInt(),
        "lightgreen" to 0xff90ee90.toInt(),
        "lightgrey" to 0xffd3d3d3.toInt(),
        "lightpink" to 0xffffb6c1.toInt(),
        "lightsalmon" to 0xffffa07a.toInt(),
        "lightseagreen" to 0xff20b2aa.toInt(),
        "lightskyblue" to 0xff87cefa.toInt(),
        "lightslategrey" to 0xff778899.toInt(),
        "lightsteelblue" to 0xffb0c4de.toInt(),
        "lightyellow" to 0xffffffe0.toInt(),
        "lime" to 0xff00ff00.toInt(),
        "limegreen" to 0xff32cd32.toInt(),
        "linen" to 0xfffaf0e6.toInt(),
        "magenta" to 0xffff00ff.toInt(),
        "maroon" to 0xff800000.toInt(),
        "mediumaquamarine" to 0xff66cdaa.toInt(),
        "mediumblue" to 0xff0000cd.toInt(),
        "mediumorchid" to 0xffba55d3.toInt(),
        "mediumpurple" to 0xff9370db.toInt(),
        "mediumseagreen" to 0xff3cb371.toInt(),
        "mediumslateblue" to 0xff7b68ee.toInt(),
        "mediumspringgreen" to 0xff00fa9a.toInt(),
        "mediumturquoise" to 0xff48d1cc.toInt(),
        "mediumvioletred" to 0xffc71585.toInt(),
        "midnightblue" to 0xff191970.toInt(),
        "mintcream" to 0xfff5fffa.toInt(),
        "mistyrose" to 0xffffe4e1.toInt(),
        "moccasin" to 0xffffe4b5.toInt(),
        "navajowhite" to 0xffffdead.toInt(),
        "navy" to 0xff000080.toInt(),
        "oldlace" to 0xfffdf5e6.toInt(),
        "olive" to 0xff808000.toInt(),
        "olivedrab" to 0xff6b8e23.toInt(),
        "orange" to 0xffffa500.toInt(),
        "orangered" to 0xffff4500.toInt(),
        "orchid" to 0xffda70d6.toInt(),
        "palegoldenrod" to 0xffeee8aa.toInt(),
        "palegreen" to 0xff98fb98.toInt(),
        "paleturquoise" to 0xffafeeee.toInt(),
        "palevioletred" to 0xffdb7093.toInt(),
        "papayawhip" to 0xffffefd5.toInt(),
        "peachpuff" to 0xffffdab9.toInt(),
        "peru" to 0xffcd853f.toInt(),
        "pink" to 0xffffc0cb.toInt(),
        "plum" to 0xffdda0dd.toInt(),
        "powderblue" to 0xffb0e0e6.toInt(),
        "purple" to 0xff800080.toInt(),
        "rebeccapurple" to 0xff663399.toInt(),
        "red" to 0xffff0000.toInt(),
        "rosybrown" to 0xffbc8f8f.toInt(),
        "royalblue" to 0xff4169e1.toInt(),
        "saddlebrown" to 0xff8b4513.toInt(),
        "salmon" to 0xfffa8072.toInt(),
        "sandybrown" to 0xfff4a460.toInt(),
        "seagreen" to 0xff2e8b57.toInt(),
        "seashell" to 0xfffff5ee.toInt(),
        "sienna" to 0xffa0522d.toInt(),
        "silver" to 0xffc0c0c0.toInt(),
        "skyblue" to 0xff87ceeb.toInt(),
        "slateblue" to 0xff6a5acd.toInt(),
        "slategray" to 0xff708090.toInt(),
        "snow" to 0xfffffafa.toInt(),
        "springgreen" to 0xff00ff7f.toInt(),
        "steelblue" to 0xff4682b4.toInt(),
        "tan" to 0xffd2b48c.toInt(),
        "teal" to 0xff008080.toInt(),
        "thistle" to 0xffd8bfd8.toInt(),
        "tomato" to 0xffff6347.toInt(),
        "turquoise" to 0xff40e0d0.toInt(),
        "violet" to 0xffee82ee.toInt(),
        "wheat" to 0xfff5deb3.toInt(),
        "white" to 0xffffffff.toInt(),
        "whitesmoke" to 0xfff5f5f5.toInt(),
        "yellow" to 0xffffff00.toInt(),
        "yellowgreen" to 0xff9acd32.toInt(),
        "transparent" to 0x00000000
    )

    // rgb(r, g, b) or rgba(r, g, b, a)
    // Supports spaces, commas, and optional alpha
    private val RGB_REGEX = Regex("""^rgba?\(\s*([0-9]+)\s*(?:,|\s)\s*([0-9]+)\s*(?:,|\s)\s*([0-9]+)\s*(?:[,/]\s*([0-9]*\.?[0-9]+%?))?\s*\)$""", RegexOption.IGNORE_CASE)
    
    // hsl(h, s, l) or hsla(h, s, l, a)
    private val HSL_REGEX = Regex("""^hsla?\(\s*([0-9]+(?:deg)?)\s*(?:,|\s)\s*([0-9.]+%)\s*(?:,|\s)\s*([0-9.]+%)\s*(?:[,/]\s*([0-9]*\.?[0-9]+%?))?\s*\)$""", RegexOption.IGNORE_CASE)
    
    // hwb(h, w, b, a?)
    private val HWB_REGEX = Regex("""^hwb\(\s*([0-9]+(?:deg)?)\s*(?:,|\s)\s*([0-9.]+%)\s*(?:,|\s)\s*([0-9.]+%)\s*(?:[,/]\s*([0-9]*\.?[0-9]+%?))?\s*\)$""", RegexOption.IGNORE_CASE)

    fun parse(color: String?): Int? {
        if (color.isNullOrBlank()) return null
        val trimmed = color.trim()

        // 1. Hex Color
        if (trimmed.startsWith("#")) {
            return parseHex(trimmed)
        }

        // 2. Named Color
        val lower = trimmed.lowercase(Locale.ROOT)
        if (NAMED_COLORS.containsKey(lower)) {
            return NAMED_COLORS[lower]
        }

        // 3. Functional Syntax
        return when {
            trimmed.startsWith("rgb", ignoreCase = true) -> parseRgb(trimmed)
            trimmed.startsWith("hsl", ignoreCase = true) -> parseHsl(trimmed)
            trimmed.startsWith("hwb", ignoreCase = true) -> parseHwb(trimmed)
            else -> null
        }
    }

    private fun parseHex(hex: String): Int? {
        var raw = hex.substring(1)
        return try {
            when (raw.length) {
                3 -> {
                    // #RGB -> #RRGGBB
                    val r = raw[0]
                    val g = raw[1]
                    val b = raw[2]
                    Color.parseColor("#$r$r$g$g$b$b")
                }
                4 -> {
                    // #RGBA -> #RRGGBBAA
                    val r = raw[0]
                    val g = raw[1]
                    val b = raw[2]
                    val a = raw[3]
                    Color.parseColor("#$a$a$r$r$g$g$b$b")
                }
                6 -> {
                    // #RRGGBB
                    Color.parseColor(hex)
                }
                8 -> {
                    // #RRGGBBAA in Web/CSS
                    // Android Color.parseColor expects #AARRGGBB
                    // We need to rotate: RRGGBBAA -> AARRGGBB
                    val r = raw.substring(0, 2)
                    val g = raw.substring(2, 4)
                    val b = raw.substring(4, 6)
                    val a = raw.substring(6, 8)
                    Color.parseColor("#$a$r$g$b")
                }
                else -> null
            }
        } catch (e: IllegalArgumentException) {
            null
        }
    }

    private fun parseRgb(value: String): Int? {
        val match = RGB_REGEX.matchEntire(value) ?: return null
        val (rStr, gStr, bStr) = match.destructured
        val aStr = match.groups[4]?.value

        val r = rStr.toInt().coerceIn(0, 255)
        val g = gStr.toInt().coerceIn(0, 255)
        val b = bStr.toInt().coerceIn(0, 255)
        val a = parseAlpha(aStr)

        return Color.argb(a, r, g, b)
    }

    private fun parseHsl(value: String): Int? {
        val match = HSL_REGEX.matchEntire(value) ?: return null
        val (hStr, sStr, lStr) = match.destructured
        val aStr = match.groups[4]?.value

        val h = parseDegrees(hStr)
        val s = parsePercentage(sStr)
        val l = parsePercentage(lStr)
        val a = parseAlpha(aStr)

        return ColorUtils.HSLToColor(floatArrayOf(h, s, l)).let {
             Color.argb(a, Color.red(it), Color.green(it), Color.blue(it))
        }
    }
    
    private fun parseHwb(value: String): Int? {
        val match = HWB_REGEX.matchEntire(value) ?: return null
        val (hStr, wStr, bStr) = match.destructured
        val aStr = match.groups[4]?.value
        
        val h = parseDegrees(hStr)
        val w = parsePercentage(wStr)
        val b = parsePercentage(bStr)
        val a = parseAlpha(aStr)
        
        if (w + b >= 1f) {
            val gray = ((w / (w + b)) * 255).roundToInt()
            return Color.argb(a, gray, gray, gray)
        }
        
        // HWB to RGB conversion
        // 1. Get RGB from HSL with (H, 100%, 50%) -> Pure saturated color
        val rgb = ColorUtils.HSLToColor(floatArrayOf(h, 1f, 0.5f))
        val rBase = Color.red(rgb) / 255f
        val gBase = Color.green(rgb) / 255f
        val bBase = Color.blue(rgb) / 255f
        
        // 2. Scale by whiteness and blackness
        // rgb = rgb * (1 - w - b) + w
        val factor = 1f - w - b
        val r = ((rBase * factor) + w) * 255
        val g = ((gBase * factor) + w) * 255
        val bl = ((bBase * factor) + w) * 255
        
        return Color.argb(a, r.roundToInt(), g.roundToInt(), bl.roundToInt())
    }

    private fun parseAlpha(alphaStr: String?): Int {
        if (alphaStr.isNullOrBlank()) return 255
        return if (alphaStr.endsWith("%")) {
            (alphaStr.dropLast(1).toFloat() / 100f * 255).roundToInt().coerceIn(0, 255)
        } else {
            (alphaStr.toFloat() * 255).roundToInt().coerceIn(0, 255)
        }
    }
    
    private fun parsePercentage(str: String): Float {
        return if (str.endsWith("%")) {
             str.dropLast(1).toFloat() / 100f
        } else {
             0f // HSL/HWB usually require % for S/L/W/B in CSS, but we can be lenient or strict
        }.coerceIn(0f, 1f)
    }

    private fun parseDegrees(str: String): Float {
        val raw = str.lowercase().removeSuffix("deg")
        return raw.toFloat() % 360f
    }
}
