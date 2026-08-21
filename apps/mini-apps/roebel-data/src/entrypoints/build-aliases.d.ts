/**
 * Build-only aliases are resolved by next.config.ts. TypeScript receives this
 * minimal contract so typechecking does not resolve the sealed build back to
 * the normal application graph.
 */
declare module "@roebel-data/entrypoint" {
  const Entrypoint: () => import("react").ReactElement | null;
  export default Entrypoint;
}

declare module "@roebel-data/manifest" {
  export const manifest: {
    name: string;
    description: string;
    primaryColor?: string;
  };
}
