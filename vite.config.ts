import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any subpath (e.g. GitHub Pages /elf-and-crab/).
  base: './',
  server: {
    // In dev the multiplayer server runs separately (npm run dev starts both); proxy its socket.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
