// `@roebel-data/entrypoint` is resolved by next.config.ts at build time.
//
// Normal Röbel builds resolve it to the existing client App shell. The sealed
// public Marienfelder build resolves it to a server-rendered, static-only
// entrypoint instead. Keeping the import behind that build-time alias is
// intentional: a conditional inside the normal App would still put its wallet,
// Circles, proposal and analytics modules into the public artifact.
import Entrypoint from "@roebel-data/entrypoint";

export default Entrypoint;
