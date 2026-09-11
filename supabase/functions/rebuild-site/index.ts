import { createRebuildHandler } from "./handler.mjs";

Deno.serve(createRebuildHandler({ env: (name: string) => Deno.env.get(name), fetch }));
