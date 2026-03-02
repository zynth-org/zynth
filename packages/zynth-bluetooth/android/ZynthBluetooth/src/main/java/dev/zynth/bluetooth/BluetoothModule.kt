package dev.zynth.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.zynth.kit.runtime.ZynthArgs
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthSyncModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.min

internal class BluetoothModule(
  private val activity: ComponentActivity,
  private val runtime: ZynthRuntime,
) : ZynthModule, ZynthSyncModule {
  override val name: String = "Bluetooth"

  override val exportedMethods: List<String> = listOf(
    "isClassicSupported",
    "isBleSupported",
    "isEnabled",
    "getPermissions",
    "requestPermissions",
    "startClassicDiscovery",
    "stopClassicDiscovery",
    "getClassicDiscoveredDevices",
    "connectClassic",
    "reconnectClassic",
    "disconnectClassic",
    "writeClassic",
    "readClassic",
    "getClassicConnections",
    "startBleScan",
    "stopBleScan",
    "getBleScannedDevices",
    "connectBle",
    "reconnectBle",
    "disconnectBle",
    "discoverBleServices",
    "readBleCharacteristic",
    "writeBleCharacteristic",
    "setBleNotification",
    "requestBleMtu",
    "readBleRssi",
    "getBleConnections",
    "isBlePeripheralSupported",
    "startBlePeripheral",
    "stopBlePeripheral",
    "getBlePeripheralState",
    "updateBlePeripheralCharacteristic",
  )

  override val protectedMethods: List<String> = exportedMethods
  private val logTag = "ZynthBluetooth"

  private val appContext: Context = activity.applicationContext
  private val bluetoothManager: BluetoothManager? =
    appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
  private val classicDiscoveryDevices = ConcurrentHashMap<String, JSONObject>()
  private val bleScannedDevices = ConcurrentHashMap<String, JSONObject>()
  private val classicConnections = ConcurrentHashMap<String, ClassicConnection>()
  private val bleConnections = ConcurrentHashMap<String, BleConnection>()
  private val peripheralCentrals = ConcurrentHashMap<String, BluetoothDevice>()
  private val ioExecutor = Executors.newCachedThreadPool()
  private var bleAdvertiser: BluetoothLeAdvertiser? = null
  private var bleAdvertiseCallback: AdvertiseCallback? = null
  private var bleGattServer: BluetoothGattServer? = null
  private var blePeripheralServiceUuid: UUID? = null
  private var blePeripheralCharacteristicUuid: UUID? = null
  private var blePeripheralCharacteristic: BluetoothGattCharacteristic? = null
  private var blePeripheralCharacteristicValue: ByteArray = ByteArray(0)
  private var blePeripheralLocalName: String? = null
  private var blePeripheralPreviousAdapterName: String? = null

  @Volatile
  private var blePeripheralRunning = false

  @Volatile
  private var isClassicReceiverRegistered = false

  @Volatile
  private var isBleScanRunning = false

  @Volatile
  private var permissionRequestId: String? = null

  private var permissionLauncher: ActivityResultLauncher<Array<String>>? = null

  private val classicDiscoveryReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      when (intent?.action) {
        BluetoothAdapter.ACTION_DISCOVERY_STARTED -> emitClassicEvent(
          JSONObject()
            .put("type", "discovery_started")
            .put("timestamp", System.currentTimeMillis())
        )

        BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> emitClassicEvent(
          JSONObject()
            .put("type", "discovery_finished")
            .put("timestamp", System.currentTimeMillis())
        )

        BluetoothDevice.ACTION_FOUND -> {
          val device = intent.getParcelableExtraCompat<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE)
          if (device != null) {
            val json = deviceToJson(device, intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, Short.MIN_VALUE).toInt())
            classicDiscoveryDevices[device.address] = json
            emitClassicEvent(
              JSONObject()
                .put("type", "device_found")
                .put("timestamp", System.currentTimeMillis())
                .put("device", json)
            )
          }
        }
      }
    }
  }

  private val bleScanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      onBleScanResult(result)
    }

    override fun onBatchScanResults(results: MutableList<ScanResult>) {
      for (result in results) {
        onBleScanResult(result)
      }
    }

    override fun onScanFailed(errorCode: Int) {
      emitBleError("E_NATIVE", "BLE scan failed with code $errorCode")
    }
  }

  fun setupPermissionLauncher() {
    permissionLauncher = activity.registerForActivityResult(
      ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
      val requestId = permissionRequestId
      permissionRequestId = null
      if (requestId != null) {
        val status = getPermissions("all")
        val payload = JSONObject()
          .put("requestId", requestId)
          .put("ok", true)
          .put("data", status)
        runtime.emitEvent("Bluetooth.permissionResult", payload)
      }
    }
  }

  override fun invalidate() {
    stopClassicDiscoveryInternal()
    stopBleScanInternal()
    stopBlePeripheralInternal()
    disconnectAllClassic()
    disconnectAllBle()
    ioExecutor.shutdownNow()
    permissionRequestId = null
  }

  override fun call(method: String, args: ZynthArgs): JSONObject {
    return when (method) {
      "isClassicSupported" -> success(isClassicSupported())
      "isBleSupported" -> success(isBleSupported())
      "isEnabled" -> success(isEnabled())
      "getPermissions" -> {
        val transport = args.getString("transport", "all")
        success(getPermissions(transport))
      }
      "requestPermissions" -> requestPermissions(args)
      "startClassicDiscovery" -> startClassicDiscovery(args)
      "stopClassicDiscovery" -> success(stopClassicDiscoveryInternal())
      "getClassicDiscoveredDevices" -> success(devicesMapToArray(classicDiscoveryDevices))
      "connectClassic" -> connectClassic(args)
      "reconnectClassic" -> reconnectClassic(args)
      "disconnectClassic" -> disconnectClassic(args)
      "writeClassic" -> writeClassic(args)
      "readClassic" -> readClassic(args)
      "getClassicConnections" -> success(classicConnectionsArray())
      "startBleScan" -> startBleScan(args)
      "stopBleScan" -> success(stopBleScanInternal())
      "getBleScannedDevices" -> success(devicesMapToArray(bleScannedDevices))
      "connectBle" -> connectBle(args)
      "reconnectBle" -> reconnectBle(args)
      "disconnectBle" -> disconnectBle(args)
      "discoverBleServices" -> discoverBleServices(args)
      "readBleCharacteristic" -> readBleCharacteristic(args)
      "writeBleCharacteristic" -> writeBleCharacteristic(args)
      "setBleNotification" -> setBleNotification(args)
      "requestBleMtu" -> requestBleMtu(args)
      "readBleRssi" -> readBleRssi(args)
      "getBleConnections" -> success(bleConnectionsArray())
      "isBlePeripheralSupported" -> success(isBlePeripheralSupported())
      "startBlePeripheral" -> startBlePeripheral(args)
      "stopBlePeripheral" -> success(stopBlePeripheralInternal())
      "getBlePeripheralState" -> success(getBlePeripheralState())
      "updateBlePeripheralCharacteristic" -> updateBlePeripheralCharacteristic(args)
      else -> failure("E_INVALID_ARGUMENT", "Unsupported method: $method")
    }
  }

  override fun callSync(method: String, args: ZynthArgs): Any? {
    return when (method) {
      "isClassicSupported" -> isClassicSupported()
      "isBleSupported" -> isBleSupported()
      "isEnabled" -> isEnabled()
      "getPermissions" -> {
        val transport = args.getString("transport", "all")
        getPermissions(transport)
      }
      "isBlePeripheralSupported" -> isBlePeripheralSupported()
      "getBlePeripheralState" -> getBlePeripheralState()
      else -> mapOf("ok" to false, "code" to "E_INVALID_ARGUMENT", "message" to "Sync method not supported")
    }
  }

  private fun isClassicSupported(): Boolean {
    return bluetoothAdapter != null
  }

  private fun isBleSupported(): Boolean {
    val hasFeature = appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
    return bluetoothAdapter != null && hasFeature
  }

  private fun isEnabled(): Boolean {
    return bluetoothAdapter?.isEnabled == true
  }

  private fun getPermissions(transport: String): JSONObject {
    val requiresScan = transport == "ble" || transport == "all" || transport == "classic"
    val requiresConnect = transport == "ble" || transport == "all" || transport == "classic"
    val requiresAdvertise = transport == "all"

    val scanGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && requiresScan) {
      hasPermission(Manifest.permission.BLUETOOTH_SCAN)
    } else {
      true
    }
    val connectGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && requiresConnect) {
      hasPermission(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
      true
    }
    val advertiseGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && requiresAdvertise) {
      hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)
    } else {
      true
    }
    val locationGranted = if (requiresScan) {
      hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    } else {
      true
    }

    return JSONObject()
      .put("bluetoothScan", scanGranted)
      .put("bluetoothConnect", connectGranted)
      .put("bluetoothAdvertise", advertiseGranted)
      .put("location", locationGranted)
      .put(
        "allGranted",
        scanGranted && connectGranted && locationGranted && (!requiresAdvertise || advertiseGranted)
      )
  }

  private fun requestPermissions(args: ZynthArgs): JSONObject {
    val requestId = args.getString("requestId", "bt-${System.currentTimeMillis()}")
    val transport = args.getString("transport", "all")

    val status = getPermissions(transport)
    if (status.optBoolean("allGranted", false)) {
      return success(status)
    }

    val launcher = permissionLauncher ?: return failure("E_UNAVAILABLE", "Permission launcher is not initialized")
    val permissions = requiredPermissions(transport)
    if (permissions.isEmpty()) {
      return success(status)
    }

    permissionRequestId = requestId
    launcher.launch(permissions.toTypedArray())
    return success(JSONObject().put("status", "pending"))
  }

  private fun requiredPermissions(transport: String): List<String> {
    val list = mutableListOf<String>()
    val requiresScan = transport == "classic" || transport == "ble" || transport == "all"
    val requiresConnect = transport == "classic" || transport == "ble" || transport == "all"
    val requiresAdvertise = transport == "all"

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (requiresScan && !hasPermission(Manifest.permission.BLUETOOTH_SCAN)) {
        list.add(Manifest.permission.BLUETOOTH_SCAN)
      }
      if (requiresConnect && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
        list.add(Manifest.permission.BLUETOOTH_CONNECT)
      }
      if (requiresAdvertise && !hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)) {
        list.add(Manifest.permission.BLUETOOTH_ADVERTISE)
      }
    }

    if (requiresScan && !hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
      list.add(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    return list.distinct()
  }

  private fun startClassicDiscovery(args: ZynthArgs): JSONObject {
    ensureClassicReady()
    ensureDiscoveryPermissions()

    val clearPrevious = args.getBoolean("clearPrevious", true)
    if (clearPrevious) {
      classicDiscoveryDevices.clear()
    }

    // Classic discovery often fails when BLE scan is active; stop it first.
    stopBleScanInternal()
    seedClassicFromBondedDevices()

    registerClassicReceiverIfNeeded()
    if (bluetoothAdapter?.isDiscovering == true) {
      bluetoothAdapter.cancelDiscovery()
    }

    val adapter = bluetoothAdapter
      ?: return failure("E_UNAVAILABLE", "Bluetooth adapter unavailable")
    val initialState = adapterStateName(adapter.state)
    if (adapter.state != BluetoothAdapter.STATE_ON) {
      return failure("E_NOT_ENABLED", "Bluetooth adapter is not ON (state=$initialState)")
    }

    var started = adapter.startDiscovery()
    if (!started) {
      runCatching { Thread.sleep(180) }
      started = adapter.startDiscovery()
    }

    return if (started) {
      success(true)
    } else {
      failure(
        "E_NATIVE",
        "Failed to start Bluetooth Classic discovery (state=${adapterStateName(adapter.state)}, bleScanRunning=$isBleScanRunning, alreadyDiscovering=${adapter.isDiscovering}, locationPermission=${hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)})"
      )
    }
  }

  private fun stopClassicDiscoveryInternal(): Boolean {
    val adapter = bluetoothAdapter ?: return false
    if (adapter.isDiscovering) {
      adapter.cancelDiscovery()
    }
    unregisterClassicReceiverIfNeeded()
    return true
  }

  private fun connectClassic(args: ZynthArgs): JSONObject {
    ensureClassicReady()
    ensureConnectPermission()

    val deviceId = args.getString("deviceId")
    val uuidString = args.getString("uuid", "00001101-0000-1000-8000-00805F9B34FB")
    val insecure = args.getBoolean("insecure", false)
    val timeoutMs = args.getInt("timeoutMs", 15000)

    val adapter = bluetoothAdapter ?: return failure("E_UNAVAILABLE", "Bluetooth adapter unavailable")
    val device = runCatching { adapter.getRemoteDevice(deviceId) }.getOrNull()
      ?: return failure("E_NOT_FOUND", "Classic device not found: $deviceId")

    val uuid = runCatching { UUID.fromString(uuidString) }.getOrNull()
      ?: return failure("E_INVALID_ARGUMENT", "Invalid RFCOMM UUID: $uuidString")

    val deviceClass = device.bluetoothClass
    if (deviceClass != null && isHidPeripheral(deviceClass)) {
      return failure(
        "E_UNSUPPORTED_PROFILE",
        "Classic RFCOMM is not supported for HID peripherals (keyboard/mouse/gamepad)."
      )
    }

    val advertisedUuids = device.uuids
    if (advertisedUuids != null && advertisedUuids.isNotEmpty()) {
      val hasRequestedService = advertisedUuids.any { parcel -> parcel.uuid == uuid }
      if (!hasRequestedService) {
        return failure(
          "E_UNSUPPORTED_PROFILE",
          "Device does not advertise requested RFCOMM UUID. Requested=$uuidString"
        )
      }
    }

    val future = ioExecutor.submit<JSONObject> {
      if (adapter.isDiscovering) {
        adapter.cancelDiscovery()
      }

      val socket = if (insecure && Build.VERSION.SDK_INT >= Build.VERSION_CODES.GINGERBREAD_MR1) {
        device.createInsecureRfcommSocketToServiceRecord(uuid)
      } else {
        device.createRfcommSocketToServiceRecord(uuid)
      }

      try {
        socket.connect()
        val connectionId = createConnectionId("classic")
        val connection = ClassicConnection(connectionId, device, socket)
        classicConnections[connectionId] = connection
        connection.startReader()
        emitClassicConnection(connection)
        success(connection.toJson())
      } catch (error: Throwable) {
        runCatching { socket.close() }
        failure("E_IO", "Classic connect failed: ${error.message ?: "unknown"}")
      }
    }

    return waitFuture(timeoutMs, future, "Classic connect timeout")
  }

  private fun reconnectClassic(args: ZynthArgs): JSONObject {
    val policyMap = runCatching { args.getMap("policy") }.getOrNull()
    val maxAttempts = ((policyMap?.get("maxAttempts") as? Number)?.toInt() ?: 4).coerceAtLeast(1)
    val initialDelayMs = ((policyMap?.get("initialDelayMs") as? Number)?.toLong() ?: 500L).coerceAtLeast(100L)
    val maxDelayMs = ((policyMap?.get("maxDelayMs") as? Number)?.toLong() ?: 5000L).coerceAtLeast(100L)
    val multiplier = ((policyMap?.get("backoffMultiplier") as? Number)?.toDouble() ?: 1.7).coerceAtLeast(1.0)

    var delayMs = initialDelayMs
    var lastFailure = failure("E_IO", "Classic reconnect failed")

    repeat(maxAttempts) { attempt ->
      val result = connectClassic(args)
      if (result.optBoolean("ok", false)) {
        return result
      }
      lastFailure = result
      if (attempt < maxAttempts - 1) {
        Thread.sleep(delayMs)
        delayMs = min(maxDelayMs, (delayMs * multiplier).toLong())
      }
    }

    return lastFailure
  }

  private fun disconnectClassic(args: ZynthArgs): JSONObject {
    val connectionId = args.getString("connectionId")
    val connection = classicConnections.remove(connectionId)
      ?: return failure("E_NOT_FOUND", "Classic connection not found: $connectionId")

    connection.close()
    emitClassicConnection(connection)
    return success(true)
  }

  private fun writeClassic(args: ZynthArgs): JSONObject {
    val connectionId = args.getString("connectionId")
    val dataBase64 = args.getString("dataBase64")
    val connection = classicConnections[connectionId]
      ?: return failure("E_NOT_FOUND", "Classic connection not found: $connectionId")

    val data = decodeBase64(dataBase64) ?: return failure("E_INVALID_ARGUMENT", "Invalid base64 payload")

    return try {
      connection.write(data)
      success(true)
    } catch (error: Throwable) {
      failure("E_IO", "Classic write failed: ${error.message ?: "unknown"}")
    }
  }

  private fun readClassic(args: ZynthArgs): JSONObject {
    val connectionId = args.getString("connectionId")
    val connection = classicConnections[connectionId]
      ?: return failure("E_NOT_FOUND", "Classic connection not found: $connectionId")

    return success(connection.readQueue.poll() ?: JSONObject.NULL)
  }

  private fun startBleScan(args: ZynthArgs): JSONObject {
    ensureBleReady()
    ensureDiscoveryPermissions()

    val scanner = bluetoothAdapter?.bluetoothLeScanner
      ?: return failure("E_UNAVAILABLE", "BLE scanner unavailable")
    val allowDuplicates = args.getBoolean("allowDuplicates", false)
    val legacy = args.getBoolean("legacy", true)
    val namePrefix = args.getString("namePrefix", "")
    val serviceUuidValues = runCatching { args.getList("serviceUuids") }.getOrElse { emptyList<Any?>() }

    if (!allowDuplicates) {
      bleScannedDevices.clear()
    }

    val filters = mutableListOf<ScanFilter>()
    for (entry in serviceUuidValues) {
      val value = entry as? String ?: continue
      val normalized = normalizeServiceUuid(value) ?: continue
      filters.add(ScanFilter.Builder().setServiceUuid(ParcelUuid(UUID.fromString(normalized))).build())
    }

    val settingsBuilder = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      settingsBuilder.setLegacy(legacy)
    }

    stopBleScanInternal()

    currentBleNamePrefix.set(if (namePrefix.isBlank()) null else namePrefix)
    scanner.startScan(filters, settingsBuilder.build(), bleScanCallback)
    isBleScanRunning = true

    emitBleEvent(
      JSONObject()
        .put("type", "scan_started")
        .put("timestamp", System.currentTimeMillis())
    )

    return success(true)
  }

  private val currentBleNamePrefix = AtomicReference<String?>(null)

  private fun stopBleScanInternal(): Boolean {
    if (!isBleScanRunning) {
      return true
    }

    val scanner = bluetoothAdapter?.bluetoothLeScanner ?: return false
    runCatching { scanner.stopScan(bleScanCallback) }
    isBleScanRunning = false
    currentBleNamePrefix.set(null)

    emitBleEvent(
      JSONObject()
        .put("type", "scan_stopped")
        .put("timestamp", System.currentTimeMillis())
    )

    return true
  }

  private fun connectBle(args: ZynthArgs): JSONObject {
    ensureBleReady()
    ensureConnectPermission()

    val deviceId = args.getString("deviceId")
    val autoConnect = args.getBoolean("autoConnect", false)
    val timeoutMs = args.getInt("timeoutMs", 15000)

    val adapter = bluetoothAdapter ?: return failure("E_UNAVAILABLE", "Bluetooth adapter unavailable")
    val device = runCatching { adapter.getRemoteDevice(deviceId) }.getOrNull()
      ?: return failure("E_NOT_FOUND", "BLE device not found: $deviceId")

    val connectionId = createConnectionId("ble")
    val connectLatch = CountDownLatch(1)
    val connectionRef = AtomicReference<BleConnection?>()

    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        val connection = connectionRef.get() ?: return
        if (status != BluetoothGatt.GATT_SUCCESS) {
          connection.lastError = "GATT status $status"
        }
        connection.connected = newState == BluetoothProfile.STATE_CONNECTED
        emitBleConnection(connection)
        if (newState == BluetoothProfile.STATE_CONNECTED || newState == BluetoothProfile.STATE_DISCONNECTED) {
          connectLatch.countDown()
        }
        if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          cleanupBleConnection(connection.connectionId)
        }
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        val connection = connectionRef.get() ?: return
        val pending = connection.pendingServices ?: return
        connection.pendingServices = null
        if (status == BluetoothGatt.GATT_SUCCESS) {
          val array = JSONArray()
          for (service in gatt.services.orEmpty()) {
            array.put(service.uuid.toString())
          }
          pending.result = array
        } else {
          pending.error = "Service discovery failed with status $status"
        }
        pending.latch.countDown()
      }

      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int,
      ) {
        handleCharacteristicRead(status, value)
      }

      @Deprecated("Deprecated in API 33")
      override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
      ) {
        @Suppress("DEPRECATION")
        val value = characteristic.value ?: ByteArray(0)
        handleCharacteristicRead(status, value)
      }

      private fun handleCharacteristicRead(status: Int, value: ByteArray) {
        val connection = connectionRef.get() ?: return
        val pending = connection.pendingRead ?: return
        connection.pendingRead = null
        if (status == BluetoothGatt.GATT_SUCCESS) {
          pending.result = encodeBase64(value)
        } else {
          pending.error = "Characteristic read failed with status $status"
        }
        pending.latch.countDown()
      }

      override fun onCharacteristicWrite(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
      ) {
        val connection = connectionRef.get() ?: return
        val pending = connection.pendingWrite ?: return
        connection.pendingWrite = null
        logNative("onCharacteristicWrite connection=${connection.connectionId} characteristic=${characteristic.uuid} status=$status")
        if (status == BluetoothGatt.GATT_SUCCESS) {
          pending.result = true
        } else {
          pending.error = "Characteristic write failed with status $status"
        }
        pending.latch.countDown()
      }

      override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
      ) {
        handleCharacteristicChanged(characteristic, value)
      }

      @Deprecated("Deprecated in API 33")
      override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
      ) {
        @Suppress("DEPRECATION")
        val value = characteristic.value ?: ByteArray(0)
        handleCharacteristicChanged(characteristic, value)
      }

      private fun handleCharacteristicChanged(
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
      ) {
        val connection = connectionRef.get() ?: return
        val serviceUuid = characteristic.service?.uuid?.toString().orEmpty()
        emitBleEvent(
          JSONObject()
            .put("type", "characteristic_changed")
            .put("timestamp", System.currentTimeMillis())
            .put("connectionId", connection.connectionId)
            .put("serviceUuid", serviceUuid)
            .put("characteristicUuid", characteristic.uuid.toString())
            .put("dataBase64", encodeBase64(value))
        )
      }

      override fun onReadRemoteRssi(gatt: BluetoothGatt, rssi: Int, status: Int) {
        val connection = connectionRef.get() ?: return
        val pending = connection.pendingRssi ?: return
        connection.pendingRssi = null
        if (status == BluetoothGatt.GATT_SUCCESS) {
          pending.result = rssi
        } else {
          pending.error = "RSSI read failed with status $status"
        }
        pending.latch.countDown()
      }

      override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
        val connection = connectionRef.get() ?: return
        val pending = connection.pendingMtu ?: return
        connection.pendingMtu = null
        if (status == BluetoothGatt.GATT_SUCCESS) {
          connection.mtu = mtu
          pending.result = mtu
        } else {
          pending.error = "MTU request failed with status $status"
        }
        pending.latch.countDown()
      }

      override fun onDescriptorWrite(
        gatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        status: Int,
      ) {
        val connection = connectionRef.get() ?: return
        val pending = connection.pendingNotify ?: return
        connection.pendingNotify = null
        if (status == BluetoothGatt.GATT_SUCCESS) {
          pending.result = true
        } else {
          pending.error = "Notification setup failed with status $status"
        }
        pending.latch.countDown()
      }
    }

    @SuppressLint("MissingPermission")
    val gatt = device.connectGatt(activity, autoConnect, callback)

    val connection = BleConnection(
      connectionId = connectionId,
      device = device,
      gatt = gatt,
    )
    connectionRef.set(connection)
    bleConnections[connectionId] = connection

    val connected = connectLatch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
    if (!connected || !connection.connected) {
      cleanupBleConnection(connectionId)
      return failure("E_TIMEOUT", "BLE connect timeout for device $deviceId")
    }

    emitBleConnection(connection)
    return success(connection.toJson())
  }

  private fun reconnectBle(args: ZynthArgs): JSONObject {
    val policyMap = runCatching { args.getMap("policy") }.getOrNull()
    val maxAttempts = ((policyMap?.get("maxAttempts") as? Number)?.toInt() ?: 4).coerceAtLeast(1)
    val initialDelayMs = ((policyMap?.get("initialDelayMs") as? Number)?.toLong() ?: 500L).coerceAtLeast(100L)
    val maxDelayMs = ((policyMap?.get("maxDelayMs") as? Number)?.toLong() ?: 5000L).coerceAtLeast(100L)
    val multiplier = ((policyMap?.get("backoffMultiplier") as? Number)?.toDouble() ?: 1.7).coerceAtLeast(1.0)

    var delayMs = initialDelayMs
    var lastFailure = failure("E_IO", "BLE reconnect failed")

    repeat(maxAttempts) { attempt ->
      val result = connectBle(args)
      if (result.optBoolean("ok", false)) {
        return result
      }
      lastFailure = result
      if (attempt < maxAttempts - 1) {
        Thread.sleep(delayMs)
        delayMs = min(maxDelayMs, (delayMs * multiplier).toLong())
      }
    }

    return lastFailure
  }

  private fun disconnectBle(args: ZynthArgs): JSONObject {
    val connectionId = args.getString("connectionId")
    val connection = bleConnections.remove(connectionId)
      ?: return failure("E_NOT_FOUND", "BLE connection not found: $connectionId")

    runCatching { connection.gatt.disconnect() }
    runCatching { connection.gatt.close() }
    connection.connected = false
    emitBleConnection(connection)
    return success(true)
  }

  private fun discoverBleServices(args: ZynthArgs): JSONObject {
    ensureConnectPermission()

    val connectionId = args.getString("connectionId")
    val timeoutMs = args.getInt("timeoutMs", 10000)
    val connection = bleConnections[connectionId]
      ?: return failure("E_NOT_FOUND", "BLE connection not found: $connectionId")

    val pending = PendingArrayResult()
    connection.pendingServices = pending

    if (!connection.gatt.discoverServices()) {
      connection.pendingServices = null
      return failure("E_NATIVE", "Failed to start BLE service discovery")
    }

    if (!pending.latch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)) {
      connection.pendingServices = null
      return failure("E_TIMEOUT", "BLE service discovery timeout")
    }

    val error = pending.error
    if (error != null) {
      return failure("E_NATIVE", error)
    }

    return success(pending.result ?: JSONArray())
  }

  private fun readBleCharacteristic(args: ZynthArgs): JSONObject {
    ensureConnectPermission()

    val connection = bleConnectionFromArgs(args) ?: return failure("E_NOT_FOUND", "BLE connection not found")
    val characteristic = characteristicFromArgs(connection.gatt, args)
      ?: return failure("E_NOT_FOUND", "BLE characteristic not found")
    val timeoutMs = args.getInt("timeoutMs", 10000)

    val pending = PendingStringResult()
    connection.pendingRead = pending

    if (!connection.gatt.readCharacteristic(characteristic)) {
      connection.pendingRead = null
      return failure("E_NATIVE", "Failed to start characteristic read")
    }

    if (!pending.latch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)) {
      connection.pendingRead = null
      return failure("E_TIMEOUT", "BLE characteristic read timeout")
    }

    val error = pending.error
    if (error != null) {
      return failure("E_NATIVE", error)
    }

    return success(pending.result ?: "")
  }

  private fun writeBleCharacteristic(args: ZynthArgs): JSONObject {
    ensureConnectPermission()

    val connection = bleConnectionFromArgs(args) ?: return failure("E_NOT_FOUND", "BLE connection not found")
    val characteristic = characteristicFromArgs(connection.gatt, args)
      ?: return failure("E_NOT_FOUND", "BLE characteristic not found")
    val dataBase64 = args.getString("dataBase64")
    val timeoutMs = args.getInt("timeoutMs", 10000)
    val withResponse = args.getBoolean("withResponse", true)

    val data = decodeBase64(dataBase64) ?: return failure("E_INVALID_ARGUMENT", "Invalid base64 payload")
    logNative("writeBleCharacteristic connection=${connection.connectionId} characteristic=${characteristic.uuid} bytes=${data.size} withResponse=$withResponse")

    val pending = PendingBooleanResult()
    connection.pendingWrite = pending

    val writeType = if (withResponse) {
      BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    } else {
      BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
    }

    characteristic.writeType = writeType
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (connection.gatt.writeCharacteristic(characteristic, data, writeType) != BluetoothStatusCodes.SUCCESS) {
        connection.pendingWrite = null
        return failure("E_NATIVE", "Failed to start BLE characteristic write")
      }
    } else {
      @Suppress("DEPRECATION")
      characteristic.value = data
      @Suppress("DEPRECATION")
      if (!connection.gatt.writeCharacteristic(characteristic)) {
        connection.pendingWrite = null
        return failure("E_NATIVE", "Failed to start BLE characteristic write")
      }
    }

    if (!pending.latch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)) {
      connection.pendingWrite = null
      logNative("writeBleCharacteristic timeout connection=${connection.connectionId} characteristic=${characteristic.uuid}")
      return failure("E_TIMEOUT", "BLE characteristic write timeout")
    }

    val error = pending.error
    if (error != null) {
      return failure("E_NATIVE", error)
    }

    return success(true)
  }

  private fun setBleNotification(args: ZynthArgs): JSONObject {
    ensureConnectPermission()

    val connection = bleConnectionFromArgs(args) ?: return failure("E_NOT_FOUND", "BLE connection not found")
    val characteristic = characteristicFromArgs(connection.gatt, args)
      ?: return failure("E_NOT_FOUND", "BLE characteristic not found")
    val enabled = args.getBoolean("enabled", true)
    val timeoutMs = args.getInt("timeoutMs", 10000)

    if (!connection.gatt.setCharacteristicNotification(characteristic, enabled)) {
      return failure("E_NATIVE", "Failed to configure BLE notification at GATT level")
    }

    val cccdUuid = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    val descriptor = characteristic.getDescriptor(cccdUuid)
      ?: return failure("E_NOT_FOUND", "CCCD descriptor not found")

    val pending = PendingBooleanResult()
    connection.pendingNotify = pending

    val value = if (enabled) {
      BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    } else {
      BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (connection.gatt.writeDescriptor(descriptor, value) != BluetoothStatusCodes.SUCCESS) {
        connection.pendingNotify = null
        return failure("E_NATIVE", "Failed to write CCCD descriptor")
      }
    } else {
      @Suppress("DEPRECATION")
      descriptor.value = value
      @Suppress("DEPRECATION")
      if (!connection.gatt.writeDescriptor(descriptor)) {
        connection.pendingNotify = null
        return failure("E_NATIVE", "Failed to write CCCD descriptor")
      }
    }

    if (!pending.latch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)) {
      connection.pendingNotify = null
      return failure("E_TIMEOUT", "BLE notification setup timeout")
    }

    val error = pending.error
    if (error != null) {
      return failure("E_NATIVE", error)
    }

    return success(true)
  }

  private fun requestBleMtu(args: ZynthArgs): JSONObject {
    ensureConnectPermission()

    val connectionId = args.getString("connectionId")
    val mtu = args.getInt("mtu", 247).coerceIn(23, 517)
    val timeoutMs = args.getInt("timeoutMs", 10000)
    val connection = bleConnections[connectionId]
      ?: return failure("E_NOT_FOUND", "BLE connection not found: $connectionId")

    val pending = PendingIntResult()
    connection.pendingMtu = pending

    if (!connection.gatt.requestMtu(mtu)) {
      connection.pendingMtu = null
      return failure("E_NATIVE", "Failed to request BLE MTU")
    }

    if (!pending.latch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)) {
      connection.pendingMtu = null
      return failure("E_TIMEOUT", "BLE MTU request timeout")
    }

    val error = pending.error
    if (error != null) {
      return failure("E_NATIVE", error)
    }

    return success(pending.result ?: connection.mtu)
  }

  private fun readBleRssi(args: ZynthArgs): JSONObject {
    ensureConnectPermission()

    val connectionId = args.getString("connectionId")
    val timeoutMs = args.getInt("timeoutMs", 10000)
    val connection = bleConnections[connectionId]
      ?: return failure("E_NOT_FOUND", "BLE connection not found: $connectionId")

    val pending = PendingIntResult()
    connection.pendingRssi = pending

    if (!connection.gatt.readRemoteRssi()) {
      connection.pendingRssi = null
      return failure("E_NATIVE", "Failed to start BLE RSSI read")
    }

    if (!pending.latch.await(timeoutMs.toLong(), TimeUnit.MILLISECONDS)) {
      connection.pendingRssi = null
      return failure("E_TIMEOUT", "BLE RSSI read timeout")
    }

    val error = pending.error
    if (error != null) {
      return failure("E_NATIVE", error)
    }

    return success(pending.result ?: 0)
  }

  private fun isBlePeripheralSupported(): Boolean {
    if (!isBleSupported()) {
      return false
    }
    val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
    return advertiser != null
  }

  @SuppressLint("MissingPermission")
  private fun startBlePeripheral(args: ZynthArgs): JSONObject {
    ensureBleReady()
    ensureAdvertisePermissions()

    val serviceUuidRaw = args.getString("serviceUuid", "").trim()
    val characteristicUuidRaw = args.getString("characteristicUuid", "").trim()
    if (serviceUuidRaw.isEmpty() || characteristicUuidRaw.isEmpty()) {
      return failure("E_INVALID_ARGUMENT", "serviceUuid and characteristicUuid are required")
    }

    val serviceUuid = runCatching { UUID.fromString(normalizeServiceUuid(serviceUuidRaw) ?: "") }.getOrNull()
      ?: return failure("E_INVALID_ARGUMENT", "Invalid serviceUuid")
    val characteristicUuid = runCatching { UUID.fromString(normalizeServiceUuid(characteristicUuidRaw) ?: "") }.getOrNull()
      ?: return failure("E_INVALID_ARGUMENT", "Invalid characteristicUuid")

    val initialValueRaw = args.getString("initialValueBase64", "")
    val initialValue = if (initialValueRaw.isBlank()) ByteArray(0) else decodeBase64(initialValueRaw)
      ?: return failure("E_INVALID_ARGUMENT", "initialValueBase64 must be valid base64")

    val localName = args.getString("localName", "").trim().takeIf { it.isNotEmpty() }
    val connectable = args.getBoolean("connectable", true)

    stopBlePeripheralInternal()

    val adapter = bluetoothAdapter ?: return failure("E_UNAVAILABLE", "Bluetooth adapter unavailable")
    val manager = bluetoothManager ?: return failure("E_UNAVAILABLE", "Bluetooth manager unavailable")
    val advertiser = adapter.bluetoothLeAdvertiser
      ?: return failure("E_UNAVAILABLE", "BLE advertiser unavailable on this device")

    val characteristic = BluetoothGattCharacteristic(
      characteristicUuid,
      BluetoothGattCharacteristic.PROPERTY_READ or
        BluetoothGattCharacteristic.PROPERTY_WRITE or
        BluetoothGattCharacteristic.PROPERTY_NOTIFY,
      BluetoothGattCharacteristic.PERMISSION_READ or
        BluetoothGattCharacteristic.PERMISSION_WRITE
    )
    blePeripheralCharacteristicValue = initialValue
    val cccd = BluetoothGattDescriptor(
      UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
      BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
    )
    characteristic.addDescriptor(cccd)

    val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    service.addCharacteristic(characteristic)

    val gattServer = manager.openGattServer(appContext, object : BluetoothGattServerCallback() {
      override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
        val centralId = device.address
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          peripheralCentrals[centralId] = device
          emitBleEvent(
            JSONObject()
              .put("type", "peripheral_central_connection")
              .put("timestamp", System.currentTimeMillis())
              .put("centralId", centralId)
              .put("connected", true)
          )
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          peripheralCentrals.remove(centralId)
          emitBleEvent(
            JSONObject()
              .put("type", "peripheral_central_connection")
              .put("timestamp", System.currentTimeMillis())
              .put("centralId", centralId)
              .put("connected", false)
          )
        }
      }

      override fun onCharacteristicReadRequest(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        characteristic: BluetoothGattCharacteristic,
      ) {
        val value = blePeripheralCharacteristicValue
        val response = if (offset >= value.size) ByteArray(0) else value.copyOfRange(offset, value.size)
        bleGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, response)

        emitBleEvent(
          JSONObject()
            .put("type", "peripheral_characteristic_read")
            .put("timestamp", System.currentTimeMillis())
            .put("centralId", device.address)
            .put("serviceUuid", serviceUuid.toString())
            .put("characteristicUuid", characteristic.uuid.toString())
            .put("dataBase64", encodeBase64(response))
        )
      }

      override fun onCharacteristicWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        characteristic: BluetoothGattCharacteristic,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) {
        val frameMeta = if (value.size >= 4) {
          val prefix = value[0].toInt() and 0xFF
          val key = value[1].toInt() and 0xFF
          val index = value[2].toInt() and 0xFF
          val total = value[3].toInt() and 0xFF
          " framePrefix=$prefix key=$key index=$index total=$total"
        } else {
          ""
        }
        logNative("onCharacteristicWriteRequest central=${device.address} characteristic=${characteristic.uuid} bytes=${value.size} responseNeeded=$responseNeeded offset=$offset$frameMeta")
        val current = blePeripheralCharacteristicValue
        val next = if (offset <= 0) {
          value
        } else {
          val resized = ByteArray(maxOf(current.size, offset + value.size))
          current.copyInto(resized, endIndex = current.size)
          value.copyInto(resized, destinationOffset = offset)
          resized
        }
        blePeripheralCharacteristicValue = next

        if (responseNeeded) {
          bleGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
          logNative("onCharacteristicWriteRequest responded success requestId=$requestId prepared=$preparedWrite")
        }

        emitBleEvent(
          JSONObject()
            .put("type", "peripheral_characteristic_write")
            .put("timestamp", System.currentTimeMillis())
            .put("centralId", device.address)
            .put("serviceUuid", serviceUuid.toString())
            .put("characteristicUuid", characteristic.uuid.toString())
            .put("dataBase64", encodeBase64(next))
        )
      }

      override fun onDescriptorReadRequest(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        descriptor: BluetoothGattDescriptor,
      ) {
        logNative("onDescriptorReadRequest central=${device.address} descriptor=${descriptor.uuid}")
        // For CCCD and others, we can just respond with the current value if needed, 
        // but often null/empty is fine for default descriptors.
        bleGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, descriptor.value)
      }

      override fun onDescriptorWriteRequest(
        device: BluetoothDevice,
        requestId: Int,
        descriptor: BluetoothGattDescriptor,
        preparedWrite: Boolean,
        responseNeeded: Boolean,
        offset: Int,
        value: ByteArray,
      ) {
        logNative("onDescriptorWriteRequest central=${device.address} descriptor=${descriptor.uuid} responseNeeded=$responseNeeded")
        descriptor.value = value
        if (responseNeeded) {
          bleGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
        }
      }

      override fun onExecuteWrite(device: BluetoothDevice, requestId: Int, execute: Boolean) {
        logNative("onExecuteWrite central=${device.address} requestId=$requestId execute=$execute")
        bleGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
      }

      override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
        logNative("GATT server MTU changed central=${device.address} mtu=$mtu")
      }
    }) ?: return failure("E_NATIVE", "Failed to open BLE GATT server")

    gattServer.clearServices()
    if (!gattServer.addService(service)) {
      gattServer.close()
      return failure("E_NATIVE", "Failed to add BLE service to GATT server")
    }

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(connectable)
      .build()

    val dataBuilder = AdvertiseData.Builder()
      .addServiceUuid(ParcelUuid(serviceUuid))
      .setIncludeTxPowerLevel(false)
    // Keep advertising payload minimal to avoid ADVERTISE_FAILED_DATA_TOO_LARGE on devices
    // with strict 31-byte advertisement limits.
    dataBuilder.setIncludeDeviceName(false)
    val data = dataBuilder.build()

    // Do not mutate adapter name for mesh advertising. It can enlarge/fragment payload
    // and cause advertise start failures on some Android stacks.
    blePeripheralPreviousAdapterName = null

    val callback = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
        blePeripheralRunning = true
        emitBleEvent(
          JSONObject()
            .put("type", "peripheral_started")
            .put("timestamp", System.currentTimeMillis())
            .put("state", getBlePeripheralState())
        )
      }

      override fun onStartFailure(errorCode: Int) {
        cleanupBlePeripheralResources(emitStoppedEvent = false)
        emitBleError("E_NATIVE", "BLE advertise failed with code $errorCode (${advertiseFailureReason(errorCode)})")
      }
    }

    advertiser.startAdvertising(settings, data, callback)

    bleAdvertiser = advertiser
    bleAdvertiseCallback = callback
    bleGattServer = gattServer
    blePeripheralServiceUuid = serviceUuid
    blePeripheralCharacteristicUuid = characteristicUuid
    blePeripheralCharacteristic = characteristic
    blePeripheralLocalName = localName
    blePeripheralRunning = true

    return success(getBlePeripheralState())
  }

  @SuppressLint("MissingPermission")
  private fun stopBlePeripheralInternal(): Boolean {
    cleanupBlePeripheralResources(emitStoppedEvent = true)
    return true
  }

  @SuppressLint("MissingPermission")
  private fun cleanupBlePeripheralResources(emitStoppedEvent: Boolean) {
    val advertiser = bleAdvertiser
    val callback = bleAdvertiseCallback
    if (advertiser != null && callback != null) {
      runCatching { advertiser.stopAdvertising(callback) }
    }
    bleAdvertiser = null
    bleAdvertiseCallback = null

    runCatching { bleGattServer?.clearServices() }
    runCatching { bleGattServer?.close() }
    bleGattServer = null

    peripheralCentrals.clear()
    blePeripheralCharacteristic = null
    blePeripheralCharacteristicValue = ByteArray(0)
    blePeripheralServiceUuid = null
    blePeripheralCharacteristicUuid = null
    blePeripheralLocalName = null
    blePeripheralRunning = false

    val adapter = bluetoothAdapter
    val previousName = blePeripheralPreviousAdapterName
    if (adapter != null && previousName != null) {
      runCatching { adapter.name = previousName }
    }
    blePeripheralPreviousAdapterName = null

    if (emitStoppedEvent) {
      emitBleEvent(
        JSONObject()
          .put("type", "peripheral_stopped")
          .put("timestamp", System.currentTimeMillis())
          .put("state", getBlePeripheralState())
      )
    }
  }

  private fun getBlePeripheralState(): JSONObject {
    val centrals = JSONArray()
    for (central in peripheralCentrals.keys) {
      centrals.put(central)
    }
    return JSONObject()
      .put("running", blePeripheralRunning)
      .put("localName", blePeripheralLocalName ?: JSONObject.NULL)
      .put("serviceUuid", blePeripheralServiceUuid?.toString() ?: JSONObject.NULL)
      .put("characteristicUuid", blePeripheralCharacteristicUuid?.toString() ?: JSONObject.NULL)
      .put("connectedCentralIds", centrals)
  }

  private fun updateBlePeripheralCharacteristic(args: ZynthArgs): JSONObject {
    ensureAdvertisePermissions()
    val characteristic = blePeripheralCharacteristic
      ?: return failure("E_NOT_CONNECTED", "BLE peripheral is not running")
    val raw = args.getString("dataBase64", "")
    if (raw.isBlank()) {
      return failure("E_INVALID_ARGUMENT", "dataBase64 is required")
    }
    val data = decodeBase64(raw) ?: return failure("E_INVALID_ARGUMENT", "Invalid base64 payload")
    blePeripheralCharacteristicValue = data

    val server = bleGattServer
    if (server != null) {
      for (device in peripheralCentrals.values) {
        runCatching {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            server.notifyCharacteristicChanged(device, characteristic, false, data)
          } else {
            @Suppress("DEPRECATION")
            run {
              characteristic.value = data
              server.notifyCharacteristicChanged(device, characteristic, false)
            }
          }
        }
      }
    }

    return success(true)
  }

  private fun onBleScanResult(result: ScanResult) {
    val device = result.device ?: return
    val prefix = currentBleNamePrefix.get()
    if (!prefix.isNullOrBlank()) {
      val name = device.name ?: result.scanRecord?.deviceName
      if (name == null || !name.startsWith(prefix)) {
        return
      }
    }

    val json = deviceToJson(device, result.rssi)
    bleScannedDevices[device.address] = json

    emitBleEvent(
      JSONObject()
        .put("type", "scan_result")
        .put("timestamp", System.currentTimeMillis())
        .put("device", json)
    )
  }

  private fun classicConnectionsArray(): JSONArray {
    val array = JSONArray()
    for (connection in classicConnections.values) {
      array.put(connection.toJson())
    }
    return array
  }

  private fun bleConnectionsArray(): JSONArray {
    val array = JSONArray()
    for (connection in bleConnections.values) {
      array.put(connection.toJson())
    }
    return array
  }

  private fun cleanupBleConnection(connectionId: String) {
    val connection = bleConnections.remove(connectionId) ?: return
    runCatching { connection.gatt.disconnect() }
    runCatching { connection.gatt.close() }
    connection.connected = false
    
    val error = "Disconnected"
    connection.pendingServices?.let { it.error = error; it.latch.countDown() }
    connection.pendingRead?.let { it.error = error; it.latch.countDown() }
    connection.pendingWrite?.let { it.error = error; it.latch.countDown() }
    connection.pendingNotify?.let { it.error = error; it.latch.countDown() }
    connection.pendingMtu?.let { it.error = error; it.latch.countDown() }
    connection.pendingRssi?.let { it.error = error; it.latch.countDown() }
    
    emitBleConnection(connection)
  }

  private fun disconnectAllClassic() {
    val keys = classicConnections.keys().toList()
    for (key in keys) {
      classicConnections.remove(key)?.close()
    }
  }

  private fun disconnectAllBle() {
    val keys = bleConnections.keys().toList()
    for (key in keys) {
      val connection = bleConnections.remove(key) ?: continue
      runCatching { connection.gatt.disconnect() }
      runCatching { connection.gatt.close() }
      connection.connected = false
    }
  }

  private fun registerClassicReceiverIfNeeded() {
    if (isClassicReceiverRegistered) {
      return
    }

    val filter = IntentFilter().apply {
      addAction(BluetoothAdapter.ACTION_DISCOVERY_STARTED)
      addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
      addAction(BluetoothDevice.ACTION_FOUND)
    }

    appContext.registerReceiver(classicDiscoveryReceiver, filter)
    isClassicReceiverRegistered = true
  }

  private fun unregisterClassicReceiverIfNeeded() {
    if (!isClassicReceiverRegistered) {
      return
    }

    runCatching { appContext.unregisterReceiver(classicDiscoveryReceiver) }
    isClassicReceiverRegistered = false
  }

  private fun ensureClassicReady() {
    if (!isClassicSupported()) {
      throw IllegalStateException("Bluetooth Classic is unavailable on this device")
    }
    if (!isEnabled()) {
      throw IllegalStateException("Bluetooth adapter is disabled")
    }
  }

  private fun ensureBleReady() {
    if (!isBleSupported()) {
      throw IllegalStateException("Bluetooth LE is unavailable on this device")
    }
    if (!isEnabled()) {
      throw IllegalStateException("Bluetooth adapter is disabled")
    }
  }

  private fun ensureDiscoveryPermissions() {
    val status = getPermissions("all")
    if (!status.optBoolean("allGranted", false)) {
      throw SecurityException(
        "Bluetooth discovery permissions not granted (scan=${status.optBoolean("bluetoothScan", false)}, connect=${status.optBoolean("bluetoothConnect", false)}, location=${status.optBoolean("location", false)})"
      )
    }
  }

  private fun ensureConnectPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
      throw SecurityException("Bluetooth connect permission not granted")
    }
  }

  private fun ensureAdvertisePermissions() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (!hasPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
        throw SecurityException("Bluetooth connect permission not granted")
      }
      if (!hasPermission(Manifest.permission.BLUETOOTH_ADVERTISE)) {
        throw SecurityException("Bluetooth advertise permission not granted")
      }
    }
  }

  private fun hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
  }

  private fun emitClassicConnection(connection: ClassicConnection) {
    emitClassicEvent(
      JSONObject()
        .put("type", "connection_state")
        .put("timestamp", System.currentTimeMillis())
        .put("connection", connection.toJson())
    )
  }

  private fun emitBleConnection(connection: BleConnection) {
    emitBleEvent(
      JSONObject()
        .put("type", "connection_state")
        .put("timestamp", System.currentTimeMillis())
        .put("connection", connection.toJson())
    )
  }

  private fun emitClassicError(code: String, message: String) {
    emitClassicEvent(
      JSONObject()
        .put("type", "error")
        .put("timestamp", System.currentTimeMillis())
        .put("code", code)
        .put("message", message)
    )
  }

  private fun emitBleError(code: String, message: String) {
    emitBleEvent(
      JSONObject()
        .put("type", "error")
        .put("timestamp", System.currentTimeMillis())
        .put("code", code)
        .put("message", message)
    )
  }

  private fun emitClassicEvent(payload: JSONObject) {
    runtime.emitEvent("Bluetooth.classicEvent", payload)
  }

  private fun emitBleEvent(payload: JSONObject) {
    runtime.emitEvent("Bluetooth.bleEvent", payload)
  }

  private fun success(data: Any?): JSONObject {
    return JSONObject().put("ok", true).put("data", data)
  }

  private fun failure(code: String, message: String): JSONObject {
    return JSONObject().put("ok", false).put("code", code).put("message", message)
  }

  private fun createConnectionId(prefix: String): String {
    return "$prefix-${System.currentTimeMillis().toString(36)}-${UUID.randomUUID()}"
  }

  private fun decodeBase64(value: String): ByteArray? {
    return runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Base64.getDecoder().decode(value)
      } else {
        @Suppress("DEPRECATION")
        android.util.Base64.decode(value, android.util.Base64.DEFAULT)
      }
    }.getOrNull()
  }

  private fun encodeBase64(value: ByteArray): String {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Base64.getEncoder().encodeToString(value)
    } else {
      @Suppress("DEPRECATION")
      android.util.Base64.encodeToString(value, android.util.Base64.NO_WRAP)
    }
  }

  private fun devicesMapToArray(map: ConcurrentHashMap<String, JSONObject>): JSONArray {
    val array = JSONArray()
    for (entry in map.values) {
      array.put(entry)
    }
    return array
  }

  @SuppressLint("MissingPermission")
  private fun seedClassicFromBondedDevices() {
    ensureConnectPermission()
    val bonded = bluetoothAdapter?.bondedDevices ?: return
    for (device in bonded) {
      val json = deviceToJson(device, null)
      classicDiscoveryDevices[device.address] = json
    }
  }

  @SuppressLint("MissingPermission")
  private fun deviceToJson(device: BluetoothDevice, rssi: Int?): JSONObject {
    return JSONObject()
      .put("id", device.address)
      .put("name", device.name ?: JSONObject.NULL)
      .put("address", device.address)
      .put("rssi", if (rssi == null || rssi == Int.MIN_VALUE) JSONObject.NULL else rssi)
      .put("bondState", device.bondState)
      .put("type", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) device.type else JSONObject.NULL)
  }

  private fun normalizeServiceUuid(value: String): String? {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) {
      return null
    }
    if (trimmed.length == 4) {
      return "0000${trimmed.lowercase()}-0000-1000-8000-00805f9b34fb"
    }
    return runCatching { UUID.fromString(trimmed).toString() }.getOrNull()
  }

  private fun adapterStateName(state: Int): String {
    return when (state) {
      BluetoothAdapter.STATE_OFF -> "OFF"
      BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
      BluetoothAdapter.STATE_ON -> "ON"
      BluetoothAdapter.STATE_TURNING_OFF -> "TURNING_OFF"
      else -> "UNKNOWN($state)"
    }
  }

  private fun advertiseFailureReason(errorCode: Int): String {
    return when (errorCode) {
      AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
      AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
      AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
      AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
      AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
      else -> "UNKNOWN"
    }
  }

  private fun logNative(message: String) {
    if ((appContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      Log.d(logTag, "[ZynthBluetooth][Android] $message")
    }
  }

  private fun isHidPeripheral(deviceClass: BluetoothClass): Boolean {
    if (deviceClass.majorDeviceClass == BluetoothClass.Device.Major.PERIPHERAL) {
      return true
    }
    return when (deviceClass.deviceClass) {
      BluetoothClass.Device.PERIPHERAL_KEYBOARD,
      BluetoothClass.Device.PERIPHERAL_KEYBOARD_POINTING,
      BluetoothClass.Device.PERIPHERAL_POINTING,
      BluetoothClass.Device.PERIPHERAL_NON_KEYBOARD_NON_POINTING -> true
      else -> false
    }
  }

  private fun bleConnectionFromArgs(args: ZynthArgs): BleConnection? {
    val connectionId = args.getString("connectionId")
    return bleConnections[connectionId]
  }

  private fun characteristicFromArgs(gatt: BluetoothGatt, args: ZynthArgs): BluetoothGattCharacteristic? {
    val serviceUuid = runCatching { UUID.fromString(args.getString("serviceUuid")) }.getOrNull() ?: return null
    val characteristicUuid = runCatching { UUID.fromString(args.getString("characteristicUuid")) }.getOrNull() ?: return null
    val service = gatt.getService(serviceUuid) ?: return null
    return service.getCharacteristic(characteristicUuid)
  }

  private fun <T> waitFuture(timeoutMs: Int, future: java.util.concurrent.Future<T>, timeoutMessage: String): JSONObject {
    return try {
      future.get(timeoutMs.toLong(), TimeUnit.MILLISECONDS) as JSONObject
    } catch (_: java.util.concurrent.TimeoutException) {
      future.cancel(true)
      failure("E_TIMEOUT", timeoutMessage)
    } catch (error: Throwable) {
      failure("E_NATIVE", error.message ?: "Native operation failed")
    }
  }

  private inner class ClassicConnection(
    val connectionId: String,
    private val device: BluetoothDevice,
    private val socket: BluetoothSocket,
  ) {
    @Volatile
    var connected: Boolean = true

    @Volatile
    var lastError: String? = null

    val readQueue: java.util.concurrent.ConcurrentLinkedQueue<String> = java.util.concurrent.ConcurrentLinkedQueue()

    fun startReader() {
      ioExecutor.execute {
        try {
          val input = socket.inputStream
          val buffer = ByteArray(2048)
          while (connected) {
            val bytesRead = input.read(buffer)
            if (bytesRead <= 0) {
              connected = false
              break
            }
            val chunk = buffer.copyOf(bytesRead)
            val dataBase64 = encodeBase64(chunk)
            readQueue.add(dataBase64)
            emitClassicEvent(
              JSONObject()
                .put("type", "data")
                .put("timestamp", System.currentTimeMillis())
                .put("connectionId", connectionId)
                .put("dataBase64", dataBase64)
            )
          }
        } catch (error: IOException) {
          connected = false
          lastError = error.message
          emitClassicError("E_IO", "Classic read failed: ${error.message ?: "unknown"}")
        } finally {
          close()
          classicConnections.remove(connectionId)
          emitClassicConnection(this)
        }
      }
    }

    fun write(payload: ByteArray) {
      socket.outputStream.write(payload)
      socket.outputStream.flush()
    }

    fun close() {
      connected = false
      runCatching { socket.close() }
    }

    @SuppressLint("MissingPermission")
    fun toJson(): JSONObject {
      return JSONObject()
        .put("connectionId", connectionId)
        .put("deviceId", device.address)
        .put("name", device.name ?: JSONObject.NULL)
        .put("connected", connected)
        .put("lastError", lastError ?: JSONObject.NULL)
    }
  }

  private inner class BleConnection(
    val connectionId: String,
    val device: BluetoothDevice,
    val gatt: BluetoothGatt,
  ) {
    @Volatile
    var connected: Boolean = true

    @Volatile
    var mtu: Int = 23

    @Volatile
    var lastError: String? = null

    @Volatile
    var pendingServices: PendingArrayResult? = null

    @Volatile
    var pendingRead: PendingStringResult? = null

    @Volatile
    var pendingWrite: PendingBooleanResult? = null

    @Volatile
    var pendingNotify: PendingBooleanResult? = null

    @Volatile
    var pendingMtu: PendingIntResult? = null

    @Volatile
    var pendingRssi: PendingIntResult? = null

    @SuppressLint("MissingPermission")
    fun toJson(): JSONObject {
      return JSONObject()
        .put("connectionId", connectionId)
        .put("deviceId", device.address)
        .put("name", device.name ?: JSONObject.NULL)
        .put("connected", connected)
        .put("mtu", mtu)
        .put("lastError", lastError ?: JSONObject.NULL)
    }
  }

  private class PendingArrayResult {
    val latch = CountDownLatch(1)
    @Volatile
    var result: JSONArray? = null
    @Volatile
    var error: String? = null
  }

  private class PendingStringResult {
    val latch = CountDownLatch(1)
    @Volatile
    var result: String? = null
    @Volatile
    var error: String? = null
  }

  private class PendingBooleanResult {
    val latch = CountDownLatch(1)
    @Volatile
    var result: Boolean = false
    @Volatile
    var error: String? = null
  }

  private class PendingIntResult {
    val latch = CountDownLatch(1)
    @Volatile
    var result: Int? = null
    @Volatile
    var error: String? = null
  }
}

private object BluetoothStatusCodes {
  const val SUCCESS: Int = 0
}

@Suppress("DEPRECATION")
private inline fun <reified T> Intent.getParcelableExtraCompat(name: String): T? {
  return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    getParcelableExtra(name, T::class.java)
  } else {
    getParcelableExtra(name) as? T
  }
}
