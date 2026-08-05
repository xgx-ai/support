import { dirname, join } from "node:path";
import { SolidPlugin } from "@xgx/ui/bun-plugin-solid";
import tailwind from "bun-plugin-tailwind";

const demoRoot = import.meta.dir;
export const demoDist = join(demoRoot, "dist");

function packageRoot(specifier: string, from = demoRoot): string {
	return dirname(Bun.resolveSync(`${specifier}/package.json`, from));
}

const solidRoot = packageRoot("solid-js");
const webRoot = packageRoot("@solidjs/web");
const signalsRoot = packageRoot("@solidjs/signals");
const uiEntry = Bun.resolveSync("@xgx/ui", demoRoot);

const demoDependencyResolver: Bun.BunPlugin = {
	name: "workflow-demo-dependency-resolver",
	setup(build) {
		build.onResolve({ filter: /^@xgx\/ui$/ }, () => ({ path: uiEntry }));
		build.onResolve({ filter: /^solid-js$/ }, () => ({
			path: join(solidRoot, "dist/dev.js"),
		}));
		build.onResolve({ filter: /^@solidjs\/web$/ }, () => ({
			path: join(webRoot, "dist/dev.js"),
		}));
		build.onResolve({ filter: /^@solidjs\/signals$/ }, () => ({
			path: join(signalsRoot, "dist/dev.js"),
		}));
	},
};

export async function buildDemo(): Promise<void> {
	const result = await Bun.build({
		entrypoints: [join(demoRoot, "index.html")],
		outdir: demoDist,
		target: "browser",
		sourcemap: "linked",
		plugins: [demoDependencyResolver, tailwind, SolidPlugin({ hmr: false })],
	});

	if (!result.success) {
		for (const message of result.logs) console.error(message);
		throw new Error("Could not build the support workflow demo");
	}

	console.log(`Built ${result.outputs.length} workflow demo assets.`);
}

if (import.meta.main) await buildDemo();
