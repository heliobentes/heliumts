import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
});
