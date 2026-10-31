# dsh-auto-vision

[![npm 版本](https://img.shields.io/npm/v/dsh-auto-sight)](https://www.npmjs.com/package/dsh-auto-sight) [![npm 下载量](https://img.shields.io/npm/dm/dsh-auto-sight)](https://www.npmjs.com/package/dsh-auto-sight)

[English](README.md) | **简体中文**

让纯文本模型也能看图。当所选模型不支持图片输入时，**自动视觉**会调用同一 API 下可识别图片的模型读图，再把图片替换成那段描述，交给原模型完成这一次请求。

这是一个 DSH 插件。插件本身不保存、也不转发任何 API 密钥——它用的就是你 provider 配置里已经指向的那份凭据。

## 为什么用它

- **不用再配一套 API。** 直接复用你正在用的 provider，不新增密钥、不填新的 base URL、不搭代理。
- **不用自己找模型 ID。** 自动从该 provider 的官方 `/models` 清单和 DSH 配置里挑出能识图的模型；想指定时再去设置里填。
- **专治「拖图片被拒」。** 往常把图片拖进纯文本模型的输入框会直接被拒绝，现在先用视觉模型读图，再由同一个模型回答。

## 它做什么

- 挂载 `llm/stream`：请求里带图片、而所选路由只支持文本时，每张图交给**同一 provider** 的视觉模型读取，并替换为文本块 `[Image #n interpreted by <模型名>] … [/Image #n]`。
- 只有同时满足以下条件才会介入：请求里至少有一个 `image` 块；主模型原生不声明 `image`；同一 provider 下能解析出视觉目标。否则原样放行。
- 视觉目标按顺序选择：设置里指定的模型 → 同一 provider 下其他已挂载的视觉模型 → 官方 `/models` 清单里按名称筛出的候选。前一组不可用或全部失败，才进入下一组。
- 指定的视觉模型失败时，按顺序尝试其余目标；成功后在块里标注 `after <失败模型> failed`，并通过 system 提示要求主模型在最终答复中说明「哪个失败、改用了哪个」。
- 如果已挂载的视觉模型都失败，再查该 provider 的官方 `/models` 清单，按名称筛出候选并逐个直连尝试。官方清单不返回模态信息，候选不保证真的接受图片。
- 本地 adapter 没挂载、或把它当成纯文本模型的候选，走该 provider 的 OpenAI 兼容 `/chat/completions` 端点直连；需要 provider 配置里有 `baseURL` 和可用的 `apiKeyEnv`。
- 所有视觉模型都失败时，插入 `[Image #n could not be interpreted by any vision model: …]` 并同样在最终答复中说明，不会中断整轮对话；一张图失败不影响同一条消息里的其他图片。
- 对有视觉兄弟模型的文本路由，在模型选择器里宣告「支持图片输入」，因此可以直接给它附图片。
- 会话历史和界面里保留原图，只有发往文本模型的那次请求被改写。
- 未声明图像输入的模型在第一次成功读图后，自动把 `input: [text, image]` 写回 `llm-pi-ai` 配置，供下次直接路由；不会预先测试用户没用过的模型，失败或取消也不会写。
- 单图结果缓存（128 条）+ 并发去重；默认 60 秒超时。

## 安装

```sh
dsh plugin add github:thanderming/dsh-auto-vision
```

也可以在插件市场里安装。

同一份代码已发布到 npm：[`dsh-auto-sight`](https://www.npmjs.com/package/dsh-auto-sight)（`npm i dsh-auto-sight`）。npm 上是预构建产物——安装时不需要构建步骤，也不会触发 `allowBuilds` 授权——下载量可以在包页面看到。

## 设置

**设置 → 自动视觉**：选择视觉模型（按 provider 分组），或保持「自动」。选择写入 volatile 配置，对下一次图片请求生效。

| 配置键 | 默认值 | 含义 |
| --- | --- | --- |
| `visionProvider` / `visionModel` | 空 = 自动 | 用哪个模型读图。为别的 provider 做的选择会被忽略，自动改用在当前请求的 provider 上发现的目标。 |
| `timeoutMs` | `60000` | 单张图的读取超时。 |

选择器分三组：

- **保证可用**：DSH 配置里明确声明了 `input: [text, image]` 的模型。
- **已配置但未声明图像输入**：模型在 DSH 配置里，但没声明能看图；按名称匹配展示。
- **官方候选**：官方 `/models` 接口不返回模态信息，只有按名称猜出的候选，默认折叠、不保证能调用。

候选模型第一次成功读图后，插件会把 `input: [text, image]` 写回 `llm-pi-ai` 配置，下次它就会进入「保证可用」组。这不会主动逐个探测模型，只在用户实际发图并成功读取后发生；刷新设置页即可看到配置变化。

## 隐私

- 图片只发给你**正在使用的同一个 provider** 的视觉模型，不经过任何第三方服务。
- 密钥在请求时从该 provider 配置的凭据引用（`apiKeyEnv`）读取，永远不进入插件配置、日志或浏览器界面。
- 图片描述只在内存里缓存，随会话结束消失，绝不落盘。

## 局限

- 仅限同一 provider：另一个 API 上的视觉模型不会被使用。
- 官方清单只有模型 ID 等基础字段，没有模态元数据；「候选」是按名称猜的，可能调用失败。直连还需要 provider 配置里有 `baseURL` 和可用的 `apiKeyEnv`。
- 每张未命中缓存的图片会多一次模型调用。
- 自动标记会修改 `llm-pi-ai` 的模型配置；如果多个设置页同时改配置，可能遇到 revision 冲突，本次只记录警告、不重试，且不影响本轮回答。
- 视觉提示中把图片内容当作不可信数据（明确要求模型不要执行图片里出现的指令），但生成的描述仍会作为素材进入你的模型上下文。

## 开发

```sh
node --test test/auto-vision.test.mjs   # 14 个测试，不联网
node test/client-render.mjs             # 客户端设置页 smoke test
```

## 许可

MIT
