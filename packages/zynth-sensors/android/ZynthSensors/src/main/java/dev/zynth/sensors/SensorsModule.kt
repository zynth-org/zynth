package dev.zynth.sensors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthRuntime
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

private const val SENSOR_ACCELEROMETER = "accelerometer"
private const val SENSOR_BAROMETER = "barometer"
private const val SENSOR_DEVICE_MOTION = "deviceMotion"
private const val SENSOR_GYROSCOPE = "gyroscope"
private const val SENSOR_LIGHT = "lightSensor"
private const val SENSOR_MAGNETOMETER = "magnetometer"
private const val SENSOR_MAGNETOMETER_UNCALIBRATED = "magnetometerUncalibrated"
private const val SENSOR_PEDOMETER = "pedometer"

class SensorsModule(
    private val runtime: ZynthRuntime,
    private val activity: ComponentActivity,
) : ZynthModule, SensorEventListener {
    override val name: String = "Sensors"

    override val exportedMethods: List<String> = listOf(
        "isAvailable",
        "getPermissionStatus",
        "requestPermission",
        "startUpdates",
        "stopUpdates",
        "readCurrent"
    )

    var permissionLauncher: ActivityResultLauncher<String>? = null

    private val sensorManager =
        activity.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    private val activeSensors = mutableSetOf<String>()
    private val latestReadings = ConcurrentHashMap<String, JSONObject>()

    private val deviceMotionState = DeviceMotionState()

    private var pendingPermissionRequestId: String? = null
    private var pendingPermissionSensor: String? = null

    override fun invalidate() {
        stopAll()
    }

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "isAvailable" -> resultResponse(isAvailable(sensorName(args)))
            "getPermissionStatus" -> resultResponse(permissionStatus(sensorName(args)))
            "requestPermission" -> requestPermission(args)
            "startUpdates" -> resultResponse(startUpdates(args))
            "stopUpdates" -> {
                stopUpdates(sensorName(args))
                resultResponse(true)
            }
            "readCurrent" -> resultResponse(readCurrent(sensorName(args)) ?: JSONObject.NULL)
            else -> throw IllegalArgumentException("Unsupported method: $method")
        }
    }

    private fun requestPermission(args: ZynthArgs): JSONObject {
        val sensor = sensorName(args)
        val status = permissionStatus(sensor)

        if (sensor != SENSOR_PEDOMETER || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return resultResponse(status)
        }

        if (status.optString("status") != "undetermined" && status.optString("status") != "denied") {
            return resultResponse(status)
        }

        val launcher = permissionLauncher
            ?: throw IllegalStateException("Permission launcher not initialized")

        val requestId = args.getString("requestId", "perm-${System.currentTimeMillis()}")
        pendingPermissionRequestId = requestId
        pendingPermissionSensor = sensor

        launcher.launch(Manifest.permission.ACTIVITY_RECOGNITION)

        return resultResponse(JSONObject().put("pending", true))
    }

    fun onPermissionResult(granted: Boolean) {
        val requestId = pendingPermissionRequestId ?: return
        val sensor = pendingPermissionSensor ?: SENSOR_PEDOMETER

        val payload = permissionStatus(sensor).apply {
            put("requestId", requestId)
            put("granted", granted)
        }

        runtime.emitEvent("Sensors.permission", payload)

        pendingPermissionRequestId = null
        pendingPermissionSensor = null
    }

    private fun startUpdates(args: ZynthArgs): Boolean {
        val sensor = sensorName(args)
        if (activeSensors.contains(sensor)) {
            return true
        }

        val sampleIntervalMs = max(10, args.getInt("sampleIntervalMs", 100))
        val samplePeriodUs = sampleIntervalMs * 1000

        return when (sensor) {
            SENSOR_ACCELEROMETER -> registerSingleSensor(Sensor.TYPE_ACCELEROMETER, sensor, samplePeriodUs)
            SENSOR_BAROMETER -> registerSingleSensor(Sensor.TYPE_PRESSURE, sensor, samplePeriodUs)
            SENSOR_GYROSCOPE -> registerSingleSensor(Sensor.TYPE_GYROSCOPE, sensor, samplePeriodUs)
            SENSOR_LIGHT -> registerSingleSensor(Sensor.TYPE_LIGHT, sensor, samplePeriodUs)
            SENSOR_MAGNETOMETER -> registerSingleSensor(Sensor.TYPE_MAGNETIC_FIELD, sensor, samplePeriodUs)
            SENSOR_MAGNETOMETER_UNCALIBRATED -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
                    registerSingleSensor(Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED, sensor, samplePeriodUs)
                } else {
                    false
                }
            }
            SENSOR_PEDOMETER -> {
                if (!hasPedometerPermission()) {
                    false
                } else {
                    registerSingleSensor(Sensor.TYPE_STEP_COUNTER, sensor, samplePeriodUs)
                }
            }
            SENSOR_DEVICE_MOTION -> registerDeviceMotion(samplePeriodUs)
            else -> false
        }
    }

    private fun registerSingleSensor(sensorType: Int, sensorName: String, samplePeriodUs: Int): Boolean {
        val sensor = sensorManager.getDefaultSensor(sensorType) ?: return false
        val ok = sensorManager.registerListener(this, sensor, samplePeriodUs)
        if (ok) {
            activeSensors.add(sensorName)
        }
        return ok
    }

    private fun registerDeviceMotion(samplePeriodUs: Int): Boolean {
        val accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        val rotVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

        if (accel == null && gyro == null && rotVector == null) {
            return false
        }

        var registered = false
        if (accel != null) {
            registered = sensorManager.registerListener(this, accel, samplePeriodUs) || registered
        }
        if (gyro != null) {
            registered = sensorManager.registerListener(this, gyro, samplePeriodUs) || registered
        }
        if (rotVector != null) {
            registered = sensorManager.registerListener(this, rotVector, samplePeriodUs) || registered
        }

        if (registered) {
            activeSensors.add(SENSOR_DEVICE_MOTION)
        }

        return registered
    }

    private fun stopUpdates(sensor: String) {
        if (!activeSensors.contains(sensor)) {
            return
        }

        if (sensor == SENSOR_DEVICE_MOTION) {
            sensorManager.unregisterListener(this)
            activeSensors.remove(SENSOR_DEVICE_MOTION)
            return
        }

        val type = when (sensor) {
            SENSOR_ACCELEROMETER -> Sensor.TYPE_ACCELEROMETER
            SENSOR_BAROMETER -> Sensor.TYPE_PRESSURE
            SENSOR_GYROSCOPE -> Sensor.TYPE_GYROSCOPE
            SENSOR_LIGHT -> Sensor.TYPE_LIGHT
            SENSOR_MAGNETOMETER -> Sensor.TYPE_MAGNETIC_FIELD
            SENSOR_MAGNETOMETER_UNCALIBRATED ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
                    Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED
                } else {
                    -1
                }
            SENSOR_PEDOMETER -> Sensor.TYPE_STEP_COUNTER
            else -> -1
        }

        if (type >= 0) {
            sensorManager.getDefaultSensor(type)?.let { nativeSensor ->
                sensorManager.unregisterListener(this, nativeSensor)
            }
        }

        activeSensors.remove(sensor)
    }

    private fun stopAll() {
        sensorManager.unregisterListener(this)
        activeSensors.clear()
    }

    private fun readCurrent(sensor: String): JSONObject? {
        return latestReadings[sensor]
    }

    private fun isAvailable(sensor: String): Boolean {
        return when (sensor) {
            SENSOR_ACCELEROMETER -> sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
            SENSOR_BAROMETER -> sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE) != null
            SENSOR_DEVICE_MOTION ->
                sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null ||
                    sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null ||
                    sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) != null
            SENSOR_GYROSCOPE -> sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
            SENSOR_LIGHT -> sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT) != null
            SENSOR_MAGNETOMETER -> sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null
            SENSOR_MAGNETOMETER_UNCALIBRATED ->
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2 &&
                    sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED) != null
            SENSOR_PEDOMETER -> sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
            else -> false
        }
    }

    private fun permissionStatus(sensor: String): JSONObject {
        if (!isAvailable(sensor)) {
            return JSONObject()
                .put("status", "unavailable")
                .put("granted", false)
                .put("canAskAgain", false)
        }

        if (sensor == SENSOR_PEDOMETER && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val granted = hasPedometerPermission()
            val canAskAgain =
                !granted && activity.shouldShowRequestPermissionRationale(Manifest.permission.ACTIVITY_RECOGNITION)

            val status = when {
                granted -> "granted"
                canAskAgain -> "denied"
                else -> "undetermined"
            }

            return JSONObject()
                .put("status", status)
                .put("granted", granted)
                .put("canAskAgain", !granted)
        }

        return JSONObject()
            .put("status", "granted")
            .put("granted", true)
            .put("canAskAgain", false)
    }

    private fun hasPedometerPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return true
        }
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.ACTIVITY_RECOGNITION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    override fun onSensorChanged(event: SensorEvent?) {
        event ?: return

        val timestampMs = System.currentTimeMillis().toDouble()

        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("x", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                    .put("y", event.values.getOrNull(1)?.toDouble() ?: 0.0)
                    .put("z", event.values.getOrNull(2)?.toDouble() ?: 0.0)

                if (activeSensors.contains(SENSOR_ACCELEROMETER)) {
                    emitReading(SENSOR_ACCELEROMETER, data)
                }

                if (activeSensors.contains(SENSOR_DEVICE_MOTION)) {
                    deviceMotionState.acceleration = doubleArrayOf(
                        event.values.getOrNull(0)?.toDouble() ?: 0.0,
                        event.values.getOrNull(1)?.toDouble() ?: 0.0,
                        event.values.getOrNull(2)?.toDouble() ?: 0.0,
                    )
                    emitDeviceMotion(timestampMs)
                }
            }

            Sensor.TYPE_PRESSURE -> {
                if (!activeSensors.contains(SENSOR_BAROMETER)) return

                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("pressureKPa", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                emitReading(SENSOR_BAROMETER, data)
            }

            Sensor.TYPE_GYROSCOPE -> {
                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("x", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                    .put("y", event.values.getOrNull(1)?.toDouble() ?: 0.0)
                    .put("z", event.values.getOrNull(2)?.toDouble() ?: 0.0)

                if (activeSensors.contains(SENSOR_GYROSCOPE)) {
                    emitReading(SENSOR_GYROSCOPE, data)
                }

                if (activeSensors.contains(SENSOR_DEVICE_MOTION)) {
                    deviceMotionState.rotationRate = doubleArrayOf(
                        event.values.getOrNull(0)?.toDouble() ?: 0.0,
                        event.values.getOrNull(1)?.toDouble() ?: 0.0,
                        event.values.getOrNull(2)?.toDouble() ?: 0.0,
                    )
                    emitDeviceMotion(timestampMs)
                }
            }

            Sensor.TYPE_LIGHT -> {
                if (!activeSensors.contains(SENSOR_LIGHT)) return

                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("illuminanceLux", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                emitReading(SENSOR_LIGHT, data)
            }

            Sensor.TYPE_MAGNETIC_FIELD -> {
                if (!activeSensors.contains(SENSOR_MAGNETOMETER)) return

                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("x", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                    .put("y", event.values.getOrNull(1)?.toDouble() ?: 0.0)
                    .put("z", event.values.getOrNull(2)?.toDouble() ?: 0.0)
                emitReading(SENSOR_MAGNETOMETER, data)
            }

            Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED -> {
                if (!activeSensors.contains(SENSOR_MAGNETOMETER_UNCALIBRATED)) return

                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("x", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                    .put("y", event.values.getOrNull(1)?.toDouble() ?: 0.0)
                    .put("z", event.values.getOrNull(2)?.toDouble() ?: 0.0)
                    .put("biasX", event.values.getOrNull(3)?.toDouble() ?: 0.0)
                    .put("biasY", event.values.getOrNull(4)?.toDouble() ?: 0.0)
                    .put("biasZ", event.values.getOrNull(5)?.toDouble() ?: 0.0)
                emitReading(SENSOR_MAGNETOMETER_UNCALIBRATED, data)
            }

            Sensor.TYPE_STEP_COUNTER -> {
                if (!activeSensors.contains(SENSOR_PEDOMETER)) return

                val data = JSONObject()
                    .put("timestamp", timestampMs)
                    .put("steps", event.values.getOrNull(0)?.toDouble() ?: 0.0)
                emitReading(SENSOR_PEDOMETER, data)
            }

            Sensor.TYPE_ROTATION_VECTOR -> {
                if (!activeSensors.contains(SENSOR_DEVICE_MOTION)) return

                val quaternion = FloatArray(4)
                SensorManager.getQuaternionFromVector(quaternion, event.values)

                val rotationMatrix = FloatArray(9)
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                val orientation = FloatArray(3)
                SensorManager.getOrientation(rotationMatrix, orientation)

                deviceMotionState.quaternion = doubleArrayOf(
                    quaternion.getOrNull(1)?.toDouble() ?: 0.0,
                    quaternion.getOrNull(2)?.toDouble() ?: 0.0,
                    quaternion.getOrNull(3)?.toDouble() ?: 0.0,
                    quaternion.getOrNull(0)?.toDouble() ?: 0.0,
                )
                deviceMotionState.attitude = doubleArrayOf(
                    orientation.getOrNull(1)?.toDouble() ?: 0.0,
                    orientation.getOrNull(2)?.toDouble() ?: 0.0,
                    orientation.getOrNull(0)?.toDouble() ?: 0.0,
                )
                emitDeviceMotion(timestampMs)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // no-op
    }

    private fun emitDeviceMotion(timestampMs: Double) {
        val data = JSONObject().put("timestamp", timestampMs)

        deviceMotionState.acceleration?.let {
            data.put("acceleration", JSONObject().put("x", it[0]).put("y", it[1]).put("z", it[2]))
        }
        deviceMotionState.rotationRate?.let {
            data.put("rotationRate", JSONObject().put("x", it[0]).put("y", it[1]).put("z", it[2]))
        }
        deviceMotionState.attitude?.let {
            val attitude = JSONObject()
                .put("pitch", it[0])
                .put("roll", it[1])
                .put("yaw", it[2])

            deviceMotionState.quaternion?.let { quat ->
                attitude.put(
                    "quaternion",
                    JSONObject().put("x", quat[0]).put("y", quat[1]).put("z", quat[2]).put("w", quat[3]),
                )
            }

            data.put("attitude", attitude)
        }

        emitReading(SENSOR_DEVICE_MOTION, data)
    }

    private fun emitReading(sensor: String, data: JSONObject) {
        latestReadings[sensor] = data
        runtime.emitEvent(
            "Sensors.update",
            JSONObject()
                .put("sensor", sensor)
                .put("data", data),
        )
    }

    private fun sensorName(args: ZynthArgs): String {
        return args.getString("sensor", "")
    }

    private data class DeviceMotionState(
        var acceleration: DoubleArray? = null,
        var rotationRate: DoubleArray? = null,
        var attitude: DoubleArray? = null,
        var quaternion: DoubleArray? = null,
    )

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().put("result", result)
    }
}
