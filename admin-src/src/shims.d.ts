/// <reference types="vite/client" />

// Quill 1.3.7 ships no bundled types and we intentionally avoid @types/quill
// (it targets a different API surface). We use a thin `any` wrapper in
// RichTextEditor.tsx, so a permissive module declaration is enough here.
declare module 'quill';
