# dsh-auto-vision

**English** | [简体中文](README.zh-CN.md)

Let a text-only model see images. When the selected model has no image input, **Auto Vision** asks a vision-capable model on the same provider to read each image, then sends the original request with that description in place of the image.

A DSH plugin. No API keys are stored in or sent by the plugin itself — it uses the credential your provider config already points at.

## Why this instead of another vision setup

- **No second API to configure.** It reuses the provider you are already talking to — no extra key, base URL or proxy to set up.
- **No model IDs to look up.** It reads that provider's model list and finds an image-capable one by itself; naming one in Settings is optional.
- **Fixes the rejected drop.** Dragging an image into a text-only model's input box used to be refused. Now the image is read first, and the same model answers.

## What it does

- Hooks `llm/stream`: if a request carries image blocks and the selected route is text-only, each image is read by a vision model on the **same provider** and replaced with a text block `[Image #n interpreted by <model>] … [/Image #n]`.
- Only steps in when all three are true: the request has at least one `image` block, the main route does not declare `image`, and a vision target resolves on the same provider. Otherwise it passes through untouched.
- Target order: the model chosen in Settings → other mounted image-capable models on the same provider → name-matched candidates from the official `/models` list. The next group is tried only when the previous one is unavailable or has failed.
- If the chosen vision model fails, tries the remaining targets in order; the block is marked `after <failed model> failed`. A system notice asks the main model to tell the user which model failed and which one was used.
- If every mounted vision model fails, queries the provider's official `/models` list, keeps name-matched candidates, and tries them over the direct endpoint. The official list has no modality metadata, so these candidates are not guaranteed to accept images.
- Sends a model that is not mounted locally, or is known to the adapter as text-only, to the provider's OpenAI-compatible `/chat/completions` endpoint. This requires `baseURL` and a usable `apiKeyEnv` in the provider config.
- If every vision model fails, inserts `[Image #n could not be interpreted by any vision model: …]` and still asks the main model to report it; the turn continues, and one failed image does not stop the others in the same message.
- Advertises image input in the model picker for text routes that have a vision sibling, so you can attach an image to them directly.
- Session history and the UI keep the real image; only the request going to the text model is rewritten.
- The first time an image is successfully read by a model that lacks an image declaration, writes `input: [text, image]` back to the provider's `llm-pi-ai` config for future direct routing. It never probes models the user has not used, and a failed or cancelled request writes nothing.
- Per-image result cache (128 entries) and in-flight de-duplication; 60 s timeout by default.

## Install

```sh
dsh plugin add github:thanderming/dsh-auto-vision
```

Or install it from the plugin marketplace.

## Settings

**Settings → Auto Vision**: pick the vision model (grouped per provider), or leave it on *Automatic*. The selection is stored in volatile config and applies to the next image request.

| Config key | Default | Meaning |
| --- | --- | --- |
| `visionProvider` / `visionModel` | empty = auto | Model to read images with. A selection made for another provider is ignored; the plugin discovers a target on the provider handling the request instead. |
| `timeoutMs` | `60000` | Per-image read timeout. |

The picker has three groups:

- **Guaranteed**: models whose DSH config declares `input: [text, image]`.
- **Configured without image input**: models present in the DSH config but not declared as image-capable; shown by name match.
- **Official candidates**: the `/models` endpoint exposes no modality metadata, so these are name-matched guesses and are collapsed by default.

Once a candidate successfully reads a real user image, the plugin writes `input: [text, image]` back to the provider's `llm-pi-ai` config, so it moves into the guaranteed group next time. This only happens after a real image request, never as a background probe; refresh the Settings page to see the change.

## Privacy

- Images are sent only to the vision model of the **same provider** you are already talking to. Nothing goes to a third-party service.
- Credentials are read at request time from the credential reference (`apiKeyEnv`) of that provider's config; the key never enters the plugin's config, logs, or the browser UI.
- Image descriptions are cached in memory for the session only, and are never written to disk.

## Limitations

- Same provider only: a vision model on a different API is not used.
- The official list exposes only basic fields such as model IDs, not modality metadata; *candidates* are name-matched and may fail. Direct calls also need `baseURL` and a usable `apiKeyEnv` in the provider config.
- One extra model call per uncached image.
- Auto-marking modifies the `llm-pi-ai` model config; if several Settings pages edit config concurrently, a revision conflict is possible. That attempt only logs a warning and does not retry, and it does not affect the answer.
- Image content is treated as untrusted data in the vision prompt (the model is told not to follow instructions found in the image), but the resulting text still flows into your model's context as evidence.

## Development

```sh
node --test test/auto-vision.test.mjs   # 14 tests, no network
node test/client-render.mjs             # client Settings-page smoke test
```

## License

MIT
