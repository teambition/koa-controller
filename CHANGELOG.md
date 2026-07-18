# 2.0.0 (2026-07-18)

### Bug Fixes

* **libs:** migrate to typescript 6, upgrade deps and fix esm compatibility ([#4](https://github.com/teambition/koa-controller/issues/4)) ([5f9958f](https://github.com/teambition/koa-controller/commit/5f9958fa99bb0a944ba5373f5ce14ac9386aecea))

### Features

* add release-please and npm publish workflows ([#5](https://github.com/teambition/koa-controller/issues/5)) ([425f489](https://github.com/teambition/koa-controller/commit/425f489c892ee9786a3c98a55e5c0a7793b6a56d))
* migrate to ESM with dual CJS/ESM build, 52 tests at 97.66% coverage ([#2](https://github.com/teambition/koa-controller/issues/2)) ([434c4a1](https://github.com/teambition/koa-controller/commit/434c4a1414efbec163ec59c8bb792b17b37c55a5))
* support before and after fn tracer ([d16d5ac](https://github.com/teambition/koa-controller/commit/d16d5ac253f382c47851e584dc9b93a12d5b38a5))
* use Reflect store meta info for controller ([fa23093](https://github.com/teambition/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))

### BREAKING CHANGES

* package is now ESM (type: module). CJS consumers use lib/index.cjs via exports map.

  - Dual build: ESM (lib/*.js) + CJS (lib/*.cjs)
  - API: getRouterSync (sync/require), getRouterAsync (async/import), loadRouter
  - Expand test coverage from 6 to 52 tests
  - Replace nyc with c8 for ESM-native coverage
  - Add CJS/ESM example projects
  - Fix all ESLint errors, upgrade TypeScript 5.5, ESLint 8.56
  - Add GitHub Actions CI (Node 18/20/22/24) on pull_request
