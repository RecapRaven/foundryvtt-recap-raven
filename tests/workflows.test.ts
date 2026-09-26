import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
const read = (name: string) =>
  readFileSync(`.github/workflows/${name}.yml`, "utf8");
function gateSource(name: string) {
  const workflow = read(name);
  const start = workflow.indexOf("            const pr =");
  const end =
    workflow.indexOf(
      "core.setOutput('allowed', String(isDependabot || isAdministrator));",
      start,
    ) +
    "core.setOutput('allowed', String(isDependabot || isAdministrator));"
      .length;
  return workflow
    .slice(start, end)
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n");
}
async function admitted(
  name: string,
  patch: Record<string, unknown>,
  permission = "admin",
) {
  const output = vi.fn();
  const getPermission = vi.fn().mockResolvedValue({ data: { permission } });
  const context = {
    payload: {
      repository: { id: 10 },
      pull_request: {
        head: { repo: { id: 10 } },
        user: { login: "maintainer", type: "User", id: 100 },
        ...patch,
      },
    },
    repo: { owner: "example", repo: "example" },
  };
  const execute = new Function(
    "context",
    "core",
    "github",
    `return (async()=>{${gateSource(name)}})()`,
  );
  await execute(
    context,
    { setOutput: output },
    { rest: { repos: { getCollaboratorPermissionLevel: getPermission } } },
  );
  return output.mock.calls.at(-1)?.[1] === "true";
}
describe("CI admission boundary", () => {
  for (const name of ["ci", "security"]) {
    it(`${name}: admits same-repository administrators and actual Dependabot only`, async () => {
      expect(await admitted(name, {})).toBe(true);
      expect(await admitted(name, {}, "write")).toBe(false);
      expect(await admitted(name, { head: { repo: { id: 11 } } })).toBe(false);
      expect(await admitted(name, { head: { repo: null } })).toBe(false);
      expect(
        await admitted(
          name,
          { user: { login: "dependabot[bot]", type: "Bot", id: 49699333 } },
          "read",
        ),
      ).toBe(true);
      expect(
        await admitted(
          name,
          { user: { login: "dependabot[bot]", type: "Bot", id: 999 } },
          "read",
        ),
      ).toBe(false);
      expect(
        await admitted(
          name,
          { user: { login: "dependabot[bot]", type: "User", id: 49699333 } },
          "read",
        ),
      ).toBe(false);
      expect(
        await admitted(
          name,
          { title: "$(touch /tmp/injection)", body: "`malicious`" },
          "read",
        ),
      ).toBe(false);
    });
    it(`${name}: keeps gate metadata-only and checkouts credential-free`, () => {
      const workflow = read(name);
      expect(
        workflow.slice(
          0,
          workflow.indexOf(
            "\n  ",
            workflow.indexOf("core.setOutput('allowed', String"),
          ),
        ),
      ).not.toContain("actions/checkout");
      const checkouts =
        workflow.match(/uses: actions\/checkout@[^\n]+\n(?: +[^\n]+\n)*/gu) ??
        [];
      for (const checkout of checkouts)
        expect(checkout).toContain("persist-credentials: false");
      expect(workflow).not.toContain("${{ github.event.pull_request.title }}");
      expect(workflow).not.toContain("cache: npm");
    });
  }
  it("pins every action and isolates release publication from source execution", () => {
    for (const name of ["ci", "security", "release"])
      for (const match of read(name).matchAll(
        /(?:^|\n)\s*(?:- )?uses: ([^\n]+)/gu,
      ))
        expect(match[1]).toMatch(
          /(?:@[a-f0-9]{40}|@sha256:[a-f0-9]{64})(?:\s|$)/u,
        );
    const release = read("release");
    expect(release).toContain("git merge-base --is-ancestor HEAD origin/main");
    expect(release.slice(release.indexOf("  publish:"))).not.toMatch(
      /checkout|npm|make /u,
    );
  });
});
