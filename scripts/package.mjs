// Builds a portable, zip-able app in dist-app/: one bundled server file + built UI + launchers.
import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-app");

execSync("npm run build:ui", { cwd: root, stdio: "inherit" });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "server", "src", "bundle.js")],
  outfile: path.join(out, "mocker.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // Bundled CommonJS deps (express, cors) call require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

fs.cpSync(path.join(root, "admin-ui", "dist"), path.join(out, "ui"), {
  recursive: true,
});
if (fs.existsSync(path.join(root, "configs"))) {
  fs.cpSync(path.join(root, "configs"), path.join(out, "configs"), {
    recursive: true,
  });
}
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ type: "module" }, null, 2),
);

const bat = [
  "@echo off",
  'cd /d "%~dp0"',
  "where node >nul 2>nul || (echo Node.js 18 or later is required: https://nodejs.org & pause & exit /b 1)",
  "echo API Mocker - admin UI: http://localhost:4001   mock API: http://localhost:4000",
  'start "" cmd /c "timeout /t 2 >nul & start http://localhost:4001"',
  "node mocker.js",
  "pause",
  "",
].join("\r\n");
fs.writeFileSync(path.join(out, "start.bat"), bat);

const sh = [
  "#!/bin/sh",
  'cd "$(dirname "$0")" || exit 1',
  'command -v node >/dev/null 2>&1 || { echo "Node.js 18 or later is required: https://nodejs.org"; exit 1; }',
  'echo "API Mocker - admin UI: http://localhost:4001   mock API: http://localhost:4000"',
  "exec node mocker.js",
  "",
].join("\n");
fs.writeFileSync(path.join(out, "start.sh"), sh, { mode: 0o755 });

const zip = path.join(root, "api-mocker.zip");
fs.rmSync(zip, { force: true });
try {
  execSync(`tar -a -c -f "${zip}" -C "${out}" .`, { stdio: "ignore" });
  console.log(`Created ${zip}`);
} catch {
  console.log(
    `Created ${out} (zip it manually; "tar -a" is not available here)`,
  );
}
