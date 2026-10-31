import type { ElectrobunConfig } from "electrobun";

// The macOS app. `bun run build` stages the built page, the server and the container agents
// into stage/ (scripts/stage.ts), and Electrobun copies them into the app's Resources/app.
export default {
	app: {
		name: "Monomyth",
		identifier: "com.carlos.monomyth",
		version: "0.1.0",
	},
	build: {
		bun: {
			entrypoint: "src/main.ts",
		},
		copy: {
			"stage/web": "web",
			"stage/server": "server",
			"stage/agent": "agent",
		},
		mac: {
			icons: "assets/icon.iconset",
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
