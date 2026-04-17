import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // Relative base so the built assets work whether deployed to root or a
  // repo-subpath GitHub Pages URL (e.g. user.github.io/join-fips).
  base: "./",
  server: {
    port: 5173,
  },
});
