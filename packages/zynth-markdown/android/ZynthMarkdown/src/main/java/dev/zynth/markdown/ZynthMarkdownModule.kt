package dev.zynth.markdown

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

class ZynthMarkdownModule : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthMarkdown"

    override fun call(method: String, args: ZynthArgs): JSONObject {
        val params = try { args.nestedAt(0) } catch (e: Exception) { args }
        return when (method) {
            "parse" -> resultResponse(parse(params))
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        val params = try { args.nestedAt(0) } catch (e: Exception) { args }
        return when (method) {
            "parse" -> parse(params)
            else -> null
        }
    }

    private fun parse(params: ZynthArgs): String {
        val content = params.getString("content", "")
        val options = params.getInt("options", 0)
        val extensions = params.getInt("extensions", 0)
        return ZynthMarkdownNative.parse(content, options, extensions) ?: ""
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
