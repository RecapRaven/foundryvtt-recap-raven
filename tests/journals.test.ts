import { version } from "../package.json";
import { describe, it, expect, vi } from "vitest";
import {
  importSession,
  sha256,
  journalId,
  findJournal,
  type Journal,
  type JournalData,
  type JournalStore,
} from "../src/journals/import";
import { renderRecap } from "../src/journals/render";
import { session, campaignId, sessionId } from "./fixtures";
function fixtureStore() {
  const entries = new Map<string, Journal>();
  const data: JournalData[] = [];
  const store: JournalStore = {
    all: () => entries.values(),
    get: (id) => entries.get(id),
    create: async (source) => {
      await Promise.resolve();
      if (entries.has(source._id)) throw new Error("Duplicate ID");
      const journal = {
        id: source._id,
        getFlag: () => source.flags["recap-raven"]!.source,
      };
      entries.set(source._id, journal);
      data.push(source);
      return journal;
    },
  };
  return { store, entries, data };
}
const options = { folder: null, publish: false };
describe("native journal imports", () => {
  it("checks SHA-256 against known digest", async () =>
    expect(await sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ));
  it("creates private native journals with identity and no credentials", async () => {
    const { store, data } = fixtureStore();
    const recap = {
      ...session,
      content_sha256: await sha256(session.markdown),
    };
    expect(await importSession(store, recap, options)).toBe("created");
    expect(data[0]).toMatchObject({
      ownership: { default: 0 },
      pages: [{ type: "text", text: { format: 1 } }],
    });
    expect(data[0]!._id).toMatch(/^[a-f0-9]{16}$/);
    expect(data[0]!.flags["recap-raven"]!.source).toEqual({
      campaignId,
      sessionId,
      digest: recap.content_sha256,
      importerVersion: version,
    });
    expect(
      await importSession(store, { ...recap, title: "Renamed" }, options),
    ).toBe("skipped");
    expect(data).toHaveLength(1);
  });
  it("publishes only by explicit choice and keeps unrelated campaigns separate", async () => {
    const { store, data } = fixtureStore();
    const recap = {
      ...session,
      title: null,
      session_number: null,
      content_sha256: await sha256(session.markdown),
    };
    await importSession(store, recap, { folder: "folder", publish: true });
    await importSession(store, { ...recap, campaign_id: sessionId }, options);
    expect(data[0]).toMatchObject({
      folder: "folder",
      ownership: { default: 2 },
      name: `Session ${sessionId}`,
    });
    expect(data[1]!._id).not.toBe(data[0]!._id);
  });
  it("handles simultaneous creates atomically using a deterministic ID", async () => {
    const { store, data } = fixtureStore();
    const recap = {
      ...session,
      content_sha256: await sha256(session.markdown),
    };
    expect(
      (
        await Promise.all([
          importSession(store, recap, options),
          importSession(store, recap, options),
        ])
      ).sort(),
    ).toEqual(["created", "skipped"]);
    expect(data).toHaveLength(1);
  });
  it("rejects unrelated ID collisions without overwriting", async () => {
    const { store, entries, data } = fixtureStore();
    const id = await journalId(campaignId, sessionId);
    entries.set(id, {
      id,
      getFlag: () => ({ campaignId: "other", sessionId }),
    });
    await expect(
      importSession(
        store,
        { ...session, content_sha256: await sha256(session.markdown) },
        options,
      ),
    ).rejects.toThrow("collision");
    expect(data).toHaveLength(0);
  });
  it("keeps imports create-only after renamed/moved documents", async () => {
    const { store, entries } = fixtureStore();
    entries.set("different", {
      id: "different",
      getFlag: () => ({ campaignId, sessionId }),
    });
    expect(findJournal(store, campaignId, sessionId)?.id).toBe("different");
    expect(
      await importSession(
        store,
        { ...session, content_sha256: await sha256(session.markdown) },
        options,
      ),
    ).toBe("skipped");
  });
  it("fails safely on content corruption, missing create result and storage failure", async () => {
    const { store } = fixtureStore();
    await expect(importSession(store, session, options)).rejects.toThrow(
      "integrity",
    );
    const recap = {
      ...session,
      content_sha256: await sha256(session.markdown),
    };
    store.create = vi.fn().mockResolvedValue(undefined);
    await expect(importSession(store, recap, options)).rejects.toThrow(
      "confirmed",
    );
    store.create = vi.fn().mockRejectedValue(new Error("Disk full"));
    await expect(importSession(store, recap, options)).rejects.toThrow(
      "confirmed",
    );
  });
  it("removes active HTML, tracking images, and Foundry enrichment syntax", () => {
    const safe = renderRecap(
      '# Title\n\n<script>alert(1)</script><img src="https://tracker.example" onerror="x()"><iframe src="https://evil.example"></iframe>\n\n[link](javascript:alert(1))\n\n[[/roll 1d20]] @UUID[JournalEntry.secret]{Secret} &#91;&#91;1d6&#93;&#93; &#64;UUID[hidden]',
    );
    expect(safe).toContain("<h1>Title</h1>");
    expect(safe).not.toMatch(/script|img|iframe|onerror|href|\[|@UUID/u);
    expect(renderRecap("**Bold** and *emphasis*")).toContain(
      "<strong>Bold</strong>",
    );
  });
});
