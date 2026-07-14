import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../app/dist", import.meta.url));
const destination = fileURLToPath(new URL("../web", import.meta.url));

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
