// Vite `?raw` imports return the referenced file's text as a string. The backend
// uses them to inline and emit the Honk OpenCode plugin modules at runtime.
declare module "*?raw" {
  const source: string;
  export default source;
}
