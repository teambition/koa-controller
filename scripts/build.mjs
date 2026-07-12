import { execSync } from 'child_process'
import { readdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const LIB = 'lib'
const LIB_CJS = 'lib-cjs'

// Clean and prepare
rmSync(LIB, { recursive: true, force: true })
rmSync(LIB_CJS, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })

// Step 1: Build CJS
execSync('tsc -p tsconfig.build.cjs.json', { stdio: 'inherit' })

// Step 2: Post-process CJS output — fix .cjs extensions and strip import.meta
if (existsSync(LIB_CJS)) {
  for (const f of readdirSync(LIB_CJS)) {
    if (f.endsWith('.js')) {
      const filePath = join(LIB_CJS, f)
      let content = readFileSync(filePath, 'utf-8')
      // Replace require("./foo.js") → require("./foo.cjs")
      content = content.replace(/require\("(\.[^"]+)\.js"\)/g, 'require("$1.cjs")')
      // Strip import.meta — in CJS, metaUrl will be "" so require is used
      content = content.replace(/const metaUrl = .*/, "const metaUrl = '' // stripped for CJS")
      writeFileSync(filePath, content)
      // Rename .js → .cjs and move to lib/
      const newName = f.replace(/\.js$/, '.cjs')
      renameSync(filePath, join(LIB, newName))
    }
  }
  rmSync(LIB_CJS, { recursive: true })
}

// Step 3: Build ESM
execSync('tsc -p tsconfig.build.json', { stdio: 'inherit' })

console.log('✅ Dual build complete: lib/*.js (ESM) + lib/*.cjs (CJS)')
