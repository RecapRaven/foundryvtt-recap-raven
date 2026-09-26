import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { zipSync } from "fflate";
export const assets = [
  "module.json",
  "recap-raven.js",
  "styles/recap-raven.css",
  "lang/en.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES",
];
await rm("dist", { recursive: true, force: true });
await mkdir("dist/styles", { recursive: true });
await mkdir("dist/lang", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/recap-raven.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: false,
  minify: true,
  legalComments: "eof",
});
for (const asset of assets.filter((a) => a !== "recap-raven.js"))
  await copyFile(asset, `dist/${asset}`);
const entries = {};
for (const asset of assets)
  entries[asset] = new Uint8Array(await readFile(`dist/${asset}`));
// A stable timestamp makes archives reproducible across clean builds.
await writeFile(
  "dist/recap-raven.zip",
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, data]) => [
        name,
        [data, { mtime: new Date("2026-01-01T00:00:00Z") }],
      ]),
    ),
    { level: 9 },
  ),
);
