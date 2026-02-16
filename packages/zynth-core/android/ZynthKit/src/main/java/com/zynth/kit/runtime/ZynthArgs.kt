package com.zynth.kit.runtime

import org.json.JSONObject
import org.json.JSONArray

class ZynthTypeException(message: String) : Exception(message)

class ZynthArgs(private val args: Any?) {

    private fun getJSONObject(): JSONObject {
        if (args is JSONObject) return args
        if (args is Map<*, *>) return JSONObject(args)
        if (args is Array<*>) {
            if (args.size == 1) {
                val first = args[0]
                if (first is JSONObject) return first
                if (first is Map<*, *>) return JSONObject(first as Map<*, *>)
            }

            // Fallback: If we're calling keyed access on an array, maybe the caller
            // meant the first object in that array (common in JSI bridges)
            if (args.size > 0 && args[0] is JSONObject) return args[0] as JSONObject
        }
        if (args == null) return JSONObject()
        return JSONObject() // Return empty object instead of throwing to be more permissive with missing args
    }

    private fun getJSONArray(): JSONArray {
        if (args is JSONArray) return args
        if (args is Array<*>) return JSONArray(args.toList())
        if (args is List<*>) return JSONArray(args)
        if (args == null) return JSONArray()
        throw ZynthTypeException("Expected JSONArray for arguments, got ${args::class.java.simpleName}")
    }

    fun getString(key: String): String {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        val value = if (json.isNull(key)) null else json.optString(key)
        return value ?: throw ZynthTypeException("Invalid type for argument '$key': expected String")
    }

    fun getString(key: String, default: String): String {
        return try { getString(key) } catch (e: ZynthTypeException) { default }
    }

    fun getOptionalString(key: String): String? {
        return try { getString(key) } catch (e: ZynthTypeException) { null }
    }

    fun getDouble(key: String): Double {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        val value = json.opt(key)
        return when (value) {
            is Double -> value
            is Float -> value.toDouble()
            is Int -> value.toDouble()
            is Long -> value.toDouble()
            is Number -> value.toDouble()
            else -> throw ZynthTypeException("Invalid type for argument '$key': expected Number")
        }
    }

    fun getDouble(key: String, default: Double): Double {
        return try { getDouble(key) } catch (e: ZynthTypeException) { default }
    }

    fun getInt(key: String): Int {
        return getDouble(key).toInt()
    }

    fun getInt(key: String, default: Int): Int {
        return try { getInt(key) } catch (e: ZynthTypeException) { default }
    }

    fun getLong(key: String): Long {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        return json.optLong(key, -1L).takeIf { it != -1L } ?: throw ZynthTypeException("Invalid type for argument '$key': expected Long/Number")
    }

    fun getLong(key: String, default: Long): Long {
        return try { getLong(key) } catch (e: ZynthTypeException) { default }
    }

    fun getOptionalLong(key: String): Long? {
        val json = getJSONObject()
        if (!json.has(key)) return null
        val value = json.opt(key)
        return (value as? Number)?.toLong()
    }

    fun has(key: String): Boolean {
        return getJSONObject().has(key)
    }

    fun getAny(key: String): Any? {
        val json = getJSONObject()
        if (!json.has(key)) return null
        val value = json.opt(key)
        return if (value == JSONObject.NULL) null else value
    }

    fun getBoolean(key: String): Boolean {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        val value = json.opt(key)
        return value as? Boolean ?: throw ZynthTypeException("Invalid type for argument '$key': expected Boolean")
    }

    fun getBoolean(key: String, default: Boolean): Boolean {
        return try { getBoolean(key) } catch (e: ZynthTypeException) { default }
    }

    fun getMap(key: String): Map<String, Any?> {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        val value = json.optJSONObject(key) ?: throw ZynthTypeException("Invalid type for argument '$key': expected Map/Object")
        return jsonToMap(value)
    }

    fun getList(key: String): List<Any?> {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        val value = json.optJSONArray(key) ?: throw ZynthTypeException("Invalid type for argument '$key': expected List/Array")
        return jsonToList(value)
    }

    // Index-based accessors (if args is an array)
    fun getStringAt(index: Int): String {
        val array = getJSONArray()
        if (index >= array.length()) throw ZynthTypeException("Missing required argument at index $index")
        val value = if (array.isNull(index)) null else array.optString(index)
        return value ?: throw ZynthTypeException("Invalid type at index $index: expected String")
    }

    fun getDoubleAt(index: Int): Double {
        val array = getJSONArray()
        if (index >= array.length()) throw ZynthTypeException("Missing required argument at index $index")
        val value = array.opt(index)
        return when (value) {
            is Double -> value
            is Float -> value.toDouble()
            is Int -> value.toDouble()
            is Long -> value.toDouble()
            is Number -> value.toDouble()
            else -> throw ZynthTypeException("Invalid type at index $index: expected Number")
        }
    }

    fun getIntAt(index: Int): Int {
        return getDoubleAt(index).toInt()
    }

    fun getBooleanAt(index: Int): Boolean {
        val array = getJSONArray()
        if (index >= array.length()) throw ZynthTypeException("Missing required argument at index $index")
        val value = array.opt(index)
        return value as? Boolean ?: throw ZynthTypeException("Invalid type at index $index: expected Boolean")
    }

    fun getMapAt(index: Int): Map<String, Any?> {
        val array = getJSONArray()
        if (index >= array.length()) throw ZynthTypeException("Missing required argument at index $index")
        val value = array.optJSONObject(index) ?: throw ZynthTypeException("Invalid type at index $index: expected Map/Object")
        return jsonToMap(value)
    }

    fun getListAt(index: Int): List<Any?> {
        val array = getJSONArray()
        if (index >= array.length()) throw ZynthTypeException("Missing required argument at index $index")
        val value = array.optJSONArray(index) ?: throw ZynthTypeException("Invalid type at index $index: expected List/Array")
        return jsonToList(value)
    }

    fun nestedAt(index: Int): ZynthArgs {
        val array = getJSONArray()
        if (index >= array.length()) throw ZynthTypeException("Missing required argument at index $index")
        return ZynthArgs(array.opt(index))
    }

    fun nested(key: String): ZynthArgs {
        val json = getJSONObject()
        if (!json.has(key)) throw ZynthTypeException("Missing required argument: $key")
        return ZynthArgs(json.opt(key))
    }

    fun asMap(): Map<String, Any?> {
        return jsonToMap(getJSONObject())
    }

    fun asArray(): Array<Any?> {
        val json = getJSONArray()
        return Array(json.length()) { i -> 
            val value = json.opt(i)
            if (value is JSONObject) jsonToMap(value)
            else if (value is JSONArray) jsonToList(value)
            else if (value == JSONObject.NULL) null
            else value
        }
    }

    private fun jsonToMap(json: JSONObject): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        val keys = json.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            var value = json.opt(key)
            if (value is JSONObject) {
                value = jsonToMap(value)
            } else if (value is JSONArray) {
                value = jsonToList(value)
            } else if (value == JSONObject.NULL) {
                value = null
            }
            map[key] = value
        }
        return map
    }

    private fun jsonToList(json: JSONArray): List<Any?> {
        val list = mutableListOf<Any?>()
        for (i in 0 until json.length()) {
            var value = json.opt(i)
            if (value is JSONObject) {
                value = jsonToMap(value)
            } else if (value is JSONArray) {
                value = jsonToList(value)
            } else if (value == JSONObject.NULL) {
                value = null
            }
            list.add(value)
        }
        return list
    }
}

