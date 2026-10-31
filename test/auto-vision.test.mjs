import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

function makeCtx({ models, visionText = 'A cat on a keyboard.', throwUnknown = false, failModels = [] }) {
  const calls = []
  const listeners = []
  const llm = {
    async resolveModelInfo(provider, model) {
      const found = models[`${provider}/${model}`]
      if (found) return found
      if (throwUnknown) {
        const error = new Error(`unknown model ${provider}/${model}`)
        error.code = 'UNKNOWN_MODEL'
        throw error
      }
      return { id: model, provider, inputModalities: ['text'] }
    },
    async listModels(provider) {
      return Object.entries(models)
        .filter(([key]) => key.startsWith(`${provider}/`))
        .map(([, value]) => value)
    },
    stream(options) {
      calls.push(options)
      return (async function* () {
        if (failModels.includes(options.model)) {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: `${options.model} boom` } } }
          return
        }
        const text = options.model.startsWith('vision') ? visionText : 'main-ok'
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
  const ctx = {
    llm,
    on(event, listener) {
      if (event === 'llm/stream') listeners.push(listener)
      return () => {}
    },
    effect(register) {
      register()
      return () => {}
    },
  }
  return { ctx, calls, listeners }
}

function imageMessage(text = 'What is this?', attachmentId = 'img-1') {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image', attachment: { attachmentId, mediaType: 'image/png' } },
    ],
  }
}

