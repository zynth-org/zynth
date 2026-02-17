package dev.zynth.markdown

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

class ZynthMarkdownModule : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthMarkdown"

    override val exportedMethods: List<String> = listOf("parse")

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "parse" -> resultResponse(parse(args))
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any {
        return when (method) {
            "parse" -> parse(args)
            else -> throw IllegalArgumentException("Unsupported method: $method")
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
}
