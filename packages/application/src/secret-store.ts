/**
 * Secret storage owned by Cosmos (ADR-0017). Adapters negotiate auth and the
 * credential shape but never decide where a secret is persisted. The public
 * contract exposes only opaque `SecretRef` values: callers write, reveal,
 * or delete a value by ref and never see the storage layout. Reads are not
 * leased; sensitive consumers must constrain where the returned string flows.
 */
export interface SecretStorePort {
    /** Persist a secret under an opaque reference; overwrites an existing value. */
    put(secretRef: string, value: string): Promise<void>;

    /** Read a secret; returns null when the ref has no stored value. This is not a lease. */
    read(secretRef: string): Promise<string | null>;

    /** Remove a secret; returns true when a value was removed, false when absent. */
    delete(secretRef: string): Promise<boolean>;
}
