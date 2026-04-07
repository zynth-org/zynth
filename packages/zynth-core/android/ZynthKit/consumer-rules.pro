# Yoga exposes a Java API backed by JNI. R8 can incorrectly treat parts of
# the Java-side factory/config/node hierarchy as removable in release builds,
# which breaks YogaNative initialization even though libyoga.so is packaged.
-keep class com.facebook.yoga.** { *; }
-keep class com.facebook.soloader.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.proguard.annotations.** { *; }
-keep class com.facebook.yoga.annotations.** { *; }
-keep @com.facebook.yoga.annotations.DoNotStrip class * { *; }
-keepclassmembers class * {
  @com.facebook.yoga.annotations.DoNotStrip *;
}
