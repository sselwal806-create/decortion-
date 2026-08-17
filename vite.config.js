import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// If you deploy this to GitHub Pages at https://<user>.github.io/<repo>/,
// set `base` to '/<repo>/'. For a custom domain or Vercel/Netlify, leave it as '/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
});
