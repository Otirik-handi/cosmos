/**
 * Secret storage owned by Cosmos (ADR-0017). Adapters negotiate auth and the
 * credential shape but never decide where a secret is persisted. The public
 * contract exposes only an opaque `SecretRef` and capability-limited leases:
 * callers write/reveal/delete a value by ref and never see the storage layout.
 */
export interface SecretStorePort {
    /** Persist a secret under an opaque reference; overwrites an existing value. */
    put(secretRef: string, value: string): Promise<void>;

    /** Reveal a secret; returns null when the ref has no stored value. */
    read(secretRef: string): Promise<string | null>;

    /** Remove a secret; returns true when a value was removed, false when absent. */
    delete(secretRef: string): Promise<boolean>;
}
