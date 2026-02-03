plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.zynth.animate"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
        targetSdk = 34
        externalNativeBuild {
            cmake {
                cppFlags("-fexceptions", "-frtti", "-std=c++17")
                arguments("-DANDROID_STL=c++_shared")
            }
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

    buildFeatures {
        prefab = true
    }

    externalNativeBuild {
        cmake {
            path = file("CMakeLists.txt")
        }
    }

    packaging {
        jniLibs {
            excludes += setOf(
                "**/libc++_shared.so",
                "**/libfbjni.so"
            )
        }
    }
}

dependencies {
    implementation(project(":ZynthKit"))
    compileOnly("com.facebook.react:react-android:0.84.0-rc.1")
}
