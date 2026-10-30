import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

function makeCtx({ models, visionText = 'A cat on a keyboard.', throwUnknown = false }) {
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
        const text = options.model === 'vision' ? visionText : 'main-ok'
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
  } finally {
    globalThis.fetch = originalFetch
  }
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
