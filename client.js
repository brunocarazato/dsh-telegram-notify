window.__ModuleLoader__.load({
	id: 'dsh-telegram-notify',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const jsxRuntime = require('react/jsx-runtime');
		const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
		const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store');

		/** Host entry whose form this page edits. */
		const NS = 'telegram-notify';
		/** Dictionary namespace owned by this page. */
		const DICT = 'telegramNotify';

		//#region locales
		const en = {
			title: 'Telegram notifications',
			description: 'Sends a Telegram message when the agent asks a question or finishes its work.',
			delivery: 'Delivery',
			content: 'Content',
			advanced: 'Advanced',
			enabled: 'Send notifications',
			enabledHint: 'Turn every notification off without uninstalling the plugin.',
			chatId: 'Chat ID',
			chatIdHint: 'Target chat. Leave empty to discover it from a message sent to the bot.',
			notifyQuestions: 'Notify on questions',
			notifyQuestionsHint: 'Send a message whenever the agent asks you a question.',
			notifyFinished: 'Notify when work finishes',
			notifyFinishedHint: 'Send a message when a top-level agent finishes a run.',
			formatMarkdown: 'Format Markdown',
			formatMarkdownHint: 'Render bold, lists, code and links in Telegram style instead of showing the raw Markdown.',
			includeResponse: 'Include the final answer',
			includeResponseHint: 'Append an excerpt of the final answer to the finished notification.',
			minTurnDurationMs: 'Minimum run length (ms)',
			minTurnDurationMsHint: 'Runs shorter than this stay silent.',
			excerptChars: 'Excerpt length',
			excerptCharsHint: 'Maximum characters of the final answer excerpt.',
			locale: 'Message language',
			localeHint: 'pt-BR or en.',
			apiOrigin: 'Bot API origin',
			apiOriginHint: 'Change only for a proxy or a test server.',
			timeoutMs: 'Request timeout (ms)',
			timeoutMsHint: 'Bot API request timeout.',
			dedupeMs: 'Repeat window (ms)',
			dedupeMsHint: 'Suppress an identical question repeated inside this window.',
			on: 'On',
			off: 'Off',
			overridden: 'Overridden',
			reset: 'Reset to default',
			readOnly: 'This deployment stores settings read-only.',
			unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
			save: 'Save',
			saving: 'Saving\u2026',
			saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
			invalidNumber: 'Enter a number, or leave blank to use the default.'
		};

		const pt = {
			title: 'Notifica\u00e7\u00f5es do Telegram',
			description: 'Envia uma mensagem no Telegram quando o agente faz uma pergunta ou termina o trabalho.',
			delivery: 'Entrega',
			content: 'Conte\u00fado',
			advanced: 'Avan\u00e7ado',
			enabled: 'Enviar notifica\u00e7\u00f5es',
			enabledHint: 'Desliga todas as notifica\u00e7\u00f5es sem desinstalar o plugin.',
			chatId: 'Chat ID',
			chatIdHint: 'Chat de destino. Deixe vazio para descobrir a partir de uma mensagem enviada ao bot.',
			notifyQuestions: 'Notificar em perguntas',
			notifyQuestionsHint: 'Envia uma mensagem sempre que o agente fizer uma pergunta.',
			notifyFinished: 'Notificar ao terminar',
			notifyFinishedHint: 'Envia uma mensagem quando um agente de n\u00edvel raiz termina uma execu\u00e7\u00e3o.',
			formatMarkdown: 'Formatar Markdown',
			formatMarkdownHint: 'Renderiza negrito, listas, c\u00f3digo e links no estilo do Telegram em vez de mostrar o Markdown cru.',
			includeResponse: 'Incluir a resposta final',
			includeResponseHint: 'Acrescenta um trecho da resposta final \u00e0 notifica\u00e7\u00e3o de conclus\u00e3o.',
			minTurnDurationMs: 'Dura\u00e7\u00e3o m\u00ednima (ms)',
			minTurnDurationMsHint: 'Execu\u00e7\u00f5es mais curtas ficam silenciosas.',
			excerptChars: 'Tamanho do trecho',
			excerptCharsHint: 'M\u00e1ximo de caracteres do trecho da resposta final.',
			locale: 'Idioma das mensagens',
			localeHint: 'pt-BR ou en.',
			apiOrigin: 'Origem da Bot API',
			apiOriginHint: 'Altere apenas para um proxy ou servidor de teste.',
			timeoutMs: 'Tempo limite (ms)',
			timeoutMsHint: 'Tempo limite das requisi\u00e7\u00f5es \u00e0 Bot API.',
			dedupeMs: 'Janela de repeti\u00e7\u00e3o (ms)',
			dedupeMsHint: 'Suprime uma pergunta id\u00eantica repetida dentro desta janela.',
			on: 'Ligado',
			off: 'Desligado',
			overridden: 'Substitu\u00eddo',
			reset: 'Redefinir para o padr\u00e3o',
			readOnly: 'Esta implanta\u00e7\u00e3o armazena configura\u00e7\u00f5es somente leitura.',
			unavailable: 'Este plugin n\u00e3o est\u00e1 carregado, portanto n\u00e3o pode ser configurado agora.',
			save: 'Salvar',
			saving: 'Salvando\u2026',
			saveFailed: 'A implanta\u00e7\u00e3o n\u00e3o aceitou esses valores; eles foram deixados para voc\u00ea corrigir.',
			invalidNumber: 'Insira um n\u00famero ou deixe em branco para usar o padr\u00e3o.'
		};
		//#endregion

		//#region fields
		const TEXT_FIELDS = ['chatId', 'locale', 'apiOrigin']
		const NUMBER_FIELDS = ['minTurnDurationMs', 'excerptChars', 'timeoutMs', 'dedupeMs']
		const BOOLEAN_FIELDS = ['enabled', 'notifyQuestions', 'notifyFinished', 'formatMarkdown', 'includeResponse']

		/**
		 * A boolean rendered through the text field: the input holds "true" or
		 * "false", and parsing keeps the literal the Host schema accepts.
		 */
		const booleanField = (name) => ({
			field: name,
			format: (value) => String(value === true),
			parse: (text) => {
				const clean = text.trim().toLowerCase()
				if (clean === '') return { kind: 'clear' }
				if (clean === 'true' || clean === 'on' || clean === '1' || clean === 'sim' || clean === 'yes') return { kind: 'set', value: true }
				if (clean === 'false' || clean === 'off' || clean === '0' || clean === 'não' || clean === 'nao' || clean === 'no') return { kind: 'set', value: false }
				return undefined
			}
		})

		const ALL_FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS, ...BOOLEAN_FIELDS]
		const fieldSpecs = [
			...TEXT_FIELDS.map((name) => primitives.settingsTextField(name)),
			...NUMBER_FIELDS.map((name) => primitives.settingsNumberField(name)),
			...BOOLEAN_FIELDS.map((name) => booleanField(name))
		]
		//#endregion

		/** The page's staged form over the `telegram-notify` settings namespace. */
		var TelegramNotifyCardController = class {
			constructor(scope) {
				this.form = new primitives.SettingsFormModel(scope, fieldSpecs)
				this.store = createSnapshotStore(this.projection())
				this.unsubscribe = this.form.bind(() => this.form.shell()).subscribe(() => {
					this.store.set(this.projection())
				})
			}

			/** The snapshot the card renders: the form shell plus one entry per field. */
			projection() {
				const projection = { ...this.form.shell() }
				for (const name of ALL_FIELDS) projection[name] = this.form.field(name)
				return projection
			}

			/** The face the slot registration injects: hooks plus form actions. */
			inject() {
				return {
					hooks: { telegramNotifyCard: this.store },
					...this.form.actions()
				}
			}

			dispose() {
				this.unsubscribe()
			}
		}

		//#region card
		/**
		 * Render the page's one-liner or its settings form.
		 * @param props - the view asked for, locale copy, the snapshot, and actions.
		 */
		function TelegramNotifyCard(props) {
			const t = props.t
			const state = props.useTelegramNotifyCard((snapshot) => snapshot)
			if (props.view === 'summary') return t('description')

			const jsx = jsxRuntime.jsx
			const jsxs = jsxRuntime.jsxs
			const disabled = !state.writable || state.saving

			const shared = (name, labelKey, hintKey, numeric) => ({
				key: name,
				id: `telegram-notify-${name}`,
				label: t(labelKey),
				hint: t(hintKey),
				overriddenLabel: t('overridden'),
				resetLabel: t('reset'),
				invalidLabel: t('invalidNumber'),
				numeric: numeric === true,
				disabled,
				onEdit: (text) => props.edit(name, text),
				onReset: () => props.resetField(name)
			})

			const row = (name, labelKey, hintKey, numeric) => jsx(primitives.SettingsValueField, {
				...shared(name, labelKey, hintKey, numeric),
				...state[name]
			})

			/**
			 * A boolean row: a switch plus its state, wired to the text field's
			 * staging so the saved value is the literal the schema accepts.
			 */
			const toggle = (name, labelKey, hintKey) => {
				const value = state[name]
				if (value === undefined) return undefined
				const checked = value.text.trim().toLowerCase() === 'true'
				return jsxs('div', {
					key: name,
					children: [
						jsx('label', {
							children: [
								jsx('span', { children: t(labelKey) }),
								jsx(primitives.Switch, {
									checked,
									label: t(labelKey),
									disabled: disabled || value.invalid,
									onChange: (next) => props.edit(name, next ? 'true' : 'false')
								})
							]
						}),
						jsx('p', { children: t(hintKey) }),
						value.overridden
							? jsx('button', { type: 'button', disabled, onClick: () => props.resetField(name), children: t('reset') })
							: undefined
					]
				})
			}

			return jsx(primitives.SettingsForm, {
				labels: {
					unavailable: t('unavailable'),
					readOnly: t('readOnly'),
					saveFailed: t('saveFailed'),
					save: t('save'),
					saving: t('saving')
				},
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					jsxs('div', {
						key: 'delivery',
						children: [
							jsx('h4', { children: t('delivery') }),
							toggle('enabled', 'enabled', 'enabledHint'),
							row('chatId', 'chatId', 'chatIdHint', false),
							toggle('notifyQuestions', 'notifyQuestions', 'notifyQuestionsHint'),
							toggle('notifyFinished', 'notifyFinished', 'notifyFinishedHint')
						]
					}),
					jsxs('div', {
						key: 'content',
						children: [
							jsx('h4', { children: t('content') }),
							toggle('formatMarkdown', 'formatMarkdown', 'formatMarkdownHint'),
							toggle('includeResponse', 'includeResponse', 'includeResponseHint'),
							row('excerptChars', 'excerptChars', 'excerptCharsHint', true),
							row('minTurnDurationMs', 'minTurnDurationMs', 'minTurnDurationMsHint', true),
							row('locale', 'locale', 'localeHint', false)
						]
					}),
					jsxs('div', {
						key: 'advanced',
						children: [
							jsx('h4', { children: t('advanced') }),
							row('timeoutMs', 'timeoutMs', 'timeoutMsHint', true),
							row('dedupeMs', 'dedupeMs', 'dedupeMsHint', true),
							row('apiOrigin', 'apiOrigin', 'apiOriginHint', false)
						]
					})
				]
			})
		}
		//#endregion

		/** Required services (cordis fiber inject). */
		const inject = ['slots', 'locale', 'configForms'];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(DICT, { en, pt }), 'telegram-notify: dictionaries')
			const t = ctx.locale.bind(DICT)
			const card = new TelegramNotifyCardController(ctx.configForms.get(NS))
			ctx.effect(() => () => card.dispose(), 'telegram-notify: form subscription')
			ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
				name: 'plugins.item',
				id: 'telegram-notify',
				order: 40,
				label: () => t('title'),
				locale: DICT,
				inject: () => card.inject()
			}, TelegramNotifyCard))), 'telegram-notify: page')
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		return module.exports;
	}
});
