# ZynthSkia's native JSI layer resolves SkiaBridge by exact JNI names during
# libzynthskia startup. Release R8 must not remove or rename these methods.
-keep class dev.zynth.skia.SkiaBridge { *; }

-keepclasseswithmembernames class dev.zynth.skia.** {
  native <methods>;
}
