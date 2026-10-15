import type { ContentProfile } from "@cosmos/domain";

export interface ContentReadAuthority {
    readonly allowedProfiles: readonly ContentProfile[];
}

// Authority is supplied by the authenticated host, never by the request payload.
export function requireContentProfile(authority: ContentReadAuthority, profile: ContentProfile): void {
    if (!authority.allowedProfiles.includes(profile)) {
        throw new Error(`Content profile access denied: ${profile}`);
    }
}
