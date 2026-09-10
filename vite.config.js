import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Every build publishes the name of its own JS bundle, so a running app can
 * tell whether it is the current one.
 *
 * A crew phone does not reload. It gets opened at 8am and stays open, so after
 * a deploy it keeps executing the bundle it launched with, indefinitely. On
 * 10 Sep that put Víctor on the pre-vault build long enough for a rules change
 * to start rejecting his writes: he stood at a sealed vault getting "Missing
 * or insufficient permissions" while the fix had been live for twenty minutes.
 * Hosting headers already made a RELOAD pick up the new bundle; nothing was
 * telling anyone to reload.
 *
 * The identity is the bundle's content hash, not a build timestamp. A
 * timestamp seemed obvious and was wrong twice over: Vite evaluates this
 * config more than once per build, so the value baked in via `define` did not
 * match the value written to disk, and every freshly loaded page immediately
 * announced it was out of date. A content hash cannot drift that way, and it
 * has the better property anyway: rebuilding unchanged code produces the same
 * name, so a redeploy that changes nothing nags nobody.
 */
function publishVersion() {
  return {
    name: 'movetrack-version',
    // version.json sits outside /assets on purpose: /assets is served
    // immutable-for-a-year, which is exactly wrong for the one file whose job
    // is to always be fresh.
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry)
      const name = entry ? entry.fileName.split('/').pop() : null
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ bundle: name }) + '\n' })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), publishVersion()],
})
