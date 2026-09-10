import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.yatraflow.mobile',
  appName: 'YatraFlow',
  webDir: 'dist',
  plugins: {
    // Android 15 forces edge-to-edge; the WebView's env(safe-area-inset-*)
    // reads 0 there, which let fixed/sticky UI crop under the system bars.
    // The core runtime injects correct --safe-area-inset-* values instead;
    // the CSS consumes them with an env() fallback chain.
    SystemBars: {
      insetsHandling: 'css',
    },
  },
};

export default config;
