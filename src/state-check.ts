import type { SchemaObject } from 'ajv'
import type { MethodMeta } from './metadata.js'

// Keywords that make a schema's meaning depend on more than its own
// `properties` and `required`. A schema using one of them at its root cannot
// be compared with a field list reliably, so it is not checked.
const combinatorKeywords = [
  'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else',
  '$ref', '$dynamicRef', 'dependentSchemas', 'dependencies', 'patternProperties',
]

function isComparable(schema: SchemaObject): boolean {
  if (schema.type !== undefined && schema.type !== 'object') return false
  return !combinatorKeywords.some(keyword => keyword in schema)
}

/** Lists the JavaScript types a schema's `type` keyword allows, if it has one. */
function typesOf(schema: SchemaObject): string[] | undefined {
  if (schema.type === undefined) return undefined
  const types: unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type]
  return [...new Set(types.map(type => type === 'integer' ? 'number' : String(type)))]
}

/**
 * Throws when the fields declared with `@stateInput` and the schemas declared
 * with `@validateState` on a method contradict each other.
 *
 * `@stateInput` describes the state's type and `@validateState` is what
 * enforces it at runtime, so a disagreement means the method's `state` type is
 * wrong. Called when a router is built, so the mistake surfaces at startup
 * instead of as a wrong value at request time; every problem on the method is
 * reported in one error.
 *
 * The comparison only reads each schema's top-level `properties` and
 * `required`, and each property's `type`. A schema that uses a combinator such
 * as `oneOf` at its root is skipped, and when a method has such a schema the
 * checks that need the whole picture (uncovered and unenforced fields) are
 * skipped too.
 */
export function assertStateConsistent(controllerName: string, propertyName: string, methodMeta: MethodMeta): void {
  const fields = methodMeta.input
  if (!fields || methodMeta.stateSchemas.length === 0) return

  const problems: string[] = []
  const comparable = methodMeta.stateSchemas.filter(isComparable)
  const complete = comparable.length === methodMeta.stateSchemas.length
  const covered = new Set<string>()
  const enforced = new Set<string>()

  for (const schema of comparable) {
    const properties: Record<string, unknown> = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
    const required: string[] = Array.isArray(schema.required) ? schema.required.map(String) : []

    for (const name of new Set([...Object.keys(properties), ...required])) {
      if (!Object.prototype.hasOwnProperty.call(fields, name)) {
        problems.push(`"${name}" is in the @validateState schema but is not a @stateInput field, so it can never have a value`)
      }
    }
    for (const name of required) enforced.add(name)

    for (const [name, property] of Object.entries(properties)) {
      covered.add(name)
      if (!Object.prototype.hasOwnProperty.call(fields, name) || !property || typeof property !== 'object') continue
      const declared = typesOf(fields[name].schema)
      const validated = typesOf(property as SchemaObject)
      if (!declared || !validated) continue
      const unexpected = validated.filter(type => !declared.includes(type))
      if (unexpected.length > 0) {
        problems.push(`"${name}" is declared as ${declared.join(' | ')} in @stateInput, but the @validateState schema allows ${unexpected.join(' | ')}`)
      }
    }
  }

  if (complete) {
    for (const [name, field] of Object.entries(fields)) {
      if (!covered.has(name)) {
        problems.push(`"${name}" is a @stateInput field but is not in the @validateState schema, so it is never checked or converted`)
      } else if (field.required && !enforced.has(name)) {
        problems.push(`"${name}" is required in @stateInput but not in the @validateState schema, so it may be missing`)
      }
    }
  }

  if (problems.length > 0) {
    throw new TypeError(
      `${controllerName}.${propertyName}: @stateInput and @validateState do not match:\n` +
      problems.map(problem => `  - ${problem}`).join('\n')
    )
  }
}
