pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "{{APP_NAME}}Android"
include(":app")
include(":RuneKit")
project(":RuneKit").projectDir = file("../../../native/android/RuneKit")
