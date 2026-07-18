import { readFileSync, writeFileSync } from 'node:fs'

const [, , version, outputFile] = process.argv

if (!version || !outputFile) {
  throw new Error('Usage: extract-release-notes.mjs <version> <output-file>')
}

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const headingPattern = new RegExp(
  `^#{1,2} \\[?v?${escapedVersion}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^#{1,2} |(?![\\s\\S]))`,
  'm',
)
const match = headingPattern.exec(changelog)
const notes = match?.[1]?.trim() || `Release v${version}.`

writeFileSync(outputFile, `${notes}\n`)
