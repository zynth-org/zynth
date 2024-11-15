import java.io.File
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

val runeAndroidDir = listOf(
  File(rootDir, "../node_modules"),
  File(rootDir, "../../node_modules"),
  File(rootDir, "../../../node_modules"),
  File(rootDir, "../../../../node_modules")
).map { File(it, "@rune/android/android/RuneKit") }
  .firstOrNull { it.exists() }
  ?: error("Unable to locate @rune/android package from $rootDir")

project(":RuneKit").projectDir = runeAndroidDir
