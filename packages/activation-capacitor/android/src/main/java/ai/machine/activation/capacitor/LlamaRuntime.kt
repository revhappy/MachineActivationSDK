package ai.machine.activation.capacitor

import android.util.Log
import java.io.File

/**
 * GGUF runtime backed by llama.cpp + mtmd.
 *
 * This is the second runtime in the SDK. The LiteRT-LM path takes a single
 * self-contained `.litertlm` package; GGUF vision models instead ship as two
 * files — the quantized weights and an `mmproj` image projector — and both must
 * be handed to the engine together or the model loads blind.
 *
 * One [LlamaRuntime] owns one native session. Generation is serialised natively
 * because the mtmd helpers are explicitly not thread-safe.
 */
class LlamaRuntime private constructor(
    private var handle: Long,
    val modelPath: String,
    val projectorPath: String?,
) : AutoCloseable {

    val supportsVision: Boolean
        get() = handle != 0L && nativeSupportsVision(handle)

    /**
     * @param image raw encoded image bytes (JPEG/PNG). mtmd decodes these via
     *   stb_image, so no bitmap conversion is needed on the Kotlin side.
     */
    fun generate(
        systemPrompt: String,
        userPrompt: String,
        image: ByteArray? = null,
        maxTokens: Int = 2048,
    ): String {
        check(handle != 0L) { "LlamaRuntime has already been closed." }
        return nativeGenerate(handle, systemPrompt, userPrompt, image, maxTokens)
    }

    override fun close() {
        if (handle != 0L) {
            nativeFree(handle)
            handle = 0L
        }
    }

    private external fun nativeSupportsVision(handle: Long): Boolean
    private external fun nativeGenerate(
        handle: Long,
        systemPrompt: String,
        userPrompt: String,
        image: ByteArray?,
        maxTokens: Int,
    ): String
    private external fun nativeFree(handle: Long)

    companion object {
        private const val TAG = "MachineActivation"

        init {
            System.loadLibrary("machineactivation")
        }

        /** Extensions this runtime claims. Everything else falls to LiteRT-LM. */
        fun handlesModel(path: String): Boolean = path.lowercase().endsWith(".gguf")

        /**
         * A projector sitting next to the weights is the common layout for
         * downloaded vision GGUFs (`mmproj-*.gguf`), so it is picked up
         * automatically when the caller did not name one.
         */
        fun findSiblingProjector(modelPath: String): String? {
            val model = File(modelPath)
            val dir = model.parentFile ?: return null
            return dir.listFiles()
                ?.firstOrNull {
                    val n = it.name.lowercase()
                    n.endsWith(".gguf") && n.contains("mmproj") && it.absolutePath != model.absolutePath
                }
                ?.absolutePath
        }

        fun load(
            modelPath: String,
            projectorPath: String? = null,
            contextTokens: Int = 4096,
            threads: Int = defaultThreads(),
            gpuLayers: Int = 0,
        ): LlamaRuntime {
            require(File(modelPath).exists()) { "GGUF model not found at $modelPath" }

            val resolvedProjector = projectorPath?.takeIf { it.isNotBlank() }
                ?: findSiblingProjector(modelPath)

            if (resolvedProjector != null) {
                require(File(resolvedProjector).exists()) {
                    "Image projector not found at $resolvedProjector"
                }
            } else {
                Log.w(TAG, "No mmproj projector for $modelPath — vision will be unavailable.")
            }

            val handle = nativeLoad(
                modelPath,
                resolvedProjector ?: "",
                contextTokens,
                threads,
                gpuLayers,
            )
            check(handle != 0L) { "Native loader returned a null session for $modelPath" }

            return LlamaRuntime(handle, modelPath, resolvedProjector)
        }

        /** Leave a core free so the UI thread is not starved during generation. */
        private fun defaultThreads(): Int =
            (Runtime.getRuntime().availableProcessors() - 1).coerceIn(2, 8)

        @JvmStatic
        private external fun nativeLoad(
            modelPath: String,
            projectorPath: String,
            contextTokens: Int,
            threads: Int,
            gpuLayers: Int,
        ): Long
    }
}
