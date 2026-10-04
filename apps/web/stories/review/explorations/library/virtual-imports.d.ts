declare module "virtual:library-imports" {
  const imports: import("./isolation").LibraryImports;
  export default imports;
}

declare module "virtual:composition-coverage" {
  export const notUsedInProduct: string[];
}
