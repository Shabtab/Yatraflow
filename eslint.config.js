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
)