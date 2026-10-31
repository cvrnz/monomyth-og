// The macOS app: starts the server (server/, run by the Bun inside the app) on a free port,
// serving the built page, and shows that page in a native window (the system's WebKit).
//
// Closing the window or quitting goes through the page: the app sends it app:quit-requested,
// the page asks about unsaved changes and saves its session, and then tells the server to
// quit, which passes that on here (see server/src/main.ts).
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Utils } from "electrobun/main";
import path from "node:path";

const app = path.join(PATHS.RESOURCES_FOLDER, "app");

// An app started from Finder or the Dock gets launchd's short PATH, without Homebrew or
// anything the shell profile adds, so oc, git and rg wouldn't be found. Ask the login shell.
async function loginPath(): Promise<string | undefined> {
	const shell = process.env.SHELL || "/bin/zsh";
	const mark = "__monomyth_path__";
	try {
		const proc = Bun.spawn([shell, "-ilc", `printf '${mark}%s${mark}' "$PATH"`], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
		});
		const timer = setTimeout(() => proc.kill(), 5000);
		const out = await new Response(proc.stdout).text();
		clearTimeout(timer);
		return out.split(mark)[1] || undefined;
	} catch {
		return undefined;
	}
}

type FromServer = { ready?: number; dirty?: boolean; quit?: boolean };

let win: BrowserWindow | undefined;
let dirty = false;
let canQuit = false;

const pathFromShell = await loginPath();
const server = Bun.spawn(
	[
		process.execPath,
		path.join(app, "server/src/main.ts"),
		"--addr",
		"127.0.0.1:0",
		"--static",
		path.join(app, "web"),
	],
	{
		cwd: process.env.HOME,
		env: { ...process.env, ...(pathFromShell ? { PATH: pathFromShell } : {}) },
		stdio: ["ignore", "inherit", "inherit"],
		ipc(msg: FromServer) {
			if (msg.ready) open(msg.ready);
			if (msg.dirty !== undefined) dirty = msg.dirty;
			if (msg.quit) quitNow();
		},
	},
);

server.exited.then(async (code) => {
	if (canQuit) return;
	await Utils.showMessageBox({
		type: "error",
		title: "Monomyth",
		message: "Monomyth's server stopped",
		detail: `It exited with code ${code}. Monomyth will close.`,
		buttons: ["Quit"],
	});
	quitNow();
});

function open(port: number) {
	win = new BrowserWindow({
		title: "Monomyth",
		url: `http://127.0.0.1:${port}/`,
		frame: { width: 1400, height: 900 },
	});
	win.center();
	win.on("will-close", (e: any) => {
		if (!askFirst()) return;
		e.response = { allow: false };
	});
}

// Whether to ask the page before closing or quitting (no, once it has agreed). The page answers
// by saving its session and quitting, after asking about unsaved changes (and not at all if the
// person cancels). With nothing unsaved there's nothing to wait for, so if the page doesn't
// answer soon (it may not have loaded), the app quits anyway.
function askFirst(): boolean {
	if (canQuit) return false;
	server.send({ event: "app:quit-requested" });
	setTimeout(() => {
		if (!dirty && !canQuit) quitNow();
	}, 1000);
	return true;
}

function quitNow() {
	canQuit = true;
	server.kill("SIGTERM");
	Utils.quit();
}

Electrobun.events.on("before-quit", (e: any) => {
	if (askFirst()) {
		e.response = { allow: false };
		return;
	}
	canQuit = true;
	server.kill("SIGTERM");
});

// Monomyth's own shortcuts take Cmd+H (previous tab) and Cmd+W (close tab), so the menu
// leaves out Hide and Close. The Edit menu is what makes Cmd+C/V/X/A/Z work in a WebKit view.
// Electrobun gives roles no shortcuts of their own, so each is spelled out.
ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ role: "about" },
			{ type: "divider" },
			{ role: "hideOthers", accelerator: "command+option+h" },
			{ role: "showAll" },
			{ type: "divider" },
			{ role: "quit", accelerator: "command+q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "command+z" },
			{ role: "redo", accelerator: "command+shift+z" },
			{ type: "divider" },
			{ role: "cut", accelerator: "command+x" },
			{ role: "copy", accelerator: "command+c" },
			{ role: "paste", accelerator: "command+v" },
			{ role: "selectAll", accelerator: "command+a" },
		],
	},
	{
		label: "View",
		submenu: [{ role: "toggleFullScreen", accelerator: "command+control+f" }],
	},
	{
		label: "Window",
		submenu: [
			{ role: "minimize", accelerator: "command+m" },
			{ role: "zoom" },
			{ type: "divider" },
			{ role: "bringAllToFront" },
		],
	},
]);
