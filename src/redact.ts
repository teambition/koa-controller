/** Placeholder written in place of a redacted value. */
export const REDACTED = '[REDACTED]'

/**
 * Request headers whose values are replaced by {@link redactHeaders} by
 * default.
 */
export const defaultRedactedHeaders: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
]

/**
 * Query parameters whose values are replaced by {@link redactUrl} by default.
 */
export const defaultRedactedQueryKeys: readonly string[] = [
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'api_key',
  'apikey',
  'signature',
  'sig',
]

function toNameSet(defaults: readonly string[], extra: readonly string[] = []): Set<string> {
  return new Set([...defaults, ...extra].map(name => name.toLowerCase()))
}

/**
 * Returns a copy of the headers with the values of sensitive headers replaced
 * by `[REDACTED]`. Header names are matched case-insensitively.
 *
 * @param headers Headers to copy, typically `ctx.headers`.
 * @param extra Header names to redact in addition to
 * {@link defaultRedactedHeaders}.
 * @returns A new headers object; the input is not modified.
 *
 * @example
 * ```ts
 * redactHeaders(ctx.headers, ['x-internal-secret'])
 * ```
 */
export function redactHeaders<T>(headers: Record<string, T>, extra: readonly string[] = []): Record<string, T | string> {
  const names = toNameSet(defaultRedactedHeaders, extra)
  const result: Record<string, T | string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    result[name] = names.has(name.toLowerCase()) ? REDACTED : value
  }
  return result
}

/**
 * Returns the URL with the values of sensitive query parameters replaced by
 * `[REDACTED]`. Parameter names are matched case-insensitively; the rest of
 * the URL is returned unchanged.
 *
 * Matching is by parameter name only, so a secret carried in the path or under
 * an unlisted name is not detected.
 *
 * @param url Request URL or path, typically `ctx.originalUrl`.
 * @param extra Query parameter names to redact in addition to
 * {@link defaultRedactedQueryKeys}.
 * @returns The URL with sensitive query values replaced.
 *
 * @example
 * ```ts
 * redactUrl('/callback?token=abc&page=2') // '/callback?token=[REDACTED]&page=2'
 * ```
 */
export function redactUrl(url: string, extra: readonly string[] = []): string {
  if (typeof url !== 'string') return url
  const queryStart = url.indexOf('?')
  if (queryStart === -1) return url

  const names = toNameSet(defaultRedactedQueryKeys, extra)
  const query = url.slice(queryStart + 1).split('&').map(pair => {
    const separator = pair.indexOf('=')
    if (separator === -1) return pair
    const rawName = pair.slice(0, separator)
    let name = rawName
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '))
    } catch {
      // keep the raw name when it is not valid percent-encoding
    }
    return names.has(name.toLowerCase()) ? `${rawName}=${REDACTED}` : pair
  }).join('&')
  return `${url.slice(0, queryStart)}?${query}`
}
