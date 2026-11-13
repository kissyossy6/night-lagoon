import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { videoStore } from './scripts/video-store';
import { vr180Store } from './scripts/vr180-store';
import { controlStore } from './scripts/control-store';
import { artnetBridge } from './scripts/artnet-bridge';
import { projectStore } from './scripts/project-store';

/**
 * Every page asks for the typeface files at once (preload), so its first
 * paint is already in BIZ UD Gothic instead of switching from the fallback a
 * frame later. The list is read from src/styles/fonts.css, the one place the
 * typefaces are named.
 */
function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    transformIndexHtml() {
      const css = readFileSync(resolve(__dirname, 'src/styles/fonts.css'), 'utf8');
      const urls = [...new Set([...css.matchAll(/url\(['"]?([^'")]+\.woff2)['"]?\)/g)].map((m) => m[1]))];
      return urls.map((href) => ({ tag: 'link', attrs: { rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' as const }));
    },
  };
}

export default defineConfig({
  plugins: [preloadFonts(), videoStore(__dirname), vr180Store(__dirname), controlStore(__dirname), artnetBridge(), projectStore(__dirname)],
  server: { port: 5199, strictPort: true },
  // bundled from the start: found only when a page first imports it, Vite
  // re-bundles and open pages get "504 Outdated Optimize Dep" until reloaded
  optimizeDeps: { include: ['three/examples/jsm/utils/BufferGeometryUtils.js'] },
  build: {
    // the player and the editor read the project before they start (top-level await)
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        lab: resolve(__dirname, 'lab.html'),
        edit: resolve(__dirname, 'edit.html'),
        venue: resolve(__dirname, 'venue.html'),
        pyrolab: resolve(__dirname, 'pyrolab.html'),
      },
    },
  },
});
