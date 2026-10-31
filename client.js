window.__ModuleLoader__.load({
  id: 'dsh-auto-vision',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'auto-vision'
    const zh = {
      nav: '自动视觉',
      title: '自动视觉',
      intro: '主模型不能识别图片时，自动改用同一 API 下可识别图片的模型读取图片，再把描述反馈给主模型。',
      target: '视觉模型',
      auto: '自动（使用该 API 中第一个支持图片的模型）',
      hint: '保证组只显示 DSH 配置里声明了 input: [text, image] 的模型。官方 /models 接口不返回模态信息；勾选后可查看仅按名称猜出的官方候选，不保证能调用。调用失败会先试同一 API 的其他视觉模型，再试官方清单候选，并在最终答复中说明。',
      refresh: '刷新模型列表',
      loading: '正在读取模型…',
      saving: '正在保存…',
      saved: '已保存，下一次图片请求生效。',
      loadFailed: '读取设置失败',
      saveFailed: '保存失败',
      noModels: '没有找到已声明图片输入的模型。下方列出了已配置但按名称匹配的视觉模型；也可勾选官方候选。',
      provider: 'API',
      showCandidates: '显示官方清单中未声明的候选（不保证）',
      configured: '已配置但未声明图像输入',
      undeclared: '未声明',
    }
    const en = {
      nav: 'Auto Vision',
      title: 'Auto Vision',
      intro: 'When the main model cannot see images, a vision model on the same API reads them first and its description is fed back.',
      target: 'Vision model',
      auto: 'Automatic (first image-capable model on this API)',
      hint: 'The guaranteed group only shows models whose DSH config declares input: [text, image]. The official /models endpoint exposes no modality metadata; tick below to see name-matched official candidates, which are not guaranteed to work. On failure the plugin tries other mounted vision models, then official candidates, and reports the switch in the final answer.',
      refresh: 'Refresh models',
      loading: 'Reading models…',
      saving: 'Saving…',
      saved: 'Saved. Applies to the next image request.',
      loadFailed: 'Could not read settings',
      saveFailed: 'Could not save',
      noModels: 'No model declares an image input. Configured models matched by name are listed below; official candidates can be shown too.',
      provider: 'API',
      showCandidates: 'Show undeclared official candidates (not guaranteed)',
      configured: 'Configured without image input',
      undeclared: 'Undeclared',
    }

    const box = {
      display: 'grid',
      gap: 16,
      maxWidth: 720,
      color: 'var(--dsw-alias-label-primary)',
    }
    const title = { margin: 0, fontSize: 18, fontWeight: 600 }
    const intro = { margin: 0, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 }
    const card = {
      display: 'grid',
      gap: 12,
      padding: 16,
      borderRadius: 12,
      background: 'var(--dsw-alias-settings-card-fill)',
      border: '1px solid var(--dsw-alias-settings-card-stroke)',
    }
    const label = { display: 'grid', gap: 6, fontSize: 13, fontWeight: 500 }
    const select = {
      width: '100%',
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 14,
    }
    const hint = { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 }
    const row = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }
    const button = {
      padding: '6px 12px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      fontSize: 12,
    }

    function groupModels(providers) {
      return providers.filter(
        (provider) => provider.models.length > 0 || provider.configured.length > 0 || provider.candidates.length > 0,
      )
    }

    function routeKey(provider, model) {
      return `${provider}|${model}`
    }

    function splitRoute(value) {
      if (!value) return { provider: '', model: '' }
      const at = value.indexOf('|')
      if (at < 0) return { provider: '', model: value }
      return { provider: value.slice(0, at), model: value.slice(at + 1) }
    }

    function atPath(root, path) {
      let node = root
      for (const key of path || []) {
        if (node == null) return undefined
        node = node[key]
      }
      return node
    }

    function configuredModels(profile) {
      if (!Array.isArray(profile?.models)) return []
      return profile.models
        .filter((model) => model?.id)
        .map((model) => ({ id: model.id, name: model.name || model.id }))
    }

    function imageModels(profile) {
      if (!Array.isArray(profile?.models)) return []
      return profile.models
        .filter((model) => Array.isArray(model?.input) && model.input.includes('image'))
        .map((model) => ({ id: model.id, name: model.name || model.id }))
    }

    function isVisionName(id) {
      return /vision|multimodal|omni|ocr|(?:^|[-_])vl(?:$|[-_])|4(?:\.\d+)?v/i.test(id)
    }

    function AutoVisionSection() {
      const t = ctx.locale.bind(NS)
      const [state, setState] = React.useState({ phase: 'loading' })
      const [saving, setSaving] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [showCandidates, setShowCandidates] = React.useState(false)

      const load = React.useCallback(async () => {
        setState({ phase: 'loading' })
        const [settings, configured, registered] = await Promise.all([
          ctx.remote.settings.describe(),
          ctx.remote.llm.listConfigurableProviders(),
          ctx.remote.llm.listProviders(),
        ])
        if (!settings.ok) throw new Error(settings.error.message)
        if (!configured.ok) throw new Error(configured.error.message)
        if (!registered.ok) throw new Error(registered.error.message)

        const view = settings.value.namespaces.find((entry) => entry.ns === NS)
        if (!view) throw new Error(`No settings namespace "${NS}"`)
        const active = new Set(registered.value.map((provider) => provider.id))
        const routes = configured.value.filter((provider) => active.has(provider.provider))

        const providers = await Promise.all(routes.map(async (provider) => {
          const view = settings.value.namespaces.find((entry) => entry.ns === provider.settingsNs)
          const profile = atPath(view?.value, provider.settingsPath)
          const declared = new Map(imageModels(profile).map((model) => [model.id, model]))
          let official = []
          try {
            // The Host plugin owns the official `/models` query and its API key,
            // so the browser never receives a credential.
            const answer = await ctx.remote.llm.discoverModels(NS, { provider: provider.provider })
            if (answer.ok) {
              official = answer.value
                .filter((model) => model?.id)
                .map((model) => ({ id: model.id, name: model.name || model.id }))
            }
          } catch {
            // The declared DSH catalog is still usable when discovery fails.
          }
          const unique = new Map()
          for (const model of official) unique.set(model.id, model)
          return {
            id: provider.provider,
            name: provider.displayName || provider.provider,
            // The declared catalog is authoritative: the official endpoint may
            // omit aliases or vision models entirely, so never hide a model
            // just because /models did not return it.
            models: [...declared.values()],
            configured: configuredModels(profile).filter(
              (model) => !declared.has(model.id) && isVisionName(model.id),
            ),
            candidates: [...unique.values()].filter(
              (model) => !declared.has(model.id) && isVisionName(model.id),
            ),
          }
        }))

        const model = typeof view.value?.visionModel === 'string' ? view.value.visionModel : ''
        const configuredProvider = typeof view.value?.visionProvider === 'string' ? view.value.visionProvider : ''
        const owner = configuredProvider
          || providers.find((provider) => provider.models.some((entry) => entry.id === model))?.id
          || ''

        setState({
          phase: 'ready',
          ns: view.ns,
          revision: view.revision,
          current: model ? routeKey(owner, model) : '',
          providers: groupModels(providers),
        })
      }, [])

      React.useEffect(() => {
        load().catch((error) => setState({ phase: 'error', message: error.message }))
      }, [load])

      async function change(event) {
        const { provider, model } = splitRoute(event.target.value)
        setSaving(true)
        setNotice(null)
        try {
          const answer = await ctx.remote.settings.mutate(
            state.ns,
            [
              { op: 'set', path: ['visionProvider'], value: provider },
              { op: 'set', path: ['visionModel'], value: model },
            ],
            state.revision,
          )
          if (!answer.ok) throw new Error(answer.error.message)
          const savedProvider = typeof answer.value.value?.visionProvider === 'string' ? answer.value.value.visionProvider : provider
          const savedModel = typeof answer.value.value?.visionModel === 'string' ? answer.value.value.visionModel : model
          setState((previous) => ({
            ...previous,
            revision: answer.value.revision,
            current: savedModel ? routeKey(savedProvider, savedModel) : '',
          }))
          setNotice({ kind: 'ok', text: t('saved') })
        } catch (error) {
          setNotice({ kind: 'error', text: `${t('saveFailed')}: ${error.message}` })
        } finally {
          setSaving(false)
        }
      }

      if (state.phase === 'loading') {
        return h('section', { style: box }, h('h2', { style: title }, t('title')), h('p', { style: intro }, t('loading')))
      }
      if (state.phase === 'error') {
        return h('section', { style: box },
          h('h2', { style: title }, t('title')),
          h('p', { style: { ...intro, color: 'var(--dsw-alias-state-error-primary)' } }, `${t('loadFailed')}: ${state.message}`),
        )
      }

      const options = []
      options.push(h('option', { key: '', value: '' }, t('auto')))
      const known = new Set()
      for (const provider of state.providers) {
        if (provider.models.length === 0) continue
        const children = []
        for (const model of provider.models) {
          const route = routeKey(provider.id, model.id)
          known.add(route)
          children.push(h('option', { key: route, value: route }, `${model.name} (${provider.name})`))
        }
        options.push(h('optgroup', { key: provider.id, label: `${t('provider')}: ${provider.name}` }, children))
      }
      for (const provider of state.providers) {
        if (provider.configured.length === 0) continue
        const children = []
        for (const model of provider.configured) {
          const route = routeKey(provider.id, model.id)
          known.add(route)
          children.push(h('option', { key: route, value: route }, `${model.name} (${provider.name} · ${t('configured')})`))
        }
        options.push(h('optgroup', {
          key: `configured:${provider.id}`,
          label: `${t('provider')}: ${provider.name} · ${t('configured')}`,
        }, children))
      }
      if (showCandidates) {
        for (const provider of state.providers) {
          if (provider.candidates.length === 0) continue
          const children = []
          for (const model of provider.candidates) {
            const route = routeKey(provider.id, model.id)
            known.add(route)
            children.push(h('option', { key: route, value: route }, `${model.name} (${provider.name} · ${t('undeclared')})`))
          }
          options.push(h('optgroup', {
            key: `candidates:${provider.id}`,
            label: `${t('provider')}: ${provider.name} · ${t('undeclared')}`,
          }, children))
        }
      }
      if (state.current && !known.has(state.current)) {
        options.push(h('option', { key: 'custom', value: state.current }, `${state.current} (${t('undeclared')})`))
      }
      const hasGuaranteed = state.providers.some((provider) => provider.models.length > 0)
      const hasCandidates = state.providers.some((provider) => provider.candidates.length > 0)

      return h('section', { style: box },
        h('h2', { style: title }, t('title')),
        h('p', { style: intro }, t('intro')),
        h('div', { style: card },
          h('label', { style: label }, t('target'),
            h('select', {
              style: select,
              value: state.current,
              disabled: saving,
              onChange: change,
            }, options),
          ),
          h('p', { style: hint }, t('hint')),
          hasCandidates ? h('label', {
            style: { ...hint, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
          },
            h('input', {
              type: 'checkbox',
              checked: showCandidates,
              disabled: saving,
              onChange: (event) => setShowCandidates(event.target.checked),
            }),
            t('showCandidates'),
          ) : null,
          h('div', { style: row },
            h('button', {
              type: 'button',
              style: button,
              disabled: saving,
              onClick: () => load().catch((error) => setState({ phase: 'error', message: error.message })),
            }, t('refresh')),
            saving ? h('span', { style: hint }, t('saving')) : null,
            notice ? h('span', {
              style: { ...hint, color: notice.kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' },
            }, notice.text) : null,
          ),
          !hasGuaranteed ? h('p', { style: hint }, t('noModels')) : null,
        ),
      )
    }

    let ctx
    return {
      inject: ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings'],
      apply(root) {
        ctx = root
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-auto-vision: locale')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: NS,
          order: 30,
          label: () => t('nav'),
        }, AutoVisionSection))
      },
    }
  },
})
