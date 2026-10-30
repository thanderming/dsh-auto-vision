# dsh-auto-vision

Let a text-only model see images. When the selected model has no image input, **Auto Vision** asks a vision-capable model on the same provider to read each image, then sends the original request with that description in place of the image.

A DSH plugin. No API keys are stored in or sent by the plugin itself — it uses the credential your provider config already points at.

## What it does

- Hooks `llm/stream`: if a request carries image blocks and the selected route is text-only, each image is read by a vision model on the **same provider** and replaced with a text block `[Image #n interpreted by <model>] … [/Image #n]`.
- Picks the vision model automatically (first image-capable model the provider catalog lists), or use the one you choose in **Settings → Auto Vision**.
- Advertises image input in the model picker for text routes that have a vision sibling, so you can attach an image to them directly.
- Session history and the UI keep the real image; only the request going to the text model is rewritten.
- Falls back to the provider's OpenAI-compatible `/chat/completions` endpoint when the chosen model is listed by the official `/models` API but not mounted in the local adapter.
- Per-image result cache (128 entries) and in-flight de-duplication; 60 s timeout by default.
- If an image cannot be read, the turn continues with a `[Image #n could not be interpreted: <reason>]` note instead of failing.

## Install

```sh
dsh plugin add github:thanderming/dsh-auto-vision
```

Or install it from the plugin marketplace.

## Settings

**Settings → Auto Vision**: pick the vision model (grouped per provider), or leave it on *Automatic*. The selection applies to the next image request.

| Config key | Default | Meaning |
| --- | --- | --- |
| `visionProvider` / `visionModel` | empty = auto | Model to read images with. A selection made for another provider is ignored. |
| `timeoutMs` | `60000` | Per-image read timeout. |

The guaranteed group in the picker only lists models whose DSH config declares `input: [text, image]`. The official `/models` endpoint exposes no modality metadata, so models shown as *candidates* are matched by name and are not guaranteed to accept images — a wrong pick produces a clear per-image error rather than a broken turn.

## Privacy

- Images are sent only to the vision model of the **same provider** you are already talking to. Nothing goes to a third-party service.
- Credentials are read at request time from the credential reference (`apiKeyEnv`) of that provider's config; the key never enters the plugin's config, logs, or the browser UI.
- Image descriptions are cached in memory for the session only, and are never written to disk.

## Limitations

- Same provider only: a vision model on a different API is not used.
- One extra model call per uncached image.
- Image content is treated as untrusted data in the vision prompt (the model is told not to follow instructions found in the image), but the resulting text still flows into your model's context as evidence.

## Development

```sh
node test/auto-vision.test.mjs   # 9 tests, no network
```

## 中文说明

主模型不支持图片时，自动调用**同一 API 下**可识别图片的模型读取图片，把描述替换进请求后交给主模型；会话历史与界面里的图片不变。

- 安装：`dsh plugin add github:thanderming/dsh-auto-vision`
- 设置：**设置 → 自动视觉**，选择视觉模型（或保持「自动」）。
- 密钥不经过本插件：请求时从该 API 已有的凭据引用读取，不写入配置、日志或前端。
- 图片只发给同一 API 的视觉模型，描述仅缓存在内存中。
- 局限：只支持同一 API 内的视觉模型；官方 `/models` 不返回模态信息，按名称猜出的候选不保证可用。

## License

MIT
