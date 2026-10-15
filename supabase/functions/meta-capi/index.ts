import { createMetaCapiHandler } from "./handler.mjs";

Deno.serve(createMetaCapiHandler({ env: (name: string) => Deno.env.get(name), fetch }));
