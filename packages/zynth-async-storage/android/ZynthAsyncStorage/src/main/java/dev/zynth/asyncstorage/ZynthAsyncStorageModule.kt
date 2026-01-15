package dev.zynth.asyncstorage

import android.content.Context
import android.content.SharedPreferences
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONArray
import org.json.JSONObject

class ZynthAsyncStorageModule(
    context: Context
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthAsyncStorage"
    private val storage = ZynthAsyncStorageStore(context)

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "getItem" -> {
                val key = getStringArg(args, "key")
                if (key == null) {
                    errorResponse("invalid_argument", "key")
                } else {
                    resultResponse(storage.getItem(key))
                }
            }
            "setItem" -> {
                val key = getStringArg(args, "key")
                val value = getStringArg(args, "value")
                if (key == null || value == null) {
                    errorResponse("invalid_argument", "key/value")
                } else {
                    storage.setItem(key, value)
                    successResponse()
                }
            }
            "removeItem" -> {
                val key = getStringArg(args, "key")
                if (key == null) {
                    errorResponse("invalid_argument", "key")
                } else {
                    storage.removeItem(key)
                    successResponse()
                }
            }
            "mergeItem" -> {
                val key = getStringArg(args, "key")
                val value = getStringArg(args, "value")
                if (key == null || value == null) {
                    errorResponse("invalid_argument", "key/value")
                } else {
                    storage.mergeItem(key, value)
                    successResponse()
                }
            }
            "clear" -> {
                storage.clear()
                successResponse()
            }
            "getAllKeys" -> resultResponse(storage.getAllKeys())
            "multiGet" -> {
                val keys = getStringArrayArg(args, "keys")
                if (keys == null) {
                    errorResponse("invalid_argument", "keys")
                } else {
                    resultResponse(storage.multiGet(keys))
                }
            }
            "multiSet" -> {
                val pairs = getPairsArg(args, "pairs")
                if (pairs == null) {
                    errorResponse("invalid_argument", "pairs")
                } else {
                    storage.multiSet(pairs)
                    successResponse()
                }
            }
            "multiRemove" -> {
                val keys = getStringArrayArg(args, "keys")
                if (keys == null) {
                    errorResponse("invalid_argument", "keys")
                } else {
                    storage.multiRemove(keys)
                    successResponse()
                }
            }
            "multiMerge" -> {
                val pairs = getPairsArg(args, "pairs")
                if (pairs == null) {
                    errorResponse("invalid_argument", "pairs")
                } else {
                    storage.multiMerge(pairs)
                    successResponse()
                }
            }
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "getItem" -> storage.getItem(getStringArg(args, "key"))
            "setItem" -> {
                val key = getStringArg(args, "key")
                val value = getStringArg(args, "value")
                if (key != null && value != null) {
                    storage.setItem(key, value)
                }
                null
            }
            "removeItem" -> {
                val key = getStringArg(args, "key")
                if (key != null) {
                    storage.removeItem(key)
                }
                null
            }
            "mergeItem" -> {
                val key = getStringArg(args, "key")
                val value = getStringArg(args, "value")
                if (key != null && value != null) {
                    storage.mergeItem(key, value)
                }
                null
            }
            "clear" -> {
                storage.clear()
                null
            }
            "getAllKeys" -> storage.getAllKeys()
            "multiGet" -> {
                val keys = getStringArrayArg(args, "keys")
                if (keys == null) {
                    null
                } else {
                    storage.multiGet(keys)
                }
            }
            "multiSet" -> {
                val pairs = getPairsArg(args, "pairs")
                if (pairs != null) {
                    storage.multiSet(pairs)
                }
                null
            }
            "multiRemove" -> {
                val keys = getStringArrayArg(args, "keys")
                if (keys != null) {
                    storage.multiRemove(keys)
                }
                null
            }
            "multiMerge" -> {
                val pairs = getPairsArg(args, "pairs")
                if (pairs != null) {
                    storage.multiMerge(pairs)
                }
                null
            }
            else -> null
        }
    }

    private fun getParams(args: Array<Any?>): Any? {
        return args.getOrNull(0)
    }

    private fun getStringArg(args: Array<Any?>, key: String): String? {
        val params = getParams(args)
        return when (params) {
            is JSONObject -> {
                val value = params.opt(key)
                if (value == JSONObject.NULL) null else value as? String
            }
            is Map<*, *> -> params[key] as? String
            else -> null
        }
    }

    private fun getStringArrayArg(args: Array<Any?>, key: String): List<String>? {
        val params = getParams(args)
        val value = when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
        return when (value) {
            is JSONArray -> {
                val result = mutableListOf<String>()
                for (i in 0 until value.length()) {
                    val entry = value.opt(i)
                    if (entry is String) {
                        result.add(entry)
                    }
                }
                result
            }
            is Array<*> -> value.mapNotNull { it as? String }
            is List<*> -> value.mapNotNull { it as? String }
            else -> null
        }
    }

    private fun getPairsArg(args: Array<Any?>, key: String): List<Pair<String, String>>? {
        val params = getParams(args)
        val value = when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
        return parsePairs(value)
    }

    private fun parsePairs(value: Any?): List<Pair<String, String>>? {
        val entries = when (value) {
            is JSONArray -> {
                val list = mutableListOf<Any?>()
                for (i in 0 until value.length()) {
                    list.add(value.opt(i))
                }
                list
            }
            is Array<*> -> value.toList()
            is List<*> -> value
            else -> null
        } ?: return null

        val result = mutableListOf<Pair<String, String>>()
        for (entry in entries) {
            val pair = parsePair(entry)
            if (pair != null) {
                result.add(pair)
            }
        }
        return result
    }

    private fun parsePair(value: Any?): Pair<String, String>? {
        return when (value) {
            is JSONArray -> {
                if (value.length() >= 2) {
                    val key = value.opt(0)
                    val valValue = value.opt(1)
                    if (key is String && valValue is String) {
                        key to valValue
                    } else {
                        null
                    }
                } else {
                    null
                }
            }
            is Array<*> -> {
                if (value.size >= 2) {
                    val key = value[0] as? String
                    val valValue = value[1] as? String
                    if (key != null && valValue != null) {
                        key to valValue
                    } else {
                        null
                    }
                } else {
                    null
                }
            }
            is List<*> -> {
                if (value.size >= 2) {
                    val key = value[0] as? String
                    val valValue = value[1] as? String
                    if (key != null && valValue != null) {
                        key to valValue
                    } else {
                        null
                    }
                } else {
                    null
                }
            }
            is JSONObject -> {
                val key = value.opt("key") as? String
                val valValue = value.opt("value") as? String
                if (key != null && valValue != null) {
                    key to valValue
                } else {
                    null
                }
            }
            is Map<*, *> -> {
                val key = value["key"] as? String
                val valValue = value["value"] as? String
                if (key != null && valValue != null) {
                    key to valValue
                } else {
                    null
                }
            }
            else -> null
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().apply {
            put("result", result ?: JSONObject.NULL)
        }
    }

    private fun successResponse(): JSONObject {
        return JSONObject().apply {
            put("success", true)
        }
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().apply {
            put("error", error)
            put("message", message)
        }
    }
}

