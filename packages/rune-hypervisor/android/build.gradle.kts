plugins {
    id("com.android.library")
    id("kotlin-android")
}

android {
    namespace = "com.rune.hypervisor"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation(project(":packages:rune-android:android:RuneKit"))
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
}
