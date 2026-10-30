import assert from 'node:assert/strict'

let definition
globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }

let hookIndex = 0
let hooks = []
let callback
let effectQueued = false
let renderCurrent
let registered
let mutation

function rerender() {
  if (renderCurrent) renderCurrent()
}
function setAt(index, next) {
  hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
  rerender()
}

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.flat(Infinity) } }
  },
  useState(initial) {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], (next) => setAt(index, next)]
  },
  useCallback(fn) {
    callback ??= fn
    return callback
  },
  useEffect(fn) {
    if (effectQueued) return
    effectQueued = true
    queueMicrotask(fn)
  },
}

const dict = {
  nav: 'Auto Vision', title: 'Auto Vision', intro: '', target: 'Vision model', auto: 'Auto',
  hint: '', refresh: 'Refresh', loading: 'Loading', saving: 'Saving', saved: 'Saved',
  loadFailed: 'Load failed', saveFailed: 'Save failed', noModels: 'None', provider: 'API',
}

const settingsView = {
  ns: 'auto-vision',
  revision: 3,
  value: { visionProvider: 'p', visionModel: 'vision' },
}
const providerViews = [
  { ns: 'llm-p', revision: 1, value: { providers: { p: { models: [
    { id: 'vision', name: 'Vision', input: ['text', 'image'] },
    { id: 'text', name: 'Text', input: ['text'] },
  ] } } } },
  { ns: 'llm-q', revision: 2, value: { providers: { q: { models: [
    { id: 'vision2', name: 'Vision 2', input: ['image'] },
  ] } } } },
]
const ctx = {
  effect(fn) { fn() },
  locale: {
    register() { return () => {} },
    bind() { return (key) => dict[key] ?? key },
  },
  slots: {
    inject(name, fn) { fn() },
    register(reg, component) { registered = { reg, component } },
  },
  remote: {
    settings: {
      async describe() {
        return { ok: true, value: { writable: true, namespaces: [settingsView, ...providerViews] } }
      },
      async mutate(ns, ops, revision) {
        mutation = { ns, ops, revision }
        return { ok: true, value: { ns, revision: revision + 1, value: { visionProvider: 'q', visionModel: 'vision2' } } }
      },
    },
    llm: {
      async listConfigurableProviders() {
        return { ok: true, value: [
          { provider: 'p', displayName: 'Provider P', settingsNs: 'llm-p', settingsPath: ['providers', 'p'] },
          { provider: 'q', displayName: 'Provider Q', settingsNs: 'llm-q', settingsPath: ['providers', 'q'] },
        ] }
      },
      async listProviders() {
        return { ok: true, value: [{ id: 'p' }, { id: 'q' }] }
      },
      async discoverModels() {
        return { ok: true, value: [
          { id: 'vision', name: 'Vision', inputModalities: ['text', 'image'] },
          { id: 'vision2', name: 'Vision 2', inputModalities: ['text', 'image'] },
          { id: 'text', name: 'Text', inputModalities: ['text'] },
          { id: 'GLM-4.6V', name: 'GLM-4.6V', inputModalities: ['text', 'image'] },
          { id: 'GLM-5.3', name: 'GLM-5.3', inputModalities: ['text'] },
        ] }
      },
    },
  },
}

await import('../client.js')
const factory = definition.factory
const plugin = factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
})
plugin.apply(ctx)
assert.equal(registered.reg.name, 'settings.section')
assert.equal(registered.reg.id, 'auto-vision')
assert.equal(typeof registered.reg.label(), 'string')

function render() {
  hookIndex = 0
  return registered.component({})
}
renderCurrent = () => { render() }
render()
await new Promise((resolve) => setTimeout(resolve, 10))
await new Promise((resolve) => setTimeout(resolve, 10))

function findAll(node, type, out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === type) out.push(node)
  for (const child of node.props?.children || []) findAll(child, type, out)
  return out
}
const tree = render()
const select = findAll(tree, 'select')[0]
assert.ok(select, 'select rendered')
assert.equal(select.props.value, 'p|vision')
const optionValues = findAll(tree, 'option').map((option) => option.props.value)
assert.deepEqual(optionValues, ['', 'p|vision', 'q|vision2'])
const checkbox = findAll(tree, 'input').find((node) => node.props.type === 'checkbox')
assert.ok(checkbox, 'candidate toggle rendered')
checkbox.props.onChange({ target: { checked: true } })
assert.ok(findAll(render(), 'option').some((option) => option.props.value === 'p|GLM-4.6V'))

await select.props.onChange({ target: { value: 'q|vision2' } })
assert.deepEqual(mutation, {
  ns: 'auto-vision',
  ops: [
    { op: 'set', path: ['visionProvider'], value: 'q' },
    { op: 'set', path: ['visionModel'], value: 'vision2' },
  ],
  revision: 3,
})
const after = render()
assert.equal(findAll(after, 'select')[0].props.value, 'q|vision2')
assert.ok(findAll(after, 'span').some((node) => node.props.children.flat().join('') === 'Saved'))
console.log('client smoke ok')
