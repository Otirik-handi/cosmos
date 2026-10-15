import { expect, it, vi } from "vitest";
import { ContentCommands, type ContentSelectionState } from "./content-commands.js";

const command = { entryRevisionId: "revision", expectedCurrentId: "current", expectedLocked: false, operation: "lock" as const };
const authority = { actorId: "user", canManageRepresentations: true };
function setup(target: ContentSelectionState["target"] = null) {
    const readSelection = vi.fn(async () => ({ entryRevisionId: "revision", currentRepresentationId: "current", locked: false, target }));
    const commitSelection = vi.fn(async (input: { currentRepresentationId: string | null; locked: boolean }) => ({ ...input, changed: true }));
    return { commands: new ContentCommands({ readSelection, commitSelection }), readSelection, commitSelection };
}

it("denies management before repository access", async () => {
    const fixture = setup();
    await expect(fixture.commands.select(command, { ...authority, canManageRepresentations: false })).rejects.toMatchObject({ code: "access_denied" });
    expect(fixture.readSelection).not.toHaveBeenCalled();
});
it("passes expected pointer and lock to the atomic commit", async () => {
    const fixture = setup();
    await fixture.commands.select(command, authority);
    expect(fixture.commitSelection).toHaveBeenCalledWith({ command, actorId: "user", currentRepresentationId: "current", locked: true });
    await expect(fixture.commands.select({ ...command, expectedLocked: true }, authority)).rejects.toMatchObject({ code: "conflict" });
    expect(fixture.commitSelection).toHaveBeenCalledTimes(1);
});
it("rolls back only to a usable same-revision representation and locks it", async () => {
    const rollback = { ...command, operation: "rollback" as const, representationId: "old" };
    const fixture = setup({ id: "old", entryRevisionId: "revision", status: "partial" });
    await expect(fixture.commands.select(rollback, authority)).resolves.toMatchObject({ currentRepresentationId: "old", locked: true });
    for (const target of [{ id: "old", entryRevisionId: "other", status: "complete" as const }, { id: "old", entryRevisionId: "revision", status: "failed" as const }]) {
        const invalid = setup(target);
        await expect(invalid.commands.select(rollback, authority)).rejects.toMatchObject({ code: "conflict" });
        expect(invalid.commitSelection).not.toHaveBeenCalled();
    }
});
it("rejects rollback without an explicit target", async () => {
    const fixture = setup();
    await expect(fixture.commands.select({ ...command, operation: "rollback" }, authority)).rejects.toMatchObject({ code: "invalid_command" });
    expect(fixture.readSelection).not.toHaveBeenCalled();
});
