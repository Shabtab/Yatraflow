// ============ ESLint (flat config, ESLint 10) ============
// Minimal, high-value setup: it deliberately does NOT gate the build. The repo's
// gate is `npm run verify` (tsc + vitest + vite build); lint here exists to catch
// the class of bugs those three can't — React hook dependency mistakes (e.g. the
// InviteGate effect that ran once before hydration), unreachable code, and plain
// JS errors. Run it with `npm run lint`.
//
// Scoped to src/ so vendored/third-party code and tests stay out of the way.
import tsEslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Raw browser-API call sites that must route through the native bridge
// (lib/native.ts) or the haptics wrapper (lib/haptics.ts): Android WebViews
// don't implement the Vibration API, create no window for target=_blank,
// and permission-gate/share differently — direct calls work on the web and
// silently degrade inside the installed app. Nothing catches that at build
// time; this rule catches it at review time.
const NATIVE_BRIDGE_ONLY = [
  "MemberExpression[object.name='navigator'][property.name='clipboard']",
  "MemberExpression[object.name='navigator'][property.name='share']",
  "MemberExpression[object.name='navigator'][property.name='geolocation']",
  "MemberExpression[object.name='navigator'][property.name='vibrate']",
].join(', ')

export default tsEslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'docs/**', 'scripts/**', 'tests/**'] },
  ...tsEslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
  // The native-bridge guard applies everywhere EXCEPT the bridge itself and
  // the haptics wrapper (whose whole job is the platform-fallback dance).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/native.ts', 'src/lib/haptics.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: NATIVE_BRIDGE_ONLY,
          message: 'Route this through lib/native.ts (or lib/haptics.ts for vibration) — a direct call works on the web but silently degrades inside the Android app. The bridge handles the plugin path and keeps the browser fallback.',
        },
      ],
    },
  },
)