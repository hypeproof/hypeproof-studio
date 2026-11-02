// The pre-minified pdfjs-dist builds carry no type declarations of their own.
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
declare module "pdfjs-dist/legacy/build/pdf.min.mjs" {
  export * from "pdfjs-dist/legacy/build/pdf.mjs";
}
