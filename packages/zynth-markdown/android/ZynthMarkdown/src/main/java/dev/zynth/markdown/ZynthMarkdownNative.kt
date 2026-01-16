package dev.zynth.markdown

object ZynthMarkdownNative {
    init {
        System.loadLibrary("zynthmarkdown")
    }

    external fun parse(content: String, options: Int, extensions: Int): String?
}
