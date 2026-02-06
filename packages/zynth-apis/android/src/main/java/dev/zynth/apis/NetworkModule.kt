package dev.zynth.apis

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONObject

private const val NETWORK_EVENT = "zynth.network.change"

private data class NetworkSnapshot(
    val isConnected: Boolean,
    val isInternetReachable: Boolean,
    val type: String,
    val isExpensive: Boolean,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "isConnected" to isConnected,
        "isInternetReachable" to isInternetReachable,
        "type" to type,
        "isExpensive" to isExpensive,
    )
}

class NetworkModule(
    context: Context,
    private val runtime: ZynthRuntime,
) : ZynthModule, ZynthSyncModule {

    override val name: String = "Network"

    private val connectivityManager = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    @Volatile
    private var latestSnapshot: NetworkSnapshot = readSnapshot()
    private var registered = false

    override val constants: Map<String, Any>?
        get() = latestSnapshot.toMap()

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            emitIfChanged()
        }

        override fun onLost(network: Network) {
            emitIfChanged()
        }

        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
            emitIfChanged()
        }
    }

    override fun initialize() {
        emitIfChanged(force = true)
        startMonitoring()
    }

    override fun invalidate() {
        stopMonitoring()
    }

    override fun call(method: String, args: Array<Any?>): JSONObject {
        return when (method) {
            "current" -> JSONObject().put("result", latestSnapshot.toMap())
            else -> JSONObject().put("error", "unknown_method")
        }
    }

    override fun callSync(method: String, args: Array<Any?>): Any? {
        return when (method) {
            "current" -> latestSnapshot.toMap()
            else -> null
        }
    }

    private fun startMonitoring() {
        if (registered) return
        registered = true
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivityManager.registerDefaultNetworkCallback(callback)
            } else {
                val request = NetworkRequest.Builder().build()
                connectivityManager.registerNetworkCallback(request, callback)
            }
        } catch (_: Throwable) {
            registered = false
        }
    }

    private fun stopMonitoring() {
        if (!registered) return
        try {
            connectivityManager.unregisterNetworkCallback(callback)
        } catch (_: Throwable) {
            // no-op
        } finally {
            registered = false
        }
    }

    private fun emitIfChanged(force: Boolean = false) {
        val snapshot = readSnapshot()
        if (!force && snapshot == latestSnapshot) {
            return
        }
        latestSnapshot = snapshot
        runtime.emitEvent(NETWORK_EVENT, snapshot.toMap())
    }

    private fun readSnapshot(): NetworkSnapshot {
        val network = connectivityManager.activeNetwork
        val capabilities = connectivityManager.getNetworkCapabilities(network)

        val isConnected = capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val isInternetReachable =
            if (capabilities == null) false
            else capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

        val isExpensive =
            if (capabilities == null) false
            else !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)

        return NetworkSnapshot(
            isConnected = isConnected,
            isInternetReachable = isInternetReachable || isConnected,
            type = resolveType(capabilities, isConnected),
            isExpensive = isExpensive,
        )
    }

    private fun resolveType(capabilities: NetworkCapabilities?, isConnected: Boolean): String {
        if (!isConnected || capabilities == null) {
            return "none"
        }
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
            else -> "other"
        }
    }
}