private class ZynthAsyncStorageStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("zynth_async_storage", Context.MODE_PRIVATE)

    fun getItem(key: String?): String? {
        if (key == null) return null
        return prefs.getString(key, null)
    }

    fun setItem(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun removeItem(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun mergeItem(key: String, value: String) {
        val existing = prefs.getString(key, null)
        val merged = mergeJson(existing, value)
        prefs.edit().putString(key, merged).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun getAllKeys(): JSONArray {
        val keys = prefs.all.keys
        val array = JSONArray()
        for (key in keys) {
            array.put(key)
        }
        return array
    }

    fun multiGet(keys: List<String>): JSONArray {
        val result = JSONArray()
        for (key in keys) {
            val entry = JSONArray()
            entry.put(key)
            entry.put(prefs.getString(key, null))
            result.put(entry)
        }
        return result
    }

    fun multiSet(pairs: List<Pair<String, String>>) {
        val editor = prefs.edit()
        for ((key, value) in pairs) {
            editor.putString(key, value)
        }
        editor.apply()
    }

    fun multiRemove(keys: List<String>) {
        val editor = prefs.edit()
        for (key in keys) {
            editor.remove(key)
        }
        editor.apply()
    }

    fun multiMerge(pairs: List<Pair<String, String>>) {
        val editor = prefs.edit()
        for ((key, value) in pairs) {
            val existing = prefs.getString(key, null)
            val merged = mergeJson(existing, value)
            editor.putString(key, merged)
        }
        editor.apply()
    }

    private fun mergeJson(existing: String?, update: String): String {
        val updateObject = parseJsonObject(update) ?: return update
        val existingObject = parseJsonObject(existing) ?: return update
        val merged = deepMerge(existingObject, updateObject)
        return merged.toString()
    }

    private fun parseJsonObject(value: String?): JSONObject? {
        if (value == null) return null
        return try {
            JSONObject(value)
        } catch (_: Exception) {
            null
        }
    }

    private fun deepMerge(base: JSONObject, update: JSONObject): JSONObject {
        val result = JSONObject(base.toString())
        val keys = update.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val updateValue = update.opt(key)
            val baseValue = result.opt(key)
            if (updateValue is JSONObject && baseValue is JSONObject) {
                result.put(key, deepMerge(baseValue, updateValue))
            } else {
                result.put(key, updateValue)
            }
        }
        return result
    }
}
