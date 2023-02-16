import { AsyncLocalStorage } from 'async_hooks'
export const als = new AsyncLocalStorage<Record<string, any>>()
