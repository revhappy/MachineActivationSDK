// JNI bridge: llama.cpp + mtmd (multimodal) for the Machine Activation SDK.
//
// This is the GGUF runtime. It exists alongside the LiteRT-LM path, which only
// accepts .litertlm packages and has no concept of a separate image projector.
// Vision GGUF models ship as two files — the weights and an mmproj projector —
// and mtmd_init_from_file() is what binds them together.

#include <jni.h>
#include <android/log.h>

#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"

#define LOG_TAG "MachineActivation"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

struct Session {
    llama_model   * model  = nullptr;
    llama_context * ctx    = nullptr;
    mtmd_context  * mtmd   = nullptr;
    llama_sampler * sampler = nullptr;
    int             n_threads = 4;
    std::mutex      mutex;   // one generation at a time; mtmd helpers are not thread-safe
};

std::once_flag g_backend_once;

void log_forward(ggml_log_level level, const char * text, void * /*user*/) {
    if (text == nullptr) return;
    if (level == GGML_LOG_LEVEL_ERROR) {
        LOGE("%s", text);
    } else {
        LOGI("%s", text);
    }
}

void ensure_backend() {
    std::call_once(g_backend_once, []() {
        llama_log_set(log_forward, nullptr);
        mtmd_helper_log_set(log_forward, nullptr);
        llama_backend_init();
    });
}

std::string jstring_to_std(JNIEnv * env, jstring value) {
    if (value == nullptr) return {};
    const char * chars = env->GetStringUTFChars(value, nullptr);
    std::string out(chars ? chars : "");
    if (chars) env->ReleaseStringUTFChars(value, chars);
    return out;
}

void throw_java(JNIEnv * env, const std::string & message) {
    jclass clazz = env->FindClass("java/lang/RuntimeException");
    if (clazz != nullptr) env->ThrowNew(clazz, message.c_str());
}

// Render a chat-templated prompt using whatever template the GGUF carries, so
// this works for any model rather than hardcoding one family's format.
std::string apply_chat_template(llama_model * model,
                                const std::string & system_prompt,
                                const std::string & user_prompt) {
    const char * tmpl = llama_model_chat_template(model, nullptr);

    std::vector<llama_chat_message> messages;
    if (!system_prompt.empty()) {
        messages.push_back({"system", system_prompt.c_str()});
    }
    messages.push_back({"user", user_prompt.c_str()});

    if (tmpl == nullptr) {
        // No template in the GGUF — fall back to a plain concatenation rather
        // than failing the whole request.
        std::string fallback;
        if (!system_prompt.empty()) fallback += system_prompt + "\n\n";
        fallback += user_prompt;
        return fallback;
    }

    std::vector<char> buf(std::max<size_t>(2048, (system_prompt.size() + user_prompt.size()) * 2));
    int32_t written = llama_chat_apply_template(
        tmpl, messages.data(), messages.size(), true, buf.data(), (int32_t) buf.size());

    if (written > (int32_t) buf.size()) {
        buf.resize(written);
        written = llama_chat_apply_template(
            tmpl, messages.data(), messages.size(), true, buf.data(), (int32_t) buf.size());
    }
    if (written < 0) {
        std::string fallback;
        if (!system_prompt.empty()) fallback += system_prompt + "\n\n";
        fallback += user_prompt;
        return fallback;
    }
    return std::string(buf.data(), written);
}

