package com.zynth.hypervisor

import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject

class ZynthHypervisorModule(
    private val runtime: ZynthRuntime,
    private val onMessage: (Any?) -> Unit
) : ZynthModule {
    override val name = "ZynthHypervisor"

    override val exportedMethods: List<String> = listOf("postMessage")
    override val protectedMethods: List<String> = listOf("postMessage")

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "postMessage" -> {
                // Try extracting from "message" key if it's a dict, or first index if it's an array
                val params = try { args.nestedAt(0) } catch (e: Exception) { null }
                val message = (try { params?.getString("message") } catch (e: Exception) { null }) 
                    ?: (try { args.getStringAt(0) } catch (e: Exception) { null })
                onMessage(message)
                JSONObject()
            }
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }
}
