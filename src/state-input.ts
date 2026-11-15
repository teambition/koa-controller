import type { SchemaObject } from 'ajv'
import type { Context } from 'koa'
import { ensureMethodMeta } from './metadata.js'
import type { ControllerConstructor } from './metadata.js'
import { before } from './router.js'

/** Part of the request a top-level {@link stateInput} field is read from. */
export type InputSource = 'params' | 'query' | 'body'

const inputSources: readonly InputSource[] = ['params', 'query', 'body']

/** Options accepted by every {@link Type} builder. */
export interface InputFieldOptions {
  /**
   * Part of the request the field is read from. Defaults to `'body'`. Only
   * allowed on top-level fields.
   */
  from?: InputSource
  /**
   * Marks the field as required, making it a non-optional property of the
   * state type. Fields are optional by default.
   */
  required?: boolean
}

type RequiredInputFieldOptions = InputFieldOptions & { required: true }

/**
 * A field definition created by {@link Type}.
 *
 * @typeParam T Declared type of the field's value.
 * @typeParam R Whether the field is required.
 */
export interface InputField<T = unknown, R extends boolean = boolean> {
  /** JSON Schema description of the field's type. */
  readonly schema: SchemaObject
  /** Part of the request the field is read from, when declared. */
  readonly from?: InputSource
  /** Whether the field must be present. */
  readonly required: R
  /** Type-level only; never set at runtime. */
  readonly _type?: T
}

/** A map of field names to field definitions. */
export type InputFields = Record<string, InputField>

type RequiredKeys<F extends InputFields> = {
  [K in keyof F]: F[K] extends InputField<unknown, true> ? K : never
}[keyof F]

type FieldType<F> = F extends InputField<infer T, boolean> ? T : never

/**
 * The state type described by a map of {@link Type} fields. Required fields
 * become required properties; all others are optional.
 *
 * @example
 * ```ts
 * const GetUser = {
 *   id: Type.Number({ from: 'params', required: true }),
 *   verbose: Type.Boolean({ from: 'query' }),
 * }
 * type GetUserState = InputType<typeof GetUser>
 * // { id: number; verbose?: boolean }
 * ```
 */
export type InputType<F extends InputFields> = {
  [K in RequiredKeys<F>]: FieldType<F[K]>
} & {
  [K in Exclude<keyof F, RequiredKeys<F>>]?: FieldType<F[K]>
} extends infer O ? { [K in keyof O]: O[K] } : never

interface FieldBuilder<T> {
  (options: RequiredInputFieldOptions): InputField<T, true>
  (options?: InputFieldOptions): InputField<T, false>
}

function createField<T>(schema: SchemaObject, options: InputFieldOptions = {}): InputField<T, boolean> {
  if (options.from !== undefined && !inputSources.includes(options.from)) {
    throw new TypeError(`Invalid "from" value ${JSON.stringify(options.from)}; expected one of ${inputSources.join(', ')}`)
  }
  return {
    schema,
    required: options.required === true,
    ...(options.from !== undefined ? { from: options.from } : {}),
  }
}

function scalar<T>(type: string): FieldBuilder<T> {
  return ((options?: InputFieldOptions) => createField<T>({ type }, options)) as FieldBuilder<T>
}

function assertNested(field: InputField, label: string) {
  if (field.from !== undefined) {
    throw new TypeError(`"from" is only allowed on top-level fields, but ${label} declares from: '${field.from}'`)
  }
}

