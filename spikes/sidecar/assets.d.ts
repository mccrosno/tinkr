// `import x from '...exe' with { type: 'file' }` gives a path string in Bun.
declare module '*.exe' {
  const path: string
  export default path
}
