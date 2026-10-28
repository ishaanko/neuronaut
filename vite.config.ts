import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The fonts on screen at first paint. Without a preload they're only requested once React renders text, and swapping
// them in after the fallback font rewraps the page (a 0.7 layout shift on /daily).
const PRELOAD = [/source-serif-4-latin-(400|700)-normal-.*\.woff2$/, /geist-mono-latin-(400|500)-normal-.*\.woff2$/];

function preloadFonts(): Plugin {
  return {
    name: "preload-fonts",
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html; // dev server: nothing hashed to point at
      const files = Object.keys(ctx.bundle).filter((f) => PRELOAD.some((re) => re.test(f)));
      return {
        html,
        tags: files.map((f) => ({
          tag: "link",
          attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${f}`, crossorigin: "" },
          injectTo: "head" as const,
        })),
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
});
