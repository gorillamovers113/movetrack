/* The version file must name a bundle that actually shipped.
 *
 * The first cut of this used a build timestamp. Vite evaluates its config more
 * than once per build, so the id baked into the JS did not match the id
 * written to disk, and every freshly loaded page instantly announced it was
 * out of date. Nobody noticed until the nag appeared on a reload. This runs on
 * every build so that class of mistake cannot ship again.
 */
import { readFileSync, existsSync } from 'node:fs'

const version = JSON.parse(readFileSync('dist/version.json', 'utf8'))
if (!version.bundle) {
  console.error('version.json names no bundle')
  process.exit(1)
}
const path = `dist/assets/${version.bundle}`
if (!existsSync(path)) {
  console.error(`version.json names ${version.bundle}, which is not in dist/assets`)
  process.exit(1)
}
const html = readFileSync('dist/index.html', 'utf8')
if (!html.includes(version.bundle)) {
  console.error(`index.html does not load ${version.bundle}`)
  process.exit(1)
}
console.log(`version.json ✓ ${version.bundle}`)
