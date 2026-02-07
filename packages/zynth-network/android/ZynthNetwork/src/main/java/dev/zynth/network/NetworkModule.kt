package dev.zynth.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.wifi.WifiManager
import android.provider.Settings
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.NetworkInterface
import java.util.Collections
import java.util.Locale

class NetworkModule(
    context: Context,
) : ZynthModule, ZynthSyncModule {
    override val name: String = "Network"

    private val appContext = context.applicationContext
    private val connectivityManager =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifiManager = appContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    private val discoveryController = NetworkDiscoveryController(
        nsdManager = nsdManager,
        wifiManager = wifiManager,
    )

    fun shutdown() {
        discoveryController.shutdown()
    }

    override fun invalidate() {
        shutdown()
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return try {
            when (method) {
                "getNetworkState" -> resultResponse(getNetworkState())
                "getIpAddress" -> resultResponse(getIpAddress() ?: JSONObject.NULL)
                "getMacAddress" -> resultResponse(getMacAddress() ?: JSONObject.NULL)
                "getCurrentWifi" -> resultResponse(getCurrentWifi() ?: JSONObject.NULL)
                "isAirplaneModeEnabled" -> resultResponse(isAirplaneModeEnabled())
                "startDiscovery" -> {
                    discoveryController.startDiscovery(parseDiscoveryConfig(args))
                    successResponse()
                }
                "stopDiscovery" -> {
                    discoveryController.stopDiscovery(clearServices = false)
                    successResponse()
                }
                "isDiscoveryRunning" -> resultResponse(discoveryController.isDiscoveryRunning())
                "getDiscoveredServices" -> resultResponse(discoveryController.getDiscoveredServices())
                "clearDiscoveredServices" -> {
                    discoveryController.clearDiscoveredServices()
                    successResponse()
                }
                "drainDiscoveryEvents" -> {
                    val maxEvents = getIntArg(args, "maxEvents") ?: 100
                    resultResponse(discoveryController.drainDiscoveryEvents(maxEvents))
                }
                "startService" -> resultResponse(
                    discoveryController.startService(parseAdvertisedService(args))
                )
                "stopService" -> {
                    discoveryController.stopService()
                    successResponse()
                }
                "getAdvertisedService" -> resultResponse(discoveryController.getAdvertisedService())
                else -> errorResponse("unsupported_method", method)
            }
        } catch (e: SecurityException) {
            errorResponse("permission_denied", e.message ?: "Permission denied")
        } catch (e: Throwable) {
            errorResponse("internal_error", e.message ?: "Unknown error")
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "getNetworkState" -> getNetworkState()
            "getIpAddress" -> getIpAddress() ?: JSONObject.NULL
            "isDiscoveryRunning" -> discoveryController.isDiscoveryRunning()
            "getDiscoveredServices" -> discoveryController.getDiscoveredServices()
            "getAdvertisedService" -> discoveryController.getAdvertisedService()
            else -> null
        }
    }

    private fun getNetworkState(): JSONObject {
        val activeNetwork = connectivityManager.activeNetwork
        if (activeNetwork == null) {
            return JSONObject()
                .put("type", "none")
                .put("isConnected", false)
                .put("isInternetReachable", false)
                .put("isExpensive", false)
        }

        val caps = connectivityManager.getNetworkCapabilities(activeNetwork)
        if (caps == null) {
            return JSONObject()
                .put("type", "unknown")
                .put("isConnected", false)
                .put("isInternetReachable", false)
                .put("isExpensive", false)
        }

        val isConnected = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val isInternetReachable =
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) || isConnected
        val isExpensive = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

        val type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "other"
            else -> "unknown"
        }

        return JSONObject()
            .put("type", type)
            .put("isConnected", isConnected)
            .put("isInternetReachable", isInternetReachable)
            .put("isExpensive", isExpensive)
    }

    private fun getIpAddress(): String? {
        val activeNetwork = connectivityManager.activeNetwork
        if (activeNetwork != null) {
            val linkProperties = connectivityManager.getLinkProperties(activeNetwork)
            if (linkProperties != null) {
                val ipv4 = linkProperties.linkAddresses
                    .asSequence()
                    .map(LinkAddress::getAddress)
                    .filterIsInstance<Inet4Address>()
                    .firstOrNull { !it.isLoopbackAddress }
                    ?.hostAddress
                if (!ipv4.isNullOrEmpty()) {
                    return ipv4
                }

                val ipv6 = linkProperties.linkAddresses
                    .asSequence()
                    .map(LinkAddress::getAddress)
                    .filterIsInstance<Inet6Address>()
                    .firstOrNull { !it.isLoopbackAddress }
                    ?.hostAddress
                if (!ipv6.isNullOrEmpty()) {
                    return stripIpv6Scope(ipv6)
                }
            }
        }

        return firstInterfaceAddress()
    }

    private fun firstInterfaceAddress(): String? {
        val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces() ?: return null)
        for (networkInterface in interfaces) {
            val name = networkInterface.name ?: continue
            if (name.startsWith("lo")) continue

            val addresses = Collections.list(networkInterface.inetAddresses ?: continue)
            val ipv4 = addresses.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
            if (ipv4 != null) {
                return ipv4.hostAddress
            }
        }

        for (networkInterface in interfaces) {
            val addresses = Collections.list(networkInterface.inetAddresses ?: continue)
            val ipv6 = addresses.firstOrNull { it is Inet6Address && !it.isLoopbackAddress }
            if (ipv6 != null) {
                return stripIpv6Scope(ipv6.hostAddress ?: return null)
            }
        }

        return null
    }

    private fun getMacAddress(): String? {
        return try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces() ?: return null)
            val wlan = interfaces.firstOrNull {
                it.name.equals("wlan0", ignoreCase = true) ||
                    it.name.equals("en0", ignoreCase = true)
            } ?: return null
            val hardwareAddress = wlan.hardwareAddress ?: return null
            hardwareAddress.joinToString(":") { byte ->
                String.format(Locale.US, "%02X", byte)
            }
        } catch (_: Throwable) {
            null
        }
    }

    private fun getCurrentWifi(): JSONObject? {
        val state = getNetworkState()
        if (state.optString("type") != "wifi") {
            return null
        }

        return try {
            val info = wifiManager.connectionInfo
            val ssidValue = info?.ssid?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
                ?.trim('"')
            val bssidValue = info?.bssid?.takeIf { it.isNotBlank() && it != "02:00:00:00:00:00" }
            val ipAddress = if (info != null && info.ipAddress != 0) {
                intToIpv4(info.ipAddress)
            } else {
                getIpAddress()
            }

            JSONObject()
                .put("ssid", ssidValue ?: JSONObject.NULL)
                .put("bssid", bssidValue ?: JSONObject.NULL)
                .put("ipAddress", ipAddress ?: JSONObject.NULL)
        } catch (_: Throwable) {
            JSONObject()
                .put("ssid", JSONObject.NULL)
                .put("bssid", JSONObject.NULL)
                .put("ipAddress", getIpAddress() ?: JSONObject.NULL)
        }
    }

    private fun isAirplaneModeEnabled(): Boolean {
        return try {
            Settings.Global.getInt(
                appContext.contentResolver,
                Settings.Global.AIRPLANE_MODE_ON,
                0,
            ) != 0
        } catch (_: Throwable) {
            false
        }
    }

    private fun parseDiscoveryConfig(args: Array<Any?>): DiscoveryConfig {
        val serviceType = normalizeServiceType(getStringArg(args, "serviceType"), "_zynth._tcp.")
        val domain = normalizeDomain(getStringArg(args, "domain"), "local.")
        val resolveTimeoutMs = (getIntArg(args, "resolveTimeoutMs") ?: 4000).coerceAtLeast(500)
        return DiscoveryConfig(serviceType, domain, resolveTimeoutMs)
    }

    private fun parseAdvertisedService(args: Array<Any?>): AdvertisedServiceInfo {
        val serviceType = normalizeServiceType(getStringArg(args, "serviceType"), "")
        val serviceName = (getStringArg(args, "name") ?: "").trim()
        val port = (getIntArg(args, "port") ?: 0)
        val domain = normalizeDomain(getStringArg(args, "domain"), "local.")
        val txtRecord = getStringMapArg(args, "txtRecord")

        if (serviceType.isBlank()) {
            throw IllegalArgumentException("serviceType is required")
        }
        if (serviceName.isBlank()) {
            throw IllegalArgumentException("name is required")
        }
        if (port <= 0 || port > 65535) {
            throw IllegalArgumentException("port must be between 1 and 65535")
        }

        return AdvertisedServiceInfo(
            serviceType = serviceType,
            name = serviceName,
            domain = domain,
            port = port,
            txtRecord = txtRecord,
        )
    }

    private fun intToIpv4(value: Int): String {
        val bytes = ByteArray(4)
        bytes[0] = (value and 0xff).toByte()
        bytes[1] = (value shr 8 and 0xff).toByte()
        bytes[2] = (value shr 16 and 0xff).toByte()
        bytes[3] = (value shr 24 and 0xff).toByte()
        return (bytes[0].toInt() and 0xff).toString() + "." +
            (bytes[1].toInt() and 0xff) + "." +
            (bytes[2].toInt() and 0xff) + "." +
            (bytes[3].toInt() and 0xff)
    }

    private fun stripIpv6Scope(address: String): String {
        val separator = address.indexOf('%')
        if (separator == -1) {
            return address
        }
        return address.substring(0, separator)
    }

    private fun normalizeServiceType(input: String?, fallback: String): String {
        val candidate = (input ?: fallback).trim()
        if (candidate.isEmpty()) return fallback
        return if (candidate.endsWith('.')) candidate else "$candidate."
    }

    private fun normalizeDomain(input: String?, fallback: String): String {
        val candidate = (input ?: fallback).trim()
        if (candidate.isEmpty()) return fallback
        return if (candidate.endsWith('.')) candidate else "$candidate."
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
        }?.trim()
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

    private fun getStringMapArg(args: Array<Any?>, key: String): Map<String, String> {
        val params = getParams(args)
        val raw = when (params) {
            is JSONObject -> params.opt(key)
            is Map<*, *> -> params[key]
            else -> null
        }

        return when (raw) {
            is JSONObject -> {
                val map = linkedMapOf<String, String>()
                val iterator = raw.keys()
                while (iterator.hasNext()) {
                    val entryKey = iterator.next()
                    val entryValue = raw.opt(entryKey)
                    map[entryKey] = if (entryValue == JSONObject.NULL) "" else entryValue.toString()
                }
                map
            }
            is Map<*, *> -> {
                val map = linkedMapOf<String, String>()
                for ((entryKey, entryValue) in raw) {
                    if (entryKey is String) {
                        map[entryKey] = entryValue?.toString() ?: ""
                    }
                }
                map
            }
            else -> emptyMap()
        }
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result ?: JSONObject.NULL)
    }

    private fun successResponse(): JSONObject {
        return JSONObject().put("success", true)
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject()
            .put("error", error)
            .put("message", message)
    }
}
