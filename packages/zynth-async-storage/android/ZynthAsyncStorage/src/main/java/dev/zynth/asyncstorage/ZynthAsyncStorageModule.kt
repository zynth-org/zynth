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
                successResponse()
            }
            "removeItem" -> {
                val key = args.getString("key")
                storage.removeItem(key)
                successResponse()
            }
            "mergeItem" -> {
                val key = args.getString("key")
                val value = args.getString("value")
                storage.mergeItem(key, value)
                successResponse()
            }
            "clear" -> {
                storage.clear()
                successResponse()
            }
            "getAllKeys" -> resultResponse(storage.getAllKeys())
            "multiGet" -> {
                val keys = args.getList("keys").mapNotNull { it as? String }
                resultResponse(storage.multiGet(keys))
            }
            "multiSet" -> {
                val pairs = parsePairs(args.getList("pairs"))
                storage.multiSet(pairs)
                successResponse()
            }
            "multiRemove" -> {
                val keys = args.getList("keys").mapNotNull { it as? String }
                storage.multiRemove(keys)
                successResponse()
            }
            "multiMerge" -> {
                val pairs = parsePairs(args.getList("pairs"))
                storage.multiMerge(pairs)
                successResponse()
            }
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getItem" -> storage.getItem(try { args.getString("key") } catch (e: Exception) { null })
            "setItem" -> {
                val key = try { args.getString("key") } catch (e: Exception) { null }
                val value = try { args.getString("value") } catch (e: Exception) { null }
                if (key != null && value != null) {
                    storage.setItem(key, value)
                }
                null
            }
            "removeItem" -> {
                val key = try { args.getString("key") } catch (e: Exception) { null }
                if (key != null) {
                    storage.removeItem(key)
                }
                null
            }
            "mergeItem" -> {
                val key = try { args.getString("key") } catch (e: Exception) { null }
                val value = try { args.getString("value") } catch (e: Exception) { null }
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
                val keys = try { args.getList("keys").mapNotNull { it as? String } } catch (e: Exception) { null }
                if (keys == null) {
                    null
                } else {
                    storage.multiGet(keys)
                }
            }
            "multiSet" -> {
                val pairs = try { parsePairs(args.getList("pairs")) } catch (e: Exception) { null }
                if (pairs != null) {
                    storage.multiSet(pairs)
                }
                null
            }
            "multiRemove" -> {
                val keys = try { args.getList("keys").mapNotNull { it as? String } } catch (e: Exception) { null }
                if (keys != null) {
                    storage.multiRemove(keys)
                }
                null
            }
            "multiMerge" -> {
                val pairs = try { parsePairs(args.getList("pairs")) } catch (e: Exception) { null }
                if (pairs != null) {
                    storage.multiMerge(pairs)
                }
                null
            }
            else -> null
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
