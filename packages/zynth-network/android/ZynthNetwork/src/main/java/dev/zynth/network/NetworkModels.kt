package dev.zynth.network

import org.json.JSONArray
import org.json.JSONObject

data class DiscoveryConfig(
    val serviceType: String,
    val domain: String,
    val resolveTimeoutMs: Int,
)

data class AdvertisedServiceInfo(
    val serviceType: String,
    val name: String,
    val domain: String,
    val port: Int,
    val txtRecord: Map<String, String>,
) {
    fun toJson(): JSONObject {
        val txtRecordJson = JSONObject()
        txtRecord.forEach { (key, value) ->
            txtRecordJson.put(key, value)
        }

        return JSONObject()
            .put("serviceType", serviceType)
            .put("name", name)
            .put("domain", domain)
            .put("port", port)
            .put("txtRecord", txtRecordJson)
    }
}

data class NetworkServiceInfo(
    val id: String,
    val name: String,
    val type: String,
    val domain: String,
    val hostName: String?,
    val port: Int,
    val addresses: List<String>,
    val txtRecord: Map<String, String>,
    val lastSeenAt: Long,
) {
    fun toJson(): JSONObject {
        val addressesJson = JSONArray()
        addresses.forEach { address ->
            addressesJson.put(address)
        }

        val txtRecordJson = JSONObject()
        txtRecord.forEach { (key, value) ->
            txtRecordJson.put(key, value)
        }

        return JSONObject()
            .put("id", id)
            .put("name", name)
            .put("type", type)
            .put("domain", domain)
            .put("hostName", hostName ?: JSONObject.NULL)
            .put("port", port)
            .put("addresses", addressesJson)
            .put("txtRecord", txtRecordJson)
            .put("lastSeenAt", lastSeenAt)
    }
}

data class DiscoveryEvent(
    val type: String,
    val timestamp: Long,
    val service: NetworkServiceInfo,
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("type", type)
            .put("timestamp", timestamp)
            .put("service", service.toJson())
    }
}
