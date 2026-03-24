package dev.zynth.network

import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class NetworkDiscoveryController(
    private val nsdManager: NsdManager,
    private val wifiManager: WifiManager,
) {
    companion object {
        const val TAG = "ZynthNetworkDiscovery"
        private const val DEVICE_ID_TXT_KEY = "zdid"
        private const val LEGACY_DEVICE_ID_TXT_KEY = "zynthDeviceId"
        private const val MAX_DISCOVERY_EVENTS = 250
        private const val MAX_DISCOVERED_SERVICES = 128
        private const val MAX_RESOLVE_ATTEMPTS = 3
        private const val RESOLVE_RETRY_DELAY_MS = 700L
        private const val RESOLVE_COOLDOWN_MS = 1200L
    }

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
    private val resolveAttempts = linkedMapOf<String, Int>()
    private val resolveInFlight = linkedSetOf<String>()
    private val resolveRetryTasks = linkedMapOf<String, Runnable>()
    private val lastResolveAtMs = linkedMapOf<String, Long>()
    private val mainHandler = Handler(Looper.getMainLooper())

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
        clearResolveWork()

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
        clearResolveWork()
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
            enqueueDiscoveryEvent("serviceFound", found)
        }
        Log.d(TAG, "serviceFound name=${found.name} type=${found.type} port=${found.port}")

        resolveService(serviceInfo, key)
    }

    private fun handleServiceLost(serviceInfo: NsdServiceInfo) {
        val key = serviceKey(serviceInfo)
        synchronized(lock) {
            resolveInFlight.remove(key)
            resolveAttempts.remove(key)
            lastResolveAtMs.remove(key)
            cancelResolveRetryLocked(key)
            val existing = discoveredServices.remove(key)
            if (existing != null) {
                enqueueDiscoveryEvent("serviceLost", existing.copy(lastSeenAt = nowMs()))
                Log.d(TAG, "serviceLost name=${existing.name} port=${existing.port}")
            }
        }
    }

    private fun resolveService(serviceInfo: NsdServiceInfo, key: String) {
        val canResolve = synchronized(lock) {
            if (!discoveryRunning) {
                false
            } else if (resolveInFlight.contains(key)) {
                false
            } else {
                val now = nowMs()
                val lastAttempt = lastResolveAtMs[key]
                if (lastAttempt != null && now - lastAttempt < RESOLVE_COOLDOWN_MS) {
                    false
                } else {
                    resolveInFlight.add(key)
                    lastResolveAtMs[key] = now
                    true
                }
            }
        }
        if (!canResolve) {
            return
        }

        val resolveListener = object : NsdManager.ResolveListener {
            override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                val serviceName = serviceInfo?.serviceName ?: key
                var shouldRetry = false
                var retryServiceInfo: NsdServiceInfo? = null
                val attempt = synchronized(lock) {
                    resolveInFlight.remove(key)
                    val current = (resolveAttempts[key] ?: 0) + 1
                    resolveAttempts[key] = current
                    if (current < MAX_RESOLVE_ATTEMPTS && discoveryRunning) {
                        shouldRetry = true
                        retryServiceInfo = serviceInfo ?: serviceInfoFallback(serviceName)
                    }
                    current
                }
                Log.w(TAG, "serviceResolveFailed name=$serviceName code=$errorCode attempt=$attempt")
                if (shouldRetry && retryServiceInfo != null) {
                    scheduleResolveRetry(key, retryServiceInfo!!)
                    return
                }
                synchronized(lock) {
                    resolveAttempts.remove(key)
                    lastResolveAtMs.remove(key)
                    cancelResolveRetryLocked(key)
                    val existing = discoveredServices.remove(key) ?: return
                    enqueueDiscoveryEvent("serviceLost", existing.copy(lastSeenAt = nowMs()))
                }
            }

            override fun onServiceResolved(resolved: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                val resolvedHost = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    resolved.hostAddresses.firstOrNull()
                } else {
                    resolved.host
                }

                val hostName = resolvedHost?.hostName
                val hostAddress = resolvedHost?.hostAddress?.let(::stripIpv6Scope)
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
                    hostName = hostName,
                    port = resolved.port,
                    addresses = addresses,
                    txtRecord = txtRecordFromService(resolved),
                    lastSeenAt = nowMs(),
                )

                synchronized(lock) {
                    resolveInFlight.remove(key)
                    resolveAttempts.remove(key)
                    cancelResolveRetryLocked(key)
                    pruneDuplicateResolvedServices(updated, key)
                    discoveredServices[key] = updated
                    enforceServiceLimitLocked()
                    enqueueDiscoveryEvent("serviceResolved", updated)
                }
                Log.d(
                    TAG,
                    "serviceResolved name=${updated.name} port=${updated.port} addresses=${updated.addresses.joinToString(",")}"
                )
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            @Suppress("DEPRECATION")
            nsdManager.resolveService(serviceInfo, { it.run() }, resolveListener)
        } else {
            @Suppress("DEPRECATION")
            nsdManager.resolveService(serviceInfo, resolveListener)
        }
    }

    private fun serviceInfoFallback(name: String): NsdServiceInfo {
        return NsdServiceInfo().apply {
            serviceName = name
            serviceType = discoveryConfig.serviceType
        }
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
        val name = serviceInfo.serviceName.orEmpty().trim().lowercase(Locale.US)
        val type = normalizeServiceTypeForKey(serviceInfo.serviceType).lowercase(Locale.US)
        val domain = normalizeDomainForKey(discoveryConfig.domain).lowercase(Locale.US)
        return "$name|$type|$domain"
    }

    private fun normalizeServiceTypeForKey(value: String?): String {
        val trimmed = value.orEmpty().trim()
        if (trimmed.isEmpty()) {
            return discoveryConfig.serviceType.trim().ifEmpty { "_zynth._tcp." }
        }
        return if (trimmed.endsWith(".")) trimmed else "$trimmed."
    }

    private fun normalizeDomainForKey(value: String?): String {
        val trimmed = value.orEmpty().trim()
        if (trimmed.isEmpty()) {
            return "local."
        }
        return if (trimmed.endsWith(".")) trimmed else "$trimmed."
    }

    private fun pruneDuplicateResolvedServices(updated: NetworkServiceInfo, keepKey: String) {
        val duplicateKeys = mutableListOf<String>()
        discoveredServices.forEach { (existingKey, existingService) ->
            if (existingKey == keepKey) {
                return@forEach
            }
            if (isDuplicatePeer(existingService, updated)) {
                duplicateKeys.add(existingKey)
            }
        }
        duplicateKeys.forEach { duplicateKey ->
            discoveredServices.remove(duplicateKey)
        }
    }

    private fun isDuplicatePeer(a: NetworkServiceInfo, b: NetworkServiceInfo): Boolean {
        val aDeviceId = normalizedDeviceId(a)
        val bDeviceId = normalizedDeviceId(b)
        if (aDeviceId != null && bDeviceId != null && aDeviceId == bDeviceId) {
            return true
        }

        val aAddress = normalizedPrimaryAddress(a)
        val bAddress = normalizedPrimaryAddress(b)
        if (aAddress != null && bAddress != null && aAddress == bAddress && a.port == b.port) {
            return true
        }

        val aHost = a.hostName?.trim()?.lowercase(Locale.US)
        val bHost = b.hostName?.trim()?.lowercase(Locale.US)
        if (!aHost.isNullOrEmpty() && !bHost.isNullOrEmpty() && aHost == bHost && a.port == b.port) {
            return true
        }

        return false
    }

    private fun normalizedDeviceId(service: NetworkServiceInfo): String? {
        val value =
            service.txtRecord[DEVICE_ID_TXT_KEY]?.trim()
                ?: service.txtRecord[LEGACY_DEVICE_ID_TXT_KEY]?.trim()
        if (value.isNullOrEmpty()) {
            return null
        }
        return value
    }

    private fun normalizedPrimaryAddress(service: NetworkServiceInfo): String? {
        val value = service.addresses.firstOrNull()?.trim()?.lowercase(Locale.US)
        if (value.isNullOrEmpty()) {
            return null
        }
        return value
    }

    private fun enqueueDiscoveryEvent(type: String, service: NetworkServiceInfo) {
        discoveryEvents.add(
            DiscoveryEvent(
                type = type,
                timestamp = nowMs(),
                service = service,
            )
        )

        if (discoveryEvents.size > MAX_DISCOVERY_EVENTS) {
            discoveryEvents.subList(0, discoveryEvents.size - MAX_DISCOVERY_EVENTS).clear()
        }
    }

    private fun scheduleResolveRetry(key: String, serviceInfo: NsdServiceInfo) {
        val task = synchronized(lock) {
            cancelResolveRetryLocked(key)
            val runnable = Runnable {
                resolveService(serviceInfo, key)
            }
            resolveRetryTasks[key] = runnable
            runnable
        }
        mainHandler.postDelayed(task, RESOLVE_RETRY_DELAY_MS)
    }

    private fun clearResolveWork() {
        synchronized(lock) {
            resolveInFlight.clear()
            resolveAttempts.clear()
            lastResolveAtMs.clear()
            resolveRetryTasks.values.forEach { task ->
                mainHandler.removeCallbacks(task)
            }
            resolveRetryTasks.clear()
        }
    }

    private fun cancelResolveRetryLocked(key: String) {
        val pending = resolveRetryTasks.remove(key) ?: return
        mainHandler.removeCallbacks(pending)
    }

    private fun enforceServiceLimitLocked() {
        while (discoveredServices.size > MAX_DISCOVERED_SERVICES) {
            val firstKey = discoveredServices.keys.firstOrNull() ?: break
            discoveredServices.remove(firstKey)
            resolveInFlight.remove(firstKey)
            resolveAttempts.remove(firstKey)
            lastResolveAtMs.remove(firstKey)
            cancelResolveRetryLocked(firstKey)
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