function buildObjectSchema(fields: InputFields): SchemaObject {
  const properties: Record<string, SchemaObject> = {}
  const required: string[] = []
  for (const [name, field] of Object.entries(fields)) {
    properties[name] = field.schema
    if (field.required) required.push(name)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

function array<T>(item: InputField<T>, options: RequiredInputFieldOptions): InputField<T[], true>
function array<T>(item: InputField<T>, options?: InputFieldOptions): InputField<T[], false>
function array<T>(item: InputField<T>, options?: InputFieldOptions): InputField<T[], boolean> {
  assertNested(item, 'the array item')
  return createField<T[]>({ type: 'array', items: item.schema }, options)
}

function object<const F extends InputFields>(fields: F, options: RequiredInputFieldOptions): InputField<InputType<F>, true>
function object<const F extends InputFields>(fields: F, options?: InputFieldOptions): InputField<InputType<F>, false>
function object<const F extends InputFields>(fields: F, options?: InputFieldOptions): InputField<InputType<F>, boolean> {
  for (const [name, field] of Object.entries(fields)) {
    assertNested(field, `nested field "${name}"`)
  }
  return createField<InputType<F>>(buildObjectSchema(fields), options)
}

type EnumValue = string | number | boolean

function enumeration<const V extends EnumValue>(values: readonly V[], options: RequiredInputFieldOptions): InputField<V, true>
function enumeration<const V extends EnumValue>(values: readonly V[], options?: InputFieldOptions): InputField<V, false>
function enumeration<const V extends EnumValue>(values: readonly V[], options?: InputFieldOptions): InputField<V, boolean> {
  if (values.length === 0) {
    throw new TypeError('Type.Enum requires at least one value')
  }
  const types = [...new Set(values.map(value => typeof value))]
  return createField<V>({ ...(types.length === 1 ? { type: types[0] } : {}), enum: [...values] }, options)
}

const unionMemberTypes = ['string', 'number', 'boolean']

function union<const M extends readonly InputField[]>(members: M, options: RequiredInputFieldOptions): InputField<FieldType<M[number]>, true>
function union<const M extends readonly InputField[]>(members: M, options?: InputFieldOptions): InputField<FieldType<M[number]>, false>
function union<const M extends readonly InputField[]>(members: M, options?: InputFieldOptions): InputField<FieldType<M[number]>, boolean> {
  const types: string[] = []
  for (const member of members) {
    assertNested(member, 'a union member')
    const { type, ...rest } = member.schema
    if (!unionMemberTypes.includes(type) || Object.keys(rest).length > 0) {
      throw new TypeError('Type.Union only accepts Type.String(), Type.Number() and Type.Boolean() members')
    }
    if (!types.includes(type)) types.push(type)
  }
  if (types.length < 2) {
    throw new TypeError('Type.Union requires at least two different member types')
  }
  return createField<FieldType<M[number]>>({ type: types }, options)
}

/**
 * Builders for the fields accepted by {@link stateInput}.
 *
 * Each builder describes one field: its type, where it is read from (`from`),
 * and whether it is required (`required`). Fields are optional and read from
 * the request body unless stated otherwise. The builders only describe a
 * field: they produce its TypeScript type and a JSON Schema description of
 * it. Nothing is validated here; use `validateState` for that.
 *
 * @example
 * ```ts
 * const CreateComment = {
 *   id: Type.Number({ from: 'params', required: true }),
 *   content: Type.String({ required: true }),
 *   page: Type.Number({ from: 'query' }),
 *   tags: Type.Array(Type.String()),
 * }
 * ```
 */
export const Type = {
  /** A string field. */
  String: scalar<string>('string'),
  /** A number field. */
  Number: scalar<number>('number'),
  /** A boolean field. */
  Boolean: scalar<boolean>('boolean'),
  /** An array whose items are described by another field. */
  Array: array,
  /** A nested object. Nested fields are read from the same source as the object. */
  Object: object,
  /** A field restricted to a fixed list of values. */
  Enum: enumeration,
  /**
   * A field that accepts any of several primitive types, for example
   * `Type.Union([Type.String(), Type.Number()])` for `string | number`.
   *
   * Members are limited to `Type.String()`, `Type.Number()` and
   * `Type.Boolean()`.
   */
  Union: union,
}

function readSource(ctx: Context, source: InputSource): unknown {
  switch (source) {
    case 'params': return (ctx as Context & { params?: unknown }).params
    case 'query': return ctx.query
    case 'body': return (ctx.request as Context['request'] & { body?: unknown }).body
  }
}

/**
 * Builds `ctx.state` from declared request fields before the controller
 * method runs, and describes its TypeScript type.
 *
 * Each field names the part of the request it comes from with `from`
 * (`'params'`, `'query'` or `'body'`, defaulting to `'body'`) and keeps the
 * name it has there. Only declared fields are copied, so a value can never
 * arrive from an unexpected part of the request. The resulting object replaces
 * `ctx.state`.
 *
 * This decorator does not validate or convert anything: values are copied as
 * they arrive, so path and query values are strings, and a field marked
 * `required` may be missing. The declared types are a description of what the
 * method expects. Put {@link validateState} below this decorator to enforce
 * it; its schema is what checks types, required fields, and converts values.
 *
 * Use {@link InputType} to derive the state type from the same definition.
 * The decorator reports a compile error when the method's `state` parameter
 * does not accept that type.
 *
 * @param fields Map of field names to {@link Type} definitions.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * const CreateComment = {
 *   id: Type.Number({ from: 'params', required: true }),
 *   content: Type.String({ required: true }),
 *   page: Type.Number({ from: 'query' }),
 * }
 *
 * @post('/posts/:id/comments')
 * @stateInput(CreateComment)
 * @validateState({
 *   type: 'object',
 *   required: ['id', 'content'],
 *   properties: {
 *     id: { type: 'integer' },
 *     content: { type: 'string' },
 *     page: { type: 'integer' },
 *   },
 * })
 * async createComment(state: InputType<typeof CreateComment>) {
 *   // state: { id: number; content: string; page?: number }
 * }
 * ```
 */
export function stateInput<const F extends InputFields>(fields: F) {
  const sources = new Map<string, InputSource>()
  for (const [name, field] of Object.entries(fields)) {
    sources.set(name, field.from ?? 'body')
  }

  const decorator = before(async function stateInputMW (ctx) {
    // No prototype while collecting, so a field named `__proto__` is stored as
    // an ordinary property.
    const state: Record<string, unknown> = Object.create(null)
    for (const [name, source] of sources) {
      const values = readSource(ctx, source)
      if (typeof values !== 'object' || values === null) continue
      // Own properties only: a field named like an Object.prototype member
      // (`constructor`, `toString`, ...) is absent unless the request sent it.
      if (!Object.prototype.hasOwnProperty.call(values, name)) continue
      const value = (values as Record<string, unknown>)[name]
      if (value === undefined) continue
      state[name] = value
    }
    ctx.state = { ...state }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <M extends (state: InputType<F>, ...args: any[]) => unknown>(
    target: object,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<M>
  ): void => {
    ensureMethodMeta(target.constructor as ControllerConstructor, propertyName).input = fields
    decorator(target, propertyName, descriptor)
  }
}
