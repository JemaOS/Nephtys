import path from "node:path"
import { execSync } from "node:child_process"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-identifier'

// Commit git du build : permet de VERIFIER que le client deploye correspond a
// une revision connue du depot (build verifiable).
function resolveBuildCommit(): string {
  const env = process.env.GIT_COMMIT?.trim()
  if (env) return env.slice(0, 12)
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production' || process.env.BUILD_MODE === 'prod'
  const buildCommit = resolveBuildCommit()

  return {
    define: {
      __BUILD_COMMIT__: JSON.stringify(buildCommit),
    },
    plugins: [
      react(),
      sourceIdentifierPlugin({
        enabled: !isProd,
        attributePrefix: 'data-matrix',
        includeProps: true,
      })
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      include: ['pdfjs-dist'],
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'supabase-vendor': ['@supabase/supabase-js'],
            'ui-vendor': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-popover',
              '@radix-ui/react-tooltip',
              'lucide-react'
            ],
          }
        }
      }
    }
  }
})
