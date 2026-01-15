package dev.rune.webserver

object RuneWebServerNative {
    init {
        System.loadLibrary("runewebserver")
    }

    external fun start(
        host: String?,
        port: Int,
        documentRoot: String?,
        indexHtml: String?,
        uploadPath: String?,
        uploadDir: String?,
        maxUploadBytes: Long,
        eventsPath: String?
    ): Long

    external fun stop(handle: Long)

    external fun isRunning(handle: Long): Boolean

    external fun getPort(handle: Long): Int

    external fun drainEvents(handle: Long, maxEvents: Int): Array<NativeWebServerEvent>
}
