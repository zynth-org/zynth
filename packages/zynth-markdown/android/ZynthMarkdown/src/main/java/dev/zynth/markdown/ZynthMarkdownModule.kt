package dev.zynth.markdown

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

class ZynthMarkdownModule : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthMarkdown"

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "parse" -> resultResponse(parse(args))
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "parse" -> parse(args)
            else -> null
        }
    }

    private fun parse(args: Array<Any?>): String {
        val content = getStringArg(args, "content") ?: ""
        val options = getIntArg(args, "options") ?: 0
        val extensions = getIntArg(args, "extensions") ?: 0
        return ZynthMarkdownNative.parse(content, options, extensions) ?: ""
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

    private fun getIntArg(args: Array<Any?>, key: String): Int? {
        val params = getParams(args)
        val value = when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }
        return when (value) {
            is Number -> value.toInt()
            is String -> value.toIntOrNull()
            else -> null
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().apply {
            put("result", result ?: JSONObject.NULL)
        }
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().apply {
            put("error", error)
            put("message", message)
        }
    }
}