std::string token_to_text(const llama_vocab * vocab, llama_token token) {
    char buf[256];
    int32_t n = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, true);
    if (n < 0) {
        std::vector<char> big(-n);
        n = llama_token_to_piece(vocab, token, big.data(), (int32_t) big.size(), 0, true);
        if (n < 0) return {};
        return std::string(big.data(), n);
    }
    return std::string(buf, n);
}

} // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_ai_machine_activation_capacitor_LlamaRuntime_nativeLoad(
    JNIEnv * env, jclass /*clazz — @JvmStatic companion method*/,
    jstring j_model_path, jstring j_mmproj_path,
    jint n_ctx, jint n_threads, jint n_gpu_layers) {

    ensure_backend();

    const std::string model_path  = jstring_to_std(env, j_model_path);
    const std::string mmproj_path = jstring_to_std(env, j_mmproj_path);

    if (model_path.empty()) {
        throw_java(env, "Model path is empty.");
        return 0;
    }

    auto * session = new Session();
    session->n_threads = n_threads > 0 ? n_threads : 4;

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = n_gpu_layers;

    session->model = llama_model_load_from_file(model_path.c_str(), model_params);
    if (session->model == nullptr) {
        delete session;
        throw_java(env, "Failed to load GGUF model: " + model_path);
        return 0;
    }

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx      = n_ctx > 0 ? (uint32_t) n_ctx : 4096;
    ctx_params.n_batch    = 512;
    ctx_params.n_threads  = session->n_threads;
    ctx_params.n_threads_batch = session->n_threads;

    session->ctx = llama_init_from_model(session->model, ctx_params);
    if (session->ctx == nullptr) {
        llama_model_free(session->model);
        delete session;
        throw_java(env, "Failed to create llama context.");
        return 0;
    }

    // The projector is what makes a vision GGUF usable. Without it the model
    // loads but cannot see, so a missing mmproj is reported rather than
    // silently degrading to text-only.
    if (!mmproj_path.empty()) {
        mtmd_context_params mparams = mtmd_context_params_default();
        mparams.use_gpu        = n_gpu_layers > 0;
        mparams.print_timings  = false;
        mparams.n_threads      = session->n_threads;
        mparams.media_marker   = mtmd_default_marker();

        session->mtmd = mtmd_init_from_file(mmproj_path.c_str(), session->model, mparams);
        if (session->mtmd == nullptr) {
            llama_free(session->ctx);
            llama_model_free(session->model);
            delete session;
            throw_java(env, "Failed to load image projector (mmproj): " + mmproj_path);
            return 0;
        }
    }

    session->sampler = llama_sampler_chain_init(llama_sampler_chain_default_params());
    // Greedy: the analysis handlers want strict JSON, and determinism makes a
    // malformed-output bug reproducible instead of intermittent.
    llama_sampler_chain_add(session->sampler, llama_sampler_init_greedy());

    LOGI("loaded model=%s mmproj=%s n_ctx=%d threads=%d",
         model_path.c_str(),
         mmproj_path.empty() ? "(none)" : mmproj_path.c_str(),
         (int) ctx_params.n_ctx, session->n_threads);

    return reinterpret_cast<jlong>(session);
}

