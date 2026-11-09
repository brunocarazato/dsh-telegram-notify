/**
 * A tiny Schemastery-compatible schema builder.
 *
 * This bundle lives in the user's workspace, so it cannot import
 * `@deepseek-ai/schemastery`: that package resolves only inside the dsh
 * installation and the profile. Cordis validates a plugin's `Config` through
 * the Standard Schema `~standard` contract and the Loader additionally reads
 * `meta`, `dict`, `type`, and `toJSON` for volatile comparison and the
 * settings form, so this module reproduces exactly that observable surface.
 *
 * @module @local/telegram-notify/schema
 */

const MISSING = Symbol('missing')

/** Keys that would mutate a resolved object's prototype chain. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** The parts one clone-based builder call carries over from its source field. */
function snapshot(field) {
  return {
    type: field.type,
    meta: field.meta,
    inner: field.inner,
    list: field.list,
    dict: field.dict,
    values: field.values
  }
}

/** One field descriptor, callable like a Schemastery schema. */
class Field {
  constructor(options = {}) {
    this.type = options.type ?? 'any'
    this.meta = { ...(options.meta ?? {}) }
    if (options.description !== undefined) this.meta.description = options.description
    if (options.default !== undefined) this.meta.default = options.default
    if (options.role !== undefined) this.meta.role = options.role
    if (options.volatile === true) this.meta.volatile = true
    if (options.inner !== undefined) this.inner = options.inner
    if (options.list !== undefined) this.list = options.list
    if (options.dict !== undefined) this.dict = options.dict
    if (options.values !== undefined) this.values = options.values
  }

  /** Mark the field's value as a secret, hidden from settings forms. */
  role(value) {
    return new Field({ ...snapshot(this), meta: { ...this.meta, role: value } })
  }

  /** Let edits apply without remounting the plugin. */
  volatile(value = true) {
    return new Field({ ...snapshot(this), meta: { ...this.meta, volatile: value } })
  }

  default(value) {
    return new Field({ ...snapshot(this), meta: { ...this.meta, default: value } })
  }

  description(text) {
    return new Field({ ...snapshot(this), meta: { ...this.meta, description: text } })
  }

  required(value = true) {
    return new Field({ ...snapshot(this), meta: { ...this.meta, required: value } })
  }

  /** Settings projection reads a plain JSON shape. */
  toJSON() {
    const list = this.list ?? []
    return {
      uid: (this.uid ??= ++counter),
      type: this.type,
      meta: { ...this.meta },
      ...(this.type === 'array' ? { inner: (list[0] ?? new Field({ type: 'any' })).toJSON() } : this.inner === undefined ? {} : { inner: this.inner.toJSON() }),
      ...(this.type === 'union' && list.length > 0 ? { list: list.map((item) => item.toJSON()) } : {}),
      ...(this.type === 'enum' && this.list !== undefined ? { list: this.list.map((item) => item.toJSON()) } : {}),
      ...(this.dict === undefined ? {} : { dict: Object.fromEntries(Object.entries(this.dict).map(([key, item]) => [key, item.toJSON()])) })
    }
  }

  /** Validate and normalize one value against this field. */
  resolve(value) {
    if (value === MISSING || value === undefined) {
      return this.meta.default !== undefined ? this.meta.default : undefined
    }
    switch (this.type) {
      case 'boolean': {
        if (typeof value === 'boolean') return value
        if (value === 'true') return true
        if (value === 'false') return false
        throw new Error(`esperado verdadeiro/falso, recebido ${JSON.stringify(value)}`)
      }
      case 'number': {
        const number = typeof value === 'number' ? value : Number(value)
        if (Number.isFinite(number)) return number
        throw new Error(`esperado um número, recebido ${JSON.stringify(value)}`)
      }
      case 'string': {
        if (typeof value !== 'string') {
          if (typeof value === 'number' || typeof value === 'boolean') return String(value)
          throw new Error(`esperado texto, recebido ${JSON.stringify(value)}`)
        }
        if (this.values !== undefined && !this.values.includes(value)) throw new Error(`esperado um de ${this.values.join(', ')}`)
        return value
      }
      case 'array': {
        if (!Array.isArray(value)) throw new Error('esperado uma lista')
        return value.map((item) => this.list?.[0]?.resolve(item) ?? item)
      }
      case 'union': {
        for (const option of this.list ?? []) {
          try {
            return option.resolve(value)
          } catch {
            // Try the next branch.
          }
        }
        throw new Error(`valor não aceito: ${JSON.stringify(value)}`)
      }
      case 'enum': {
        const values = this.values ?? []
        if (values.includes(value)) return value
        throw new Error(`esperado um de ${values.join(', ')}`)
      }
      case 'const':
        if (value === this.values) return this.values
        throw new Error(`esperado ${JSON.stringify(this.values)}, recebido ${JSON.stringify(value)}`)
      case 'object': {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('esperado um objeto')
        const result = {}
        for (const [key, child] of Object.entries(this.dict ?? {})) {
          const resolved = child.resolve(Object.hasOwn(value, key) ? value[key] : MISSING)
          if (resolved !== undefined) result[key] = resolved
        }
        for (const [key, raw] of Object.entries(value)) {
          if (Object.hasOwn(this.dict ?? {}, key)) continue
          // A configuration key must never reach the prototype chain: an own
          // `__proto__` entry would otherwise replace the result's prototype.
          if (FORBIDDEN_KEYS.has(key)) continue
          result[key] = raw
        }
        return result
      }
      default:
        return value
    }
  }
}

let counter = 0

/** Brand and expose the Standard Schema contract on one field and its children. */
function attune(field, seen = new Set()) {
  if (seen.has(field)) return field
  seen.add(field)
  Object.defineProperty(field, Symbol.for('schemastery'), { value: true, configurable: true })
  Object.defineProperty(field, '~standard', {
    configurable: true,
    get() {
      return {
        version: 1,
        vendor: 'schemastery',
        validate: (value) => {
          try {
            return { value: field.resolve(value === undefined ? MISSING : value) }
          } catch (error) {
            return { issues: [{ message: error instanceof Error ? error.message : String(error), path: [] }] }
          }
        }
      }
    }
  })
  for (const child of Object.values(field.dict ?? {})) if (isField(child)) attune(child, seen)
  for (const child of field.list ?? []) if (isField(child)) attune(child, seen)
  if (isField(field.inner)) attune(field.inner, seen)
  return field
}

/** Whether one list or dict entry is a field rather than a plain value. */
function isField(value) {
  return value instanceof Field
}

const attachStandard = attune

function build(type, extra = {}, options) {
  const source = typeof options === 'string' ? { description: options } : (options ?? {})
  return attachStandard(new Field({ type, ...extra, ...source }))
}

function builder(type, extra = {}) {
  return (options) => build(type, extra, options)
}

/** Schema factories shaped like Schemastery's top-level API. */
export const z = {
  boolean: builder('boolean'),
  number: builder('number'),
  string: builder('string'),
  any: builder('any'),
  array: (inner) => build('array', { list: [inner], inner }),
  const: (value) => build('const', { values: value }),
  union: (options = []) => build('union', { list: options }),
  /** A closed set of string values, projected as a JSON Schema enum. */
  enum: (options = []) => build('string', { values: options }),
  object: (dict = {}) => build('object', { dict })
}

/**
 * Build the plugin's configuration schema.
 * @param shape - field name to Schemastery-like field.
 * @returns the object schema consumed by Cordis and the settings surface.
 */
export function createSchema(shape) {
  return z.object(shape)
}

export default z
