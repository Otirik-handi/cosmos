import { describe, expect, it } from "vitest";
import { fingerprintEntryRevision } from "./content.js";
import type { ContentSource } from "./content-representation.js";

const fields = { title: "Article", summary: null, contentText: "same text", webUrl: null, kind: "article" as const, publisher: null };

describe("source revision fingerprint", () => {
    it("keeps undeclared legacy source fingerprints unchanged", () => {
        expect(fingerprintEntryRevision(fields)).toBe(fingerprintEntryRevision({ ...fields, contentSource: undefined }));
    });

    it("detects image and ordering changes despite equal text", () => {
        const first: ContentSource = { format: "safe-html-input", html: "<p>same text</p><img src='https://example.test/a.png'>" };
        const changed: ContentSource = { ...first, html: "<p>same text</p><img src='https://example.test/b.png'>" };
        const reordered: ContentSource = { ...first, html: "<img src='https://example.test/a.png'><p>same text</p>" };
        const fingerprint = fingerprintEntryRevision({ ...fields, contentSource: first });
        expect(fingerprint).not.toBe(fingerprintEntryRevision({ ...fields, contentSource: changed }));
        expect(fingerprint).not.toBe(fingerprintEntryRevision({ ...fields, contentSource: reordered }));
    });

    it("does not create a source revision when only the derived text changes", () => {
        const contentSource: ContentSource = { format: "safe-html-input", html: "<p>same text</p>" };
        expect(fingerprintEntryRevision({ ...fields, contentSource })).toBe(fingerprintEntryRevision({ ...fields, contentText: "new parser projection", contentSource }));
        expect(fingerprintEntryRevision(fields)).not.toBe(fingerprintEntryRevision({ ...fields, contentText: "changed legacy source" }));
    });

    it("canonicalizes source object keys while preserving block order", () => {
        const first: ContentSource = { format: "plain-text", text: "same text" };
        const reorderedKeys: ContentSource = { text: "same text", format: "plain-text" };
        expect(fingerprintEntryRevision({ ...fields, contentSource: first })).toBe(fingerprintEntryRevision({ ...fields, contentSource: reorderedKeys }));
    });
});
