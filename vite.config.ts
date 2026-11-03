import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  // Collect safe, explicit allowed hosts for development and preview environments.
  // NEVER use wildcard or boolean true.
  const explicitAllowedHosts = ['localhost', '127.0.0.1', '.localhost'];

  // Add Render external hostname if provided by the environment
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    explicitAllowedHosts.push(process.env.RENDER_EXTERNAL_HOSTNAME.trim());
  }

  // Add optional user-configured hosts
  if (process.env.VITE_ALLOWED_HOSTS) {
    const custom = process.env.VITE_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    explicitAllowedHosts.push(...custom);
  }

  const allowedHosts = Array.from(new Set(explicitAllowedHosts));

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Safe, explicit allowed hosts - never boolean true
      allowedHosts,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      // Safe, explicit allowed hosts for preview if ever invoked
      allowedHosts,
    },
  };
});
