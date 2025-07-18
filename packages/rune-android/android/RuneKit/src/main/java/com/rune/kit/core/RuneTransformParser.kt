package com.rune.kit.core

import org.json.JSONArray

sealed class TransformOperation {
    data class Perspective(val value: Float) : TransformOperation()
    data class Rotate(val degrees: Float) : TransformOperation()
    data class RotateX(val degrees: Float) : TransformOperation()
    data class RotateY(val degrees: Float) : TransformOperation()
    data class RotateZ(val degrees: Float) : TransformOperation()
    data class Scale(val x: Float, val y: Float) : TransformOperation()
    data class Translate(val x: Float, val y: Float) : TransformOperation()
    data class SkewX(val degrees: Float) : TransformOperation()
    data class SkewY(val degrees: Float) : TransformOperation()
}

object RuneTransformParser {
    
    fun parse(value: Any?): List<TransformOperation>? {
        if (value == null) return null
        
        return when (value) {
            is JSONArray -> parseArray(value)
            is String -> parseString(value)
            else -> null
        }
    }

    private fun parseArray(json: JSONArray): List<TransformOperation> {
        val ops = mutableListOf<TransformOperation>()
        for (i in 0 until json.length()) {
            val item = json.optJSONObject(i) ?: continue
            val keys = item.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = item.optDouble(key)
                val valueStr = item.optString(key)
                
                when (key) {
                    "perspective" -> ops.add(TransformOperation.Perspective(value.toFloat()))
                    "rotate" -> ops.add(TransformOperation.Rotate(parseAngle(valueStr)))
                    "rotateX" -> ops.add(TransformOperation.RotateX(parseAngle(valueStr)))
                    "rotateY" -> ops.add(TransformOperation.RotateY(parseAngle(valueStr)))
                    "rotateZ" -> ops.add(TransformOperation.RotateZ(parseAngle(valueStr)))
                    "scale" -> ops.add(TransformOperation.Scale(value.toFloat(), value.toFloat()))
                    "scaleX" -> ops.add(TransformOperation.Scale(value.toFloat(), 1f)) // Combined into Scale
                    "scaleY" -> ops.add(TransformOperation.Scale(1f, value.toFloat())) // Combined into Scale
                    "translateX" -> ops.add(TransformOperation.Translate(value.toFloat(), 0f))
                    "translateY" -> ops.add(TransformOperation.Translate(0f, value.toFloat()))
                    "skewX" -> ops.add(TransformOperation.SkewX(parseAngle(valueStr)))
                    "skewY" -> ops.add(TransformOperation.SkewY(parseAngle(valueStr)))
                }
            }
        }
        return ops
    }
    
    private fun parseString(value: String): List<TransformOperation> {
        val ops = mutableListOf<TransformOperation>()
        val regex = Regex("""(\w+)\(([^)]+)\)""")
        regex.findAll(value).forEach { match ->
            val func = match.groupValues[1]
            val args = match.groupValues[2].split(",").map { it.trim() }
            
            when (func) {
                "translate" -> {
                    val x = parseFloat(args.getOrNull(0)) ?: 0f
                    val y = parseFloat(args.getOrNull(1)) ?: 0f
                    ops.add(TransformOperation.Translate(x, y))
                }
                "translateX" -> ops.add(TransformOperation.Translate(parseFloat(args[0]) ?: 0f, 0f))
                "translateY" -> ops.add(TransformOperation.Translate(0f, parseFloat(args[0]) ?: 0f))
                "scale" -> {
                    val x = parseFloat(args.getOrNull(0)) ?: 1f
                    val y = parseFloat(args.getOrNull(1)) ?: x
                    ops.add(TransformOperation.Scale(x, y))
                }
                "scaleX" -> ops.add(TransformOperation.Scale(parseFloat(args[0]) ?: 1f, 1f))
                "scaleY" -> ops.add(TransformOperation.Scale(1f, parseFloat(args[0]) ?: 1f))
                "rotate", "rotateZ" -> ops.add(TransformOperation.RotateZ(parseAngle(args[0])))
                "rotateX" -> ops.add(TransformOperation.RotateX(parseAngle(args[0])))
                "rotateY" -> ops.add(TransformOperation.RotateY(parseAngle(args[0])))
                "skewX" -> ops.add(TransformOperation.SkewX(parseAngle(args[0])))
                "skewY" -> ops.add(TransformOperation.SkewY(parseAngle(args[0])))
                "perspective" -> ops.add(TransformOperation.Perspective(parseFloat(args[0]) ?: 0f))
            }
        }
        return ops
    }

    private fun parseAngle(value: String): Float {
        if (value.endsWith("rad")) {
             return Math.toDegrees(value.removeSuffix("rad").toDouble()).toFloat()
        }
        return value.removeSuffix("deg").toFloatOrNull() ?: 0f
    }

    private fun parseFloat(value: String?): Float? {
         return value?.removeSuffix("px")?.toFloatOrNull()
    }
}
