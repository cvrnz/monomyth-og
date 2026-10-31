// Gathers what goes into the macOS app's Resources/app, in stage/:
//
//   web/          the built page (frontend/dist)
//   server/       the server's source and its production dependencies, run by the app's Bun
//   agent/bin/    the container agents (server/src/remote.ts finds them at ../../agent/bin)
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const desktop = path.resolve(import.meta.dir, "..");
const root = path.resolve(desktop, "..");
const stage = path.join(desktop, "stage");

if (!Bun.which("go")) {
	console.error("Go isn't installed; it's needed to build the container agent (https://go.dev/dl)");
	process.exit(1);
}

console.log("building the page");
if (!existsSync(path.join(root, "frontend/node_modules"))) await $`bun install`.cwd(path.join(root, "frontend"));
await $`bun run build`.cwd(path.join(root, "frontend"));

console.log("building the container agents");
await $`go run ./scripts/buildagent`.cwd(root);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
cpSync(path.join(root, "frontend/dist"), path.join(stage, "web"), { recursive: true });
cpSync(path.join(root, "agent/bin"), path.join(stage, "agent/bin"), { recursive: true });

console.log("staging the server");
const server = path.join(stage, "server");
cpSync(path.join(root, "server/src"), path.join(server, "src"), {
	recursive: true,
	filter: (f) => !f.endsWith(".test.ts"),
});
for (const f of ["package.json", "bun.lock"]) cpSync(path.join(root, "server", f), path.join(server, f));
await $`bun install --production --frozen-lockfile`.cwd(server);

console.log(`staged in ${stage}`);
