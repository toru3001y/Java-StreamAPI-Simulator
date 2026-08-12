import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    /**
     * bundle分割（Phase 5持越し。Phase 6指示 §10.3）。
     *
     * production bundleが単一chunkで500 kBを超え、Viteのchunk size警告が出ていた。
     * React本体（react / react-dom / scheduler）を静的な別chunkへ切り出すことで、
     * 各chunkを500 kB未満に収める。dynamic import()は使わず、index.htmlは
     * entry chunkのscriptとvendor chunkのmodulepreloadを両方出力するため、
     * 初回描画のタイミングとロード内容は分割前と変わらない（挙動不変）。
     */
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
