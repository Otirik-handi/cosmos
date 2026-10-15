import { expect, it, vi } from "vitest";
import { ContentRebuild, type ContentRebuildRepository } from "./content-rebuild.js";

it("denies rebuild before reading evidence and refuses absent declared input", async () => {
    const repository: ContentRebuildRepository = {
        readRebuildSource: vi.fn(async () => ({ currentRepresentationId: null, locked: false, source: null })),
        commitRebuild: vi.fn(),
    };
    const rebuild = new ContentRebuild(repository);
    await expect(rebuild.rebuild("revision", { actorId: "user", canManageRepresentations: false })).rejects.toThrow("access denied");
    expect(repository.readRebuildSource).not.toHaveBeenCalled();
    await expect(rebuild.rebuild("revision", { actorId: "user", canManageRepresentations: true })).rejects.toThrow("input unavailable");
    expect(repository.commitRebuild).not.toHaveBeenCalled();
});

it("normalizes retained input and carries the observed lock and pointer to commit", async () => {
    const commitRebuild = vi.fn<ContentRebuildRepository["commitRebuild"]>(async () => ({ representationId: "new", representationVersion: 2, promoted: false }));
    const rebuild = new ContentRebuild({
        readRebuildSource: async () => ({ currentRepresentationId: "old", locked: true, source: { format: "safe-html-input", html: "<p>Hello</p><script>bad()</script>" } }),
        commitRebuild,
    });
    expect(await rebuild.rebuild("revision", { actorId: "user", canManageRepresentations: true })).toEqual({ representationId: "new", representationVersion: 2, promoted: false });
    expect(commitRebuild).toHaveBeenCalledWith(expect.objectContaining({
        expectedCurrentId: "old", expectedLocked: true, actorId: "user",
        draft: expect.objectContaining({ contentText: "Hello", status: "complete" }),
    }));
});
