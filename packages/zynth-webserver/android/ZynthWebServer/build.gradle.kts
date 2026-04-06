plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

val zynthWebServerTlsEnabled =
    providers.gradleProperty("zynthWebServerTls")
        .map { it.equals("true", ignoreCase = true) }
        .orElse(false)

android {
    namespace = "dev.zynth.webserver"
    compileSdk = 35
    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        minSdk = 24
        buildConfigField(
            "boolean",
            "ZYNTH_WEBSERVER_TLS_REQUESTED",
            if (zynthWebServerTlsEnabled.get()) "true" else "false"
        )
        externalNativeBuild {
            cmake {
                cppFlags("-fexceptions", "-frtti", "-std=c++17")
                arguments(
                    "-DZYNTH_WEBSERVER_ENABLE_TLS=${
                        if (zynthWebServerTlsEnabled.get()) "ON" else "OFF"
                    }"
                )
            }
        }
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    externalNativeBuild {
        cmake {
            path = file("CMakeLists.txt")
        }
    }
}

dependencies {
    implementation(project(":ZynthKit"))
    implementation("androidx.core:core-ktx:1.12.0")
}
