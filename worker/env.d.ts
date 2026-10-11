// the files wrangler bundles beside the code: fonts as raw bytes, WebAssembly precompiled (a Worker can't compile it
// from bytes at run time)
declare module '*.ttf' { const data: ArrayBuffer; export default data; }
declare module '*.wasm' { const mod: WebAssembly.Module; export default mod; }
