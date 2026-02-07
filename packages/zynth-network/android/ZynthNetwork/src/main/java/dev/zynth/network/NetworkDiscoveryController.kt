package dev.zynth.network

import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class NetworkDiscoveryController(
    private val nsdManager: NsdManager,
    private val wifiManager: WifiManager,
) {
    private val lock = Any()

    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var multicastLock: WifiManager.MulticastLock? = null

    private var discoveryConfig = DiscoveryConfig(
        serviceType = "_zynth._tcp.",
        domain = "local.",
        resolveTimeoutMs = 4000,
    )

    private var discoveryRunning: Boolean = false
    private val discoveredServices = linkedMapOf<String, NetworkServiceInfo>()
    private val discoveryEvents = ArrayList<DiscoveryEvent>()

    private var advertisedInfo: AdvertisedServiceInfo? = null

    fun shutdown() {
        stopDiscovery(clearServices = true)
        stopService()
    }

    fun startDiscovery(config: DiscoveryConfig) {
        discoveryConfig = config
        stopDiscovery(clearServices = false)
        acquireMulticastLock()

        val listener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
                synchronized(lock) {
                    discoveryRunning = false
                }
                releaseMulticastLock()
            }

            override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
                synchronized(lock) {
                    discoveryRunning = false
                }
                releaseMulticastLock()
            }

            override fun onDiscoveryStarted(serviceType: String?) {
                synchronized(lock) {
                    discoveryRunning = true
                }
            }

            override fun onDiscoveryStopped(serviceType: String?) {
                synchronized(lock) {
                    discoveryRunning = false
                }
                releaseMulticastLock()
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                handleServiceFound(serviceInfo)
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                handleServiceLost(serviceInfo)
            }
        }

        discoveryListener = listener
        nsdManager.discoverServices(config.serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    fun stopDiscovery(clearServices: Boolean) {
        val activeListener = discoveryListener
        if (activeListener != null) {
            try {
                nsdManager.stopServiceDiscovery(activeListener)
            } catch (_: Throwable) {
                // no-op
            }
        }

        discoveryListener = null

        synchronized(lock) {
            discoveryRunning = false
            if (clearServices) {
                discoveredServices.clear()
                discoveryEvents.clear()
            }
        }

        releaseMulticastLock()
    }

    fun isDiscoveryRunning(): Boolean {
        synchronized(lock) {
            return discoveryRunning
        }
    }

    fun getDiscoveredServices(): JSONArray {
        val array = JSONArray()
        synchronized(lock) {
            discoveredServices.values.forEach { service ->
                array.put(service.toJson())
            }
        }
        return array
    }

    fun clearDiscoveredServices() {
        synchronized(lock) {
            discoveredServices.clear()
            discoveryEvents.clear()
        }
    }

    fun drainDiscoveryEvents(maxEvents: Int): JSONArray {
        val safeLimit = maxEvents.coerceAtLeast(1)
        val result = JSONArray()

        synchronized(lock) {
            val count = minOf(safeLimit, discoveryEvents.size)
            if (count == 0) {
                return result
            }

            for (index in 0 until count) {
                result.put(discoveryEvents[index].toJson())
            }
            discoveryEvents.subList(0, count).clear()
        }

        return result
    }

    fun startService(options: AdvertisedServiceInfo): JSONObject {
        stopService()

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = options.name
            serviceType = options.serviceType
            port = options.port
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                options.txtRecord.forEach { (key, value) ->
                    setAttribute(key, value)
                }
            }
        }

        val listener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                synchronized(lock) {
                    advertisedInfo = null
                }
            }

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                // no-op
            }

            override fun onServiceRegistered(serviceInfo: NsdServiceInfo?) {
                if (serviceInfo != null) {
                    synchronized(lock) {
                        advertisedInfo = options.copy(
                            serviceType = serviceInfo.serviceType ?: options.serviceType,
                            name = serviceInfo.serviceName ?: options.name,
                            port = serviceInfo.port.takeIf { it > 0 } ?: options.port,
                        )
                    }
                }
            }

            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo?) {
                synchronized(lock) {
                    advertisedInfo = null
                }
            }
        }

        registrationListener = listener
        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)

        synchronized(lock) {
            advertisedInfo = options
        }

        return options.toJson()
    }

    fun stopService() {
        val listener = registrationListener
        if (listener != null) {
            try {
                nsdManager.unregisterService(listener)
            } catch (_: Throwable) {
                // no-op
            }
        }

        registrationListener = null

        synchronized(lock) {
            advertisedInfo = null
        }
    }

    fun getAdvertisedService(): Any {
        synchronized(lock) {
            return advertisedInfo?.toJson() ?: JSONObject.NULL
        }
    }

    private fun handleServiceFound(serviceInfo: NsdServiceInfo) {
        val key = serviceKey(serviceInfo)
        val found = NetworkServiceInfo(
            id = key,
            name = serviceInfo.serviceName ?: "",
            type = serviceInfo.serviceType ?: discoveryConfig.serviceType,
            domain = discoveryConfig.domain,
            hostName = null,
            port = serviceInfo.port,
            addresses = emptyList(),
            txtRecord = txtRecordFromService(serviceInfo),
            lastSeenAt = nowMs(),
        )

        synchronized(lock) {
            discoveredServices[key] = found
            enqueueDiscoveryEvent("serviceFound", found)
        }

        resolveService(serviceInfo, key)
    }

    private fun handleServiceLost(serviceInfo: NsdServiceInfo) {
        val key = serviceKey(serviceInfo)
        synchronized(lock) {
            val existing = discoveredServices.remove(key)
            if (existing != null) {
                enqueueDiscoveryEvent("serviceLost", existing.copy(lastSeenAt = nowMs()))
            }
        }
    }

    private fun resolveService(serviceInfo: NsdServiceInfo, key: String) {
        val resolveListener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                // keep serviceFound entry only
            }

            override fun onServiceResolved(resolved: NsdServiceInfo) {
                val host = resolved.host?.hostName
                val hostAddress = resolved.host?.hostAddress?.let(::stripIpv6Scope)
                val addresses = if (!hostAddress.isNullOrBlank()) {
                    listOf(hostAddress)
                } else {
                    emptyList()
                }

                val updated = NetworkServiceInfo(
                    id = key,
                    name = resolved.serviceName ?: serviceInfo.serviceName.orEmpty(),
                    type = resolved.serviceType ?: serviceInfo.serviceType ?: discoveryConfig.serviceType,
                    domain = discoveryConfig.domain,
                    hostName = host,
                    port = resolved.port,
                    addresses = addresses,
                    txtRecord = txtRecordFromService(resolved),
                    lastSeenAt = nowMs(),
                )

                synchronized(lock) {
                    discoveredServices[key] = updated
                    enqueueDiscoveryEvent("serviceResolved", updated)
                }
            }
        }

        nsdManager.resolveService(serviceInfo, resolveListener)
    }

    private fun txtRecordFromService(serviceInfo: NsdServiceInfo): Map<String, String> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return emptyMap()
        }
        val result = linkedMapOf<String, String>()
        val attributes = serviceInfo.attributes
        if (attributes != null) {
            for ((key, value) in attributes) {
                result[key] = value?.toString(Charsets.UTF_8) ?: ""
            }
        }
        return result
    }

    private fun acquireMulticastLock() {
        if (multicastLock?.isHeld == true) {
            return
        }
        multicastLock = wifiManager.createMulticastLock("zynth-network-mdns").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseMulticastLock() {
        val lock = multicastLock
        if (lock != null && lock.isHeld) {
            lock.release()
        }
        multicastLock = null
    }

    private fun serviceKey(serviceInfo: NsdServiceInfo): String {
        val name = serviceInfo.serviceName.orEmpty().lowercase(Locale.US)
        val type = serviceInfo.serviceType.orEmpty().lowercase(Locale.US)
        return "$name|$type"
    }

    private fun enqueueDiscoveryEvent(type: String, service: NetworkServiceInfo) {
        discoveryEvents.add(
            DiscoveryEvent(
                type = type,
                timestamp = nowMs(),
                service = service,
            )
        )

        if (discoveryEvents.size > 500) {
            discoveryEvents.subList(0, discoveryEvents.size - 500).clear()
        }
    }

    private fun stripIpv6Scope(address: String): String {
        val separator = address.indexOf('%')
        if (separator == -1) {
            return address
        }
        return address.substring(0, separator)
    }

    private fun nowMs(): Long = System.currentTimeMillis()
}
