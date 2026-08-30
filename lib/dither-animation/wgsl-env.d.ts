/// <reference types="@webgpu/types" />
// GPUDevice/GPUTextureUsage/... als globale Typen fuer die Browser-Komponente
// (components/glossary/dithered-canvas.tsx). @webgpu/types ist eine transitive
// Abhaengigkeit von vgpu, aber pnpm haengt sie nicht in node_modules/ ein — als
// direkte devDependency gefuehrt, damit der Verweis von ueberall im Projekt
// aufloest.

// Ambient-Typdeklaration fuer .wgsl-Importe (empfohlen von @vgpu/wgsl/README.md).
// Der konfigurierte Loader (next.config.mjs) macht daraus zur Buildzeit einen
// aufgeloesten WGSL-String — kein Laufzeit-resolveShader() im Browser noetig.
declare module '*.wgsl' {
  const source: string
  export default source
}
