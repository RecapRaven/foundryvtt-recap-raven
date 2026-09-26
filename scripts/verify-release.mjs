import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
const expected = [
  "LICENSE",
  "THIRD_PARTY_NOTICES",
  "lang/en.json",
  "module.json",
  "recap-raven.js",
  "styles/recap-raven.css",
];
const files = unzipSync(new Uint8Array(await readFile("dist/recap-raven.zip")));
assert.deepEqual(Object.keys(files).sort(), expected);
const manifest = JSON.parse(strFromU8(files["module.json"]));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
assert.equal(manifest.version, pkg.version);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
assert.equal(manifest.id, "recap-raven");
assert.equal(
  manifest.download,
  `https://github.com/RecapRaven/foundryvtt-recap-raven/releases/download/v${pkg.version}/recap-raven.zip`,
);
if (process.env.RELEASE_TAG)
  assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`);
for (const asset of [
  ...manifest.esmodules,
  ...manifest.styles,
  ...manifest.languages.map((l) => l.path),
])
  assert.ok(files[asset]);
assert.equal(
  strFromU8(files["recap-raven.js"]).includes("sourceMappingURL"),
  false,
);
for (const [name, data] of Object.entries(files)) {
  assert.equal(strFromU8(data), await readFile(`dist/${name}`, "utf8"));
  assert.doesNotMatch(strFromU8(data), /raven_f(?:gm|pl)_[A-Za-z0-9_-]{32,}/u);
}
console.log("Release archive verified.");
