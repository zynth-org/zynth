package dev.zynth.securestore

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.zynth.kit.runtime.ZynthModule
import com.zynth.kit.runtime.ZynthSyncModule
import com.zynth.kit.runtime.ZynthArgs
import org.json.JSONObject
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class ZynthSecureStoreModule(
    activity: Activity
) : ZynthModule, ZynthSyncModule {
    override val name: String = "ZynthSecureStore"
    private val context: Context = activity.applicationContext
    private val activityRef = java.lang.ref.WeakReference(activity)
    private val stores = mutableMapOf<String, SharedPreferences>()

    override fun call(method: String, args: ZynthArgs): JSONObject {
        return when (method) {
            "getItem" -> {
                val key = args.getString("key")
                try {
                    val options = parseOptions(args)
                    val value = performAuthenticated(options) {
                        performWithStore(options) { store ->
                            store.getString(key, null)
                        }
                    }
                    resultResponse(value)
                } catch (e: Exception) {
                    errorResponse("get_failed", e.message ?: "unknown")
                }
            }
            "setItem" -> {
                val key = args.getString("key")
                val value = args.getString("value")
                try {
                    val options = parseOptions(args)
                    performAuthenticated(options) {
                        performWithStore(options) { store ->
                            store.edit().putString(key, value).apply()
                            null
                        }
                    }
                    successResponse()
                } catch (e: Exception) {
                    errorResponse("set_failed", e.message ?: "unknown")
                }
            }
            "deleteItem" -> {
                val key = args.getString("key")
                try {
                    val options = parseOptions(args)
                    performAuthenticated(options) {
                        performWithStore(options) { store ->
                            store.edit().remove(key).apply()
                            null
                        }
                    }
                    successResponse()
                } catch (e: Exception) {
                    errorResponse("delete_failed", e.message ?: "unknown")
                }
            }
            "isAvailable" -> resultResponse(true)
            "canUseBiometricAuthentication" -> resultResponse(canUseBiometrics())
            else -> errorResponse("unsupported_method", method)
        }
    }

    override fun callSync(method: String, args: ZynthArgs): Any? {
        return when (method) {
            "getItem" -> {
                val key = try { args.getString("key") } catch (e: Exception) { null } ?: return null
                return try {
                    val options = parseOptions(args)
                    performAuthenticated(options) {
                        performWithStore(options) { store ->
                            store.getString(key, null)
                        }
                    }
                } catch (e: Exception) {
                    errorMap("get_failed", e.message ?: "unknown")
                }
            }
            "setItem" -> {
                val key = try { args.getString("key") } catch (e: Exception) { null } ?: return null
                val value = try { args.getString("value") } catch (e: Exception) { null } ?: return null
                return try {
                    val options = parseOptions(args)
                    performAuthenticated(options) {
                        performWithStore(options) { store ->
                            store.edit().putString(key, value).apply()
                            null
                        }
                    }
                    null
                } catch (e: Exception) {
                    errorMap("set_failed", e.message ?: "unknown")
                }
            }
            "deleteItem" -> {
                val key = try { args.getString("key") } catch (e: Exception) { null } ?: return null
                return try {
                    val options = parseOptions(args)
                    performAuthenticated(options) {
                        performWithStore(options) { store ->
                            store.edit().remove(key).apply()
                            null
                        }
                    }
                    null
                } catch (e: Exception) {
                    errorMap("delete_failed", e.message ?: "unknown")
                }
            }
            "isAvailable" -> true
            "canUseBiometricAuthentication" -> canUseBiometrics()
            else -> null
        }
    }

    private fun parseOptions(args: ZynthArgs): SecureStoreOptions {
        val optionsValue = try { args.getMap("options") } catch (e: Exception) { null }
        return SecureStoreOptions.from(optionsValue)
    }

    private fun getStore(options: SecureStoreOptions): SharedPreferences {
        val service = options.keychainService ?: "zynth_secure_store"
        val requiresAuth = options.requireAuthentication
        val storeKey = if (requiresAuth) "${service}_auth" else "${service}_default"
        return stores.getOrPut(storeKey) {
            val alias = if (requiresAuth) "${service}_auth_key_v2" else "${service}_key"
            createEncryptedPrefs(storeKey, alias)
        }
    }

    private fun <T> performWithStore(
        options: SecureStoreOptions,
        action: (SharedPreferences) -> T
    ): T {
        val service = options.keychainService ?: "zynth_secure_store"
        val requiresAuth = options.requireAuthentication
        val storeKey = if (requiresAuth) "${service}_auth" else "${service}_default"
        val alias = if (requiresAuth) "${service}_auth_key_v2" else "${service}_key"
        try {
            val store = getStore(options)
            return action(store)
        } catch (e: Exception) {
            if (isUnusableKeyError(e)) {
                stores.remove(storeKey)
                deleteMasterKey(alias)
                context.getSharedPreferences(storeKey, Context.MODE_PRIVATE)
                    .edit()
                    .clear()
                    .apply()
                val store = getStore(options)
                return action(store)
            }
            throw e
        }
    }

    private fun <T> performAuthenticated(
        options: SecureStoreOptions,
        action: () -> T
    ): T {
        if (!options.requireAuthentication) {
            return action()
        }
        val activity = activityRef.get()
            ?: throw IllegalStateException("Activity unavailable for authentication")
        val fragmentActivity = activity as? FragmentActivity
            ?: throw IllegalStateException("Authentication requires FragmentActivity")
        val authErrorRef = AtomicReference<Throwable?>()
        val authSuccessRef = AtomicReference(false)
        val latch = CountDownLatch(1)
        val promptMessage = options.authenticationPrompt
            ?: "Authenticate to access secure data"

        Handler(Looper.getMainLooper()).post {
            val executor = ContextCompat.getMainExecutor(fragmentActivity)
            val prompt = BiometricPrompt(
                fragmentActivity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(
                        result: BiometricPrompt.AuthenticationResult
                    ) {
                        authSuccessRef.set(true)
                        latch.countDown()
                    }

                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence
                    ) {
                        authErrorRef.set(IllegalStateException(errString.toString()))
                        latch.countDown()
                    }
                }
            )

            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Authentication")
                .setDescription(promptMessage)
                .setNegativeButtonText("Cancel")
                .build()
            prompt.authenticate(promptInfo)
        }

        if (!latch.await(AUTH_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw IllegalStateException("Authentication timeout")
        }
        authErrorRef.get()?.let { throw it }
        if (!authSuccessRef.get()) {
            throw IllegalStateException("Authentication failed")
        }
        return action()
    }

    private fun createEncryptedPrefs(
        storeKey: String,
        alias: String
    ): SharedPreferences {
        return try {
            val masterKeyBuilder = MasterKey.Builder(context, alias)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            val masterKey = masterKeyBuilder.build()
            EncryptedSharedPreferences.create(
                context,
                storeKey,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (error: Exception) {
            deleteMasterKey(alias)
            context.getSharedPreferences(storeKey, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
            val masterKeyBuilder = MasterKey.Builder(context, alias)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            val masterKey = masterKeyBuilder.build()
            EncryptedSharedPreferences.create(
                context,
                storeKey,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }
    }

    private fun deleteMasterKey(alias: String) {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
        } catch (_: Exception) {
            // Ignore cleanup failures
        }
    }

    private fun isUnusableKeyError(error: Exception): Boolean {
        val message = error.message ?: return false
        if (message.contains("exists but is unusable", ignoreCase = true)) {
            return true
        }
        return message.contains("KeyPermanentlyInvalidatedException", ignoreCase = true)
    }

    private fun canUseBiometrics(): Boolean {
        val manager = BiometricManager.from(context)
        val result = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        return result == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun resultResponse(result: Any?): JSONObject {
        return JSONObject().apply {
            put("result", result ?: JSONObject.NULL)
        }
    }

    private fun successResponse(): JSONObject {
        return JSONObject().apply {
            put("success", true)
        }
    }

    private fun errorResponse(error: String, message: String): JSONObject {
        return JSONObject().apply {
            put("error", error)
            put("message", message)
        }
    }

    private fun errorMap(error: String, message: String): Map<String, Any> {
        return mapOf("error" to error, "message" to message)
    }

    private data class SecureStoreOptions(
        val keychainService: String?,
        val requireAuthentication: Boolean,
        val authenticationPrompt: String?
    ) {
        companion object {
            fun from(value: Map<String, Any?>?): SecureStoreOptions {
                if (value == null) return SecureStoreOptions(null, false, null)
                return SecureStoreOptions(
                    keychainService = value["keychainService"] as? String,
                    requireAuthentication = value["requireAuthentication"] as? Boolean ?: false,
                    authenticationPrompt = value["authenticationPrompt"] as? String
                )
            }
        }
    }

    private companion object {
        private const val AUTH_TIMEOUT_SECONDS = 30L
    }
}
