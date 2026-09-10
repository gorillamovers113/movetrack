import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/* Two test environments in one project.
 *
 * Everything in src/lib is pure and runs in node, which is fast and keeps the
 * domain tests honest about having no DOM. The component tests need a DOM, so
 * they opt into jsdom with a @vitest-environment pragma at the top of the
 * file, rather than the whole suite paying for a DOM it does not use.
 *
 * The component layer exists because three bugs reached a crew phone that no
 * amount of domain testing could have caught: a missing import that white
 * screened the app, a toast that covered the buttons underneath it, and a
 * cleanup effect that revoked a photo preview while it was still on screen.
 * All three were rendering, not logic.
 */
export default defineConfig({
  plugins: [react()],
})
