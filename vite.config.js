import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* Every build stamps an id, and publishes it at a URL the running app can
 * poll. That is what lets a phone notice it is out of date.
 *
 * A crew phone does not reload. It gets opened at 8am and stays open, so after
 * a deploy it keeps executing the bundle it launched with, indefinitely. On
 * 10 Sep that put Víctor on the pre-vault build long enough for a rules change
 * to start rejecting his writes: he was standing at a sealed vault getting
 * "Missing or insufficient permissions" while the fix had been live for
 * twenty minutes. Hosting headers already make a RELOAD get the new bundle;
 * nothing was telling anyone to reload.
 */
const BUILD_ID = new Date().toISOString()

function publishVersion() {
  return {
    name: 'movetrack-version',
    // version.json sits outside /assets on purpose: /assets is served
    // immutable-for-a-year, which is exactly wrong for the file whose whole
    // job is to always be fresh.
    closeBundle() {
      writeFileSync(join('dist', 'version.json'), JSON.stringify({ build: BUILD_ID }) + '\n')
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), publishVersion()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