JNIEXPORT jboolean JNICALL
Java_ai_machine_activation_capacitor_LlamaRuntime_nativeSupportsVision(
    JNIEnv * /*env*/, jobject /*thiz*/, jlong handle) {
    auto * session = reinterpret_cast<Session *>(handle);
    if (session == nullptr || session->mtmd == nullptr) return JNI_FALSE;
    return mtmd_support_vision(session->mtmd) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_ai_machine_activation_capacitor_LlamaRuntime_nativeGenerate(
    JNIEnv * env, jobject /*thiz*/,
    jlong handle, jstring j_system, jstring j_user,
    jbyteArray j_image, jint max_tokens) {

    auto * session = reinterpret_cast<Session *>(handle);
    if (session == nullptr) {
        throw_java(env, "Session handle is not valid.");
        return nullptr;
    }

    std::lock_guard<std::mutex> lock(session->mutex);

    const std::string system_prompt = jstring_to_std(env, j_system);
    std::string user_prompt         = jstring_to_std(env, j_user);

    std::vector<uint8_t> image_bytes;
    if (j_image != nullptr) {
        const jsize len = env->GetArrayLength(j_image);
        image_bytes.resize((size_t) len);
        env->GetByteArrayRegion(j_image, 0, len, reinterpret_cast<jbyte *>(image_bytes.data()));
    }

    const bool want_image = !image_bytes.empty();
    if (want_image && session->mtmd == nullptr) {
        throw_java(env, "An image was supplied but no image projector (mmproj) is loaded.");
        return nullptr;
    }

    // The marker tells mtmd where in the prompt the image embeddings belong.
    if (want_image) {
        user_prompt = std::string(mtmd_default_marker()) + "\n" + user_prompt;
    }

    const std::string prompt = apply_chat_template(session->model, system_prompt, user_prompt);

    // Fresh KV cache per request: these are one-shot analyses, not a chat that
    // should inherit the previous label's context.
    llama_memory_clear(llama_get_memory(session->ctx), true);

    const llama_vocab * vocab = llama_model_get_vocab(session->model);
    llama_pos n_past = 0;

    if (want_image) {
        mtmd_input_chunks * chunks = mtmd_input_chunks_init();

        mtmd_helper_bitmap_wrapper wrapper =
            mtmd_helper_bitmap_init_from_buf(session->mtmd, image_bytes.data(), image_bytes.size(), false);
        if (wrapper.bitmap == nullptr) {
            mtmd_input_chunks_free(chunks);
            throw_java(env, "Could not decode the supplied image.");
            return nullptr;
        }

        mtmd_input_text text {};
        text.text          = prompt.c_str();
        text.text_len      = prompt.size();
        text.add_special   = true;
        text.parse_special = true;

        const mtmd_bitmap * bitmaps[1] = { wrapper.bitmap };
        const int32_t rc = mtmd_tokenize(session->mtmd, chunks, &text, bitmaps, 1);
        mtmd_bitmap_free(wrapper.bitmap);

        if (rc != 0) {
            mtmd_input_chunks_free(chunks);
            throw_java(env, "mtmd_tokenize failed with code " + std::to_string(rc));
            return nullptr;
        }

        const int32_t eval = mtmd_helper_eval_chunks(
            session->mtmd, session->ctx, chunks,
            /*n_past*/ 0, /*seq_id*/ 0, /*n_batch*/ 512,
            /*logits_last*/ true, &n_past);
        mtmd_input_chunks_free(chunks);

        if (eval != 0) {
            throw_java(env, "Failed to evaluate image+text chunks, code " + std::to_string(eval));
            return nullptr;
        }
    } else {
        const int32_t n_tokens = -llama_tokenize(
            vocab, prompt.c_str(), (int32_t) prompt.size(), nullptr, 0, true, true);
        std::vector<llama_token> tokens(n_tokens);
        if (llama_tokenize(vocab, prompt.c_str(), (int32_t) prompt.size(),
                           tokens.data(), n_tokens, true, true) < 0) {
            throw_java(env, "Failed to tokenize prompt.");
            return nullptr;
        }

        llama_batch batch = llama_batch_get_one(tokens.data(), (int32_t) tokens.size());
        if (llama_decode(session->ctx, batch) != 0) {
            throw_java(env, "Failed to decode prompt.");
            return nullptr;
        }
        n_past = (llama_pos) tokens.size();
    }

    std::string output;
    const int limit = max_tokens > 0 ? max_tokens : 2048;

    for (int i = 0; i < limit; ++i) {
        const llama_token token = llama_sampler_sample(session->sampler, session->ctx, -1);
        if (llama_vocab_is_eog(vocab, token)) break;

        output += token_to_text(vocab, token);
        llama_sampler_accept(session->sampler, token);

        llama_token next = token;
        llama_batch batch = llama_batch_get_one(&next, 1);
        if (llama_decode(session->ctx, batch) != 0) {
            LOGE("decode failed at token %d, returning partial output", i);
            break;
        }
        n_past++;
    }

    return env->NewStringUTF(output.c_str());
}

JNIEXPORT void JNICALL
Java_ai_machine_activation_capacitor_LlamaRuntime_nativeFree(
    JNIEnv * /*env*/, jobject /*thiz*/, jlong handle) {
    auto * session = reinterpret_cast<Session *>(handle);
    if (session == nullptr) return;

    if (session->sampler) llama_sampler_free(session->sampler);
    if (session->mtmd)    mtmd_free(session->mtmd);
    if (session->ctx)     llama_free(session->ctx);
    if (session->model)   llama_model_free(session->model);
    delete session;
}

} // extern "C"
