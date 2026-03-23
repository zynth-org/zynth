package dev.zynth.webserver

object ZynthWebServerNative {
    init {
        System.loadLibrary("zynthwebserver")
    }

    external fun start(
        host: String?,
        port: Int,
        tlsEnabled: Boolean,
        tlsCertificate: String?,
        documentRoot: String?,
        indexHtml: String?,
        uploadPath: String?,
        uploadDir: String?,
        uploadMetadataPath: String?,
        uploadAuthToken: String?,
        uploadAuthHeader: String?,
        uploadAuthQueryKey: String?,
        maxUploadBytes: Long,
        eventsPath: String?
    ): Long

    external fun supportsTls(): Boolean
    external fun generateSelfSignedPem(commonName: String?, validDays: Int): String?
    external fun getLastError(): String?

    external fun stop(handle: Long)

    external fun isRunning(handle: Long): Boolean

    external fun getPort(handle: Long): Int

    external fun drainEvents(handle: Long, maxEvents: Int): Array<NativeWebServerEvent>
    external fun getUploadStateJson(handle: Long): String?
    external fun setReply(handle: Long, key: String, payloadJson: String): Boolean
    external fun getReplyJson(handle: Long, key: String, consume: Boolean): String?
}