async function drain(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('routes images through a same-provider vision model before the text model', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision': { id: 'vision', provider: 'p', name: 'Vision', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({ models })
  apply(ctx, { timeoutMs: 5000 })

  const out = await drain(listeners[0](
    { provider: 'p', model: 'text', messages: [imageMessage()] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))

  assert.equal(calls.length, 2)
  assert.equal(calls[0].model, 'vision')
  assert.equal(calls[0].messages[0].content[1].type, 'image')
  assert.equal(calls[1].model, 'text')
  assert.equal(calls[1].messages[0].content.some((block) => block.type === 'image'), false)
  assert.match(calls[1].messages[0].content[1].text, /A cat on a keyboard/)
  assert.equal(out[0].text, 'main-ok')
})

test('leaves native vision routes untouched', async () => {
  const models = {
    'p/vision': { id: 'vision', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, listeners } = makeCtx({ models })
  apply(ctx, {})

  const out = await drain(listeners[0](
    { provider: 'p', model: 'vision', messages: [imageMessage()] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))
  assert.deepEqual(out, [{ type: 'text-delta', text: 'native' }])
})

test('passes through when no vision model exists on the provider', async () => {
  const models = { 'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] } }
  const { ctx, calls, listeners } = makeCtx({ models })
  apply(ctx, {})

  const out = await drain(listeners[0](
    { provider: 'p', model: 'text', messages: [imageMessage()] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))
  assert.equal(calls.length, 0)
  assert.deepEqual(out, [{ type: 'text-delta', text: 'native' }])
})

test('describes one attachment only once', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision': { id: 'vision', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({ models })
  apply(ctx, { timeoutMs: 5000 })
  const options = { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-cache')] }
  const next = () => (async function* () { yield { type: 'text-delta', text: 'native' } })()

  await drain(listeners[0](options, next))
  await drain(listeners[0](options, next))

  assert.equal(calls.filter((call) => call.model === 'vision').length, 1)
})

test('uses the vision model selected through a volatile config reference', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision': { id: 'vision', provider: 'p', inputModalities: ['text', 'image'] },
    'p/vision-2': { id: 'vision-2', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({ models })
  apply(ctx, {
    timeoutMs: 5000,
    visionProvider: { get: () => 'p' },
    visionModel: { get: () => 'vision-2' },
  })

  await drain(listeners[0](
    { provider: 'p', model: 'text', messages: [imageMessage()] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))

  assert.equal(calls[0].model, 'vision-2')
})

test('ignores a selection from another API and discovers on the request API', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision': { id: 'vision', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({ models })
  apply(ctx, {
    timeoutMs: 5000,
    visionProvider: { get: () => 'q' },
    visionModel: { get: () => 'vision-2' },
  })

  await drain(listeners[0](
    { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-other-api')] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))

  assert.equal(calls[0].provider, 'p')
  assert.equal(calls[0].model, 'vision')
})

test('registers the official catalog for the Settings picker', async () => {
  const { ctx } = makeCtx({ models: {} })
  const discoveries = []
  ctx.llm.registerModelDiscovery = (ns, discover) => {
    assert.equal(ns, 'auto-vision')
    discoveries.push(discover)
    return () => {}
  }
  ctx.settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: { providers: { p: { baseURL: 'https://api.example/v1', apiKeyEnv: 'P_KEY' } } },
    }],
  }
  ctx.credentials = { resolve: async (ref) => (ref === 'P_KEY' ? { value: 'secret' } : undefined) }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.example/v1/models')
    assert.equal(init.headers.authorization, 'Bearer secret')
    return {
      ok: true,
      async json() {
        return { data: [{ id: 'text-model' }, { id: 'GLM-4.6V' }, { id: 'Qwen2.5-VL' }] }
      },
    }
  }
  try {
    apply(ctx, {})
    const listed = await discoveries[0]({ provider: 'p' })
    assert.deepEqual(
      listed.filter((model) => model.inputModalities.includes('image')).map((model) => model.id),
      ['GLM-4.6V', 'Qwen2.5-VL'],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('calls an official-list model directly when the adapter does not know it', async () => {
  const models = { 'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] } }
  const { ctx, calls, listeners } = makeCtx({ models, throwUnknown: true })
  let mutation
  ctx.settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: { providers: { p: {
        baseURL: 'https://api.example/v1',
        apiKeyEnv: 'P_KEY',
        models: [],
      } } },
    }],
    async mutate(ns, ops) {
      mutation = { ns, ops }
    },
  }
  ctx.credentials = { resolve: async () => ({ value: 'secret' }) }
  ctx.attachments = {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Uint8Array.from([1, 2, 3]) }),
  }
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.example/v1/chat/completions')
    sent = JSON.parse(init.body)
    return {
      ok: true,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: 'direct evidence' } }] })
      },
    }
  }
  try {
    apply(ctx, { timeoutMs: 5000, visionProvider: 'p', visionModel: 'GLM-4.6V' })
    await drain(listeners[0](
      { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-direct')] },
      () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
    ))
    assert.equal(sent.model, 'GLM-4.6V')
    assert.equal(sent.messages[1].content[1].type, 'image_url')
    assert.equal(calls.length, 1)
    assert.match(calls[0].messages[0].content[1].text, /direct evidence/)
    assert.equal(mutation.ns, 'llm-pi-ai')
    assert.deepEqual(mutation.ops[0].value[0].input, ['text', 'image'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps a configured vision model that the adapter knows as text-only', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/DeepSeek-V4-Flash-Vision-Exp': {
      id: 'DeepSeek-V4-Flash-Vision-Exp',
      provider: 'p',
      inputModalities: ['text'],
    },
  }
  const { ctx, calls, listeners } = makeCtx({ models })
  let mutation
  ctx.settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: { providers: { p: {
        baseURL: 'https://api.example/v1',
        apiKeyEnv: 'P_KEY',
        models: [{ id: 'DeepSeek-V4-Flash-Vision-Exp', name: 'DeepSeek-V4-Flash-Vision-Exp' }],
      } } },
    }],
    async mutate(ns, ops) {
      mutation = { ns, ops }
    },
  }
  ctx.credentials = { resolve: async () => ({ value: 'secret' }) }
  ctx.attachments = {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Uint8Array.from([1, 2, 3]) }),
  }
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.example/v1/chat/completions')
    sent = JSON.parse(init.body)
    return {
      ok: true,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: 'declared direct evidence' } }] })
      },
    }
  }
  try {
    apply(ctx, { timeoutMs: 5000, visionProvider: 'p', visionModel: 'DeepSeek-V4-Flash-Vision-Exp' })
    await drain(listeners[0](
      { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-configured-text-only')] },
      () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
    ))
    assert.equal(sent.model, 'DeepSeek-V4-Flash-Vision-Exp')
    assert.equal(calls.length, 1)
    assert.match(calls[0].messages[0].content[1].text, /declared direct evidence/)
    assert.equal(mutation.ns, 'llm-pi-ai')
    assert.deepEqual(mutation.ops[0].path, ['providers', 'p', 'models'])
    assert.deepEqual(mutation.ops[0].value[0].input, ['text', 'image'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('falls back to another vision model and tells the main model about the switch', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision-bad': { id: 'vision-bad', provider: 'p', inputModalities: ['text', 'image'] },
    'p/vision-good': { id: 'vision-good', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({ models, failModels: ['vision-bad'] })
  apply(ctx, { timeoutMs: 5000, visionProvider: 'p', visionModel: 'vision-bad' })

  await drain(listeners[0](
    { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-fallback')] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))

  assert.deepEqual(calls.map((call) => call.model), ['vision-bad', 'vision-good', 'text'])
  assert.match(calls[2].system, /图片 #1/)
  assert.match(calls[2].system, /vision-bad/)
  assert.match(calls[2].system, /vision-good/)
  assert.match(calls[2].system, /最终答复/)
  assert.match(calls[2].messages[0].content[1].text, /A cat on a keyboard/)
  assert.match(calls[2].messages[0].content[1].text, /after p\/vision-bad failed/)
})

test('falls back to the official list after mounted vision models fail', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision-bad': { id: 'vision-bad', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({
    models,
    failModels: ['vision-bad'],
    throwUnknown: true,
  })
  ctx.settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: { providers: { p: { baseURL: 'https://api.example/v1', apiKeyEnv: 'P_KEY' } } },
    }],
  }
  ctx.credentials = { resolve: async () => ({ value: 'secret' }) }
  ctx.attachments = {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Uint8Array.from([1, 2, 3]) }),
  }
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (url, init) => {
    if (url === 'https://api.example/v1/models') {
      return {
        ok: true,
        async json() {
          return { data: [{ id: 'GLM-4.6V' }] }
        },
      }
    }
    assert.equal(url, 'https://api.example/v1/chat/completions')
    sent = JSON.parse(init.body)
    return {
      ok: true,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: 'official evidence' } }] })
      },
    }
  }
  try {
    apply(ctx, { timeoutMs: 5000, visionProvider: 'p', visionModel: 'vision-bad' })
    await drain(listeners[0](
      { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-official-fallback')] },
      () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
    ))
    assert.equal(sent.model, 'GLM-4.6V')
    assert.deepEqual(calls.map((call) => call.model), ['vision-bad', 'text'])
    assert.match(calls[1].system, /GLM-4\.6V/)
    assert.match(calls[1].system, /vision-bad/)
    assert.match(calls[1].messages[0].content[1].text, /official evidence/)
    assert.match(calls[1].messages[0].content[1].text, /GLM-4\.6V/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses an official-list model when no mounted vision model exists', async () => {
  const models = { 'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] } }
  const { ctx, calls, listeners } = makeCtx({ models, throwUnknown: true })
  ctx.settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: { providers: { p: { baseURL: 'https://api.example/v1', apiKeyEnv: 'P_KEY' } } },
    }],
  }
  ctx.credentials = { resolve: async () => ({ value: 'secret' }) }
  ctx.attachments = {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Uint8Array.from([1, 2, 3]) }),
  }
  const originalFetch = globalThis.fetch
  let sent
  globalThis.fetch = async (url, init) => {
    if (url === 'https://api.example/v1/models') {
      return {
        ok: true,
        async json() {
          return { data: [{ id: 'GLM-4.6V' }] }
        },
      }
    }
    assert.equal(url, 'https://api.example/v1/chat/completions')
    sent = JSON.parse(init.body)
    return {
      ok: true,
      async text() {
        return JSON.stringify({ choices: [{ message: { content: 'official evidence' } }] })
      },
    }
  }
  try {
    apply(ctx, { timeoutMs: 5000 })
    await drain(listeners[0](
      { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-official-auto')] },
      () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
    ))
    assert.equal(sent.model, 'GLM-4.6V')
    assert.equal(calls.length, 1)
    assert.match(calls[0].messages[0].content[1].text, /official evidence/)
    assert.match(calls[0].messages[0].content[1].text, /GLM-4\.6V/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tells the main model when every vision model fails', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision-bad': { id: 'vision-bad', provider: 'p', inputModalities: ['text', 'image'] },
    'p/vision-worse': { id: 'vision-worse', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx, calls, listeners } = makeCtx({
    models,
    failModels: ['vision-bad', 'vision-worse'],
  })
  apply(ctx, { timeoutMs: 5000, visionProvider: 'p', visionModel: 'vision-bad' })

  await drain(listeners[0](
    { provider: 'p', model: 'text', messages: [imageMessage('What is this?', 'img-all-fail')] },
    () => (async function* () { yield { type: 'text-delta', text: 'native' } })(),
  ))

  assert.deepEqual(calls.map((call) => call.model), ['vision-bad', 'vision-worse', 'text'])
  assert.match(calls[2].system, /所有视觉模型均调用失败/)
  assert.match(calls[2].system, /vision-bad/)
  assert.match(calls[2].system, /vision-worse/)
  assert.match(calls[2].messages[0].content[1].text, /could not be interpreted by any vision model/)
})

test('advertises image input for text routes that have a vision sibling', async () => {
  const models = {
    'p/text': { id: 'text', provider: 'p', inputModalities: ['text'] },
    'p/vision': { id: 'vision', provider: 'p', inputModalities: ['text', 'image'] },
  }
  const { ctx } = makeCtx({ models })
  apply(ctx, {})
  const info = await ctx.llm.resolveModelInfo('p', 'text')
  assert.deepEqual(info.inputModalities, ['text', 'image'])
})
