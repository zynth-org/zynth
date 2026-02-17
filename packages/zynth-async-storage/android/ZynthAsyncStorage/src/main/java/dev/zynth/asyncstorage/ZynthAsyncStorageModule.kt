package dev.zynth.asyncstorage

import android.content.Context
import android.content.SharedPreferences
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONArray
import org.json.JSONObject

class ZynthAsyncStorageModule(
    context: Context
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthAsyncStorage"
    private val storage = ZynthAsyncStorageStore(context)

    override val exportedMethods: List<String> = listOf(
        "getItem", "setItem", "removeItem", "mergeItem", "clear",
        "getAllKeys", "multiGet", "multiSet", "multiRemove", "multiMerge"
    )

    override val protectedMethods: List<String> = listOf(
        "setItem", "removeItem", "mergeItem", "clear", "multiSet", "multiRemove", "multiMerge"
    )

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getItem" -> {
                val key = args.getString("key")
                resultResponse(storage.getItem(key))
            }
            "setItem" -> {
                val key = args.getString("key")
                val value = args.getString("value")
                storage.setItem(key, value)
                resultResponse(null)
            }
            "removeItem" -> {
                val key = args.getString("key")
                storage.removeItem(key)
                resultResponse(null)
            }
            "mergeItem" -> {
                val key = args.getString("key")
                val value = args.getString("value")
                storage.mergeItem(key, value)
                resultResponse(null)
            }
            "clear" -> {
                storage.clear()
                resultResponse(null)
            }
            "getAllKeys" -> resultResponse(storage.getAllKeys())
            "multiGet" -> {
                val keys = args.getList("keys").mapNotNull { it as? String }
                resultResponse(storage.multiGet(keys))
            }
            "multiSet" -> {
                val pairs = parsePairs(args.getList("pairs"))
                storage.multiSet(pairs)
                resultResponse(null)
            }
            "multiRemove" -> {
                val keys = args.getList("keys").mapNotNull { it as? String }
                storage.multiRemove(keys)
                resultResponse(null)
            }
            "multiMerge" -> {
                val pairs = parsePairs(args.getList("pairs"))
                storage.multiMerge(pairs)
                resultResponse(null)
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getItem" -> storage.getItem(args.getString("key"))
            "setItem" -> {
                storage.setItem(args.getString("key"), args.getString("value"))
                null
            }
            "removeItem" -> {
                storage.removeItem(args.getString("key"))
                null
            }
            "mergeItem" -> {
                storage.mergeItem(args.getString("key"), args.getString("value"))
                null
            }
            "clear" -> {
                storage.clear()
                null
            }
            "getAllKeys" -> storage.getAllKeys()
            "multiGet" -> {
                storage.multiGet(args.getList("keys").mapNotNull { it as? String })
            }
            "multiSet" -> {
                storage.multiSet(parsePairs(args.getList("pairs")))
                null
            }
            "multiRemove" -> {
                storage.multiRemove(args.getList("keys").mapNotNull { it as? String })
                null
            }
            "multiMerge" -> {
                storage.multiMerge(parsePairs(args.getList("pairs")))
                null
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun parsePairs(value: List<Any?>): List<Pair<String, String>> {
        val result = mutableListOf<Pair<String, String>>()
        for (entry in value) {
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
}

private class ZynthAsyncStorageStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("zynth_async_storage", Context.MODE_PRIVATE)

    fun getItem(key: String?): String? {
        if (key == null) return null
        return prefs.getString(key, null)
    }

    fun setItem(key: String, value: String) {
        if (!prefs.edit().putString(key, value).commit()) {
            throw java.io.IOException("Failed to persist item to storage")
        }
    }

    fun removeItem(key: String) {
        if (!prefs.edit().remove(key).commit()) {
            throw java.io.IOException("Failed to remove item from storage")
        }
    }

    fun mergeItem(key: String, value: String) {
        val existing = prefs.getString(key, null)
        val merged = mergeJson(existing, value)
        if (!prefs.edit().putString(key, merged).commit()) {
            throw java.io.IOException("Failed to merge item in storage")
        }
    }

    fun clear() {
        if (!prefs.edit().clear().commit()) {
            throw java.io.IOException("Failed to clear storage")
        }
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
        if (!editor.commit()) {
            throw java.io.IOException("Failed to persist multiple items to storage")
        }
    }

    fun multiRemove(keys: List<String>) {
        val editor = prefs.edit()
        for (key in keys) {
            editor.remove(key)
        }
        if (!editor.commit()) {
            throw java.io.IOException("Failed to remove multiple items from storage")
        }
    }

    fun multiMerge(pairs: List<Pair<String, String>>) {
        val editor = prefs.edit()
        for ((key, value) in pairs) {
            val existing = prefs.getString(key, null)
            val merged = mergeJson(existing, value)
            editor.putString(key, merged)
        }
        if (!editor.commit()) {
            throw java.io.IOException("Failed to merge multiple items in storage")
        }
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
