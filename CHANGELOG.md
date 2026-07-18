# Changelog

## [2.0.0-alpha.2](https://github.com/orangemi/koa-controller/compare/v2.0.0-alpha.1...v2.0.0-alpha.2) (2026-07-18)


### ⚠ BREAKING CHANGES

* package is now ESM (type: module). CJS consumers use lib/index.cjs via exports map.

### Features

* add example ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* add name in trace for built-in middware ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* add release-please and npm publish workflows ([#5](https://github.com/orangemi/koa-controller/issues/5)) ([425f489](https://github.com/orangemi/koa-controller/commit/425f489c892ee9786a3c98a55e5c0a7793b6a56d))
* add validator ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* ensure sequence ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* migrate to ESM with dual CJS/ESM build, 52 tests at 97.66% coverage ([#2](https://github.com/orangemi/koa-controller/issues/2)) ([434c4a1](https://github.com/orangemi/koa-controller/commit/434c4a1414efbec163ec59c8bb792b17b37c55a5))
* optimize logger & state ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* optimize logger and errorHandler ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* support before and after fn tracer ([d16d5ac](https://github.com/orangemi/koa-controller/commit/d16d5ac253f382c47851e584dc9b93a12d5b38a5))
* support multi route in controller and method ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* tracer ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* upgrade example ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* use Reflect store meta info for controller ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))


### Bug Fixes

* add --tag latest for prerelease npm publish ([c14f340](https://github.com/orangemi/koa-controller/commit/c14f340c857b76503dbfa145b52088d33b43b9a8))
* ensure release-as input handles empty string correctly ([61c4a5c](https://github.com/orangemi/koa-controller/commit/61c4a5c10d54a4f03c6a50985f2f54832dbf6a8f))
* **libs:** migrate to typescript 6, upgrade deps and fix esm compatibility ([#4](https://github.com/orangemi/koa-controller/issues/4)) ([5f9958f](https://github.com/orangemi/koa-controller/commit/5f9958fa99bb0a944ba5373f5ce14ac9386aecea))


### Performance Improvements

* remove unsed var ([d16d5ac](https://github.com/orangemi/koa-controller/commit/d16d5ac253f382c47851e584dc9b93a12d5b38a5))
* rename combine-state to state.ts ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* rename validate ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))

## 2.0.0-alpha.1 (2026-07-13)


### ⚠ BREAKING CHANGES

* package is now ESM (type: module). CJS consumers use lib/index.cjs via exports map.

### Features

* add example ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* add name in trace for built-in middware ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* add release-please and npm publish workflows ([#5](https://github.com/orangemi/koa-controller/issues/5)) ([425f489](https://github.com/orangemi/koa-controller/commit/425f489c892ee9786a3c98a55e5c0a7793b6a56d))
* add validator ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* ensure sequence ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* migrate to ESM with dual CJS/ESM build, 52 tests at 97.66% coverage ([#2](https://github.com/orangemi/koa-controller/issues/2)) ([434c4a1](https://github.com/orangemi/koa-controller/commit/434c4a1414efbec163ec59c8bb792b17b37c55a5))
* optimize logger & state ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* optimize logger and errorHandler ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* support before and after fn tracer ([d16d5ac](https://github.com/orangemi/koa-controller/commit/d16d5ac253f382c47851e584dc9b93a12d5b38a5))
* support multi route in controller and method ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* tracer ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* upgrade example ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))
* use Reflect store meta info for controller ([fa23093](https://github.com/orangemi/koa-controller/commit/fa230938730db0f09f7798218865c167504e6bb5))


### Bug Fixes

* **libs:** migrate to typescript 6, upgrade deps and fix esm compatibility ([#4](https://github.com/orangemi/koa-controller/issues/4)) ([5f9958f](https://github.com/orangemi/koa-controller/commit/5f9958fa99bb0a944ba5373f5ce14ac9386aecea))


### Performance Improvements

* remove unsed var ([d16d5ac](https://github.com/orangemi/koa-controller/commit/d16d5ac253f382c47851e584dc9b93a12d5b38a5))
* rename combine-state to state.ts ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
* rename validate ([32fb8f2](https://github.com/orangemi/koa-controller/commit/32fb8f20442c1eedba77fa9ca8f8149807ac018d))
