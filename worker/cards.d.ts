// Type shim so the Worker tsconfig (no `resolveJsonModule`) accepts
// `import cardsRaw from '@shared/data/cards.json'`. Wrangler's bundler
// inlines the JSON at build time regardless.
declare module '@shared/data/cards.json' {
  const value: unknown;
  export default value;
}
