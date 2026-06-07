# LiteRT-LM Android Integration Notes

This file records concrete integration lessons from an Android LiteRT-LM bridge used with the Machine Activation SDK.

## Confirmed Working Vision Path

For direct `.litertlm` package activation on Android, vision input worked only after the bridge matched the LiteRT-LM Kotlin multimodal sample more closely:

- create the language engine with the normal text backend
- create a separate `visionBackend`
- decode the incoming app image locally
- normalize the image into a JPEG file in app cache
- send the image as `Content.ImageFile(localPath)`
- send text and image together in the current user message

The important point is the bridge shape, not one specific app repository layout.

The key shape is:

```kotlin
EngineConfig(
  modelPath = modelPath,
  backend = Backend.CPU(),
  visionBackend = Backend.GPU(),
  cacheDir = reactApplicationContext.cacheDir.absolutePath,
)

conversation.sendMessage(
  Contents.of(
    Content.ImageFile(localJpegPath),
    Content.Text(prompt),
  ),
)
```

## What Failed

The bridge originally sent normalized image bytes through:

```kotlin
Content.ImageBytes(...)
```

The image was readable, decoded successfully, and reached the LiteRT-LM native call, but execution failed inside the compiled model executor:

```text
Failed to call nativeSendMessage: INTERNAL:
third_party/odml/litert_lm/runtime/executor/llm_litert_compiled_model_executor.cc:786
Failed to invoke the compiled model
```

Switching to `Content.ImageFile(localPath)` fixed the image-analysis path on device.

## Why This Matters

For this Android LiteRT-LM path, the failure was not caused by:

- app-layer UI logic
- the image picker
- an unreadable URI
- missing GGUF projector attachment
- text backend initialization
- chat history shape alone

The important distinction is that `.litertlm` packages are self-contained LiteRT-LM packages. They do not use GGUF projector files. A GGUF projector attachment should not be treated as evidence that a `.litertlm` model has vision support.

## Current Guidance

For Machine Activation SDK adapters:

- prefer `ImageFile` over `ImageBytes` for LiteRT-LM Android vision unless a specific runtime/model pair is proven to support byte input
- cache normalized images in app-local cache before sending them to LiteRT-LM
- keep only the latest image-bearing user turn when creating a LiteRT-LM conversation unless deeper history has been validated
- keep the text backend and vision backend independently selectable
- report vision capability as observed only after a real image probe succeeds, not merely because a model name looks multimodal

## Follow-Up Work

The next SDK-level improvement is to turn this lesson into an observed probe:

1. Create a tiny local JPEG probe image.
2. Send it through the same `Content.ImageFile(...)` path.
3. Save the result as an observed vision capability for that model/runtime/device combination.
4. Use the saved result in the activation handshake.

That will make LiteRT-LM vision support less guess-based and closer to the cartridge-style activation model.
