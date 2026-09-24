import { isIP } from "node:net";

/** True only for global-unicast addresses reachable from a public network. */
export function isPublicAddress(address: string): boolean {
    if (isIP(address) === 4) {
        return isPublicIpv4(address);
    }
    if (isIP(address) === 6) {
        return isPublicIpv6(address);
    }
    return false;
}

export function isPublicIpv4(address: string): boolean {
    const octets = address.split(".").map((part) => Number.parseInt(part, 10));
    if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
        return false;
    }
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127) {
        return false;
    }
    if (a === 100 && b >= 64 && b <= 127) {
        return false; // CGNAT
    }
    if (a === 169 && b === 254) {
        return false; // link-local
    }
    if (a === 172 && b >= 16 && b <= 31) {
        return false; // RFC1918
    }
    if (a === 192 && b === 168) {
        return false; // RFC1918
    }
    if (a === 192 && (b === 0 || b === 2 || b === 51 || b === 168)) {
        return false; // IETF special purpose / documentation
    }
    if (a === 198 && (b === 18 || b === 19 || b === 51)) {
        return false; // benchmarking / TEST-NET-2
    }
    if (a === 203 && b === 0) {
        return false; // TEST-NET-3
    }
    if (a >= 224) {
        return false; // multicast / reserved / broadcast
    }
    return c >= 0;
}

export function isPublicIpv6(address: string): boolean {
    const words = expandIpv6(address);
    if (!words) {
        return false;
    }
    const [w0, w1] = words;
    if (words.every((word) => word === 0)) {
        return false; // ::
    }
    if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) {
        return false; // ::1
    }
    if ((w0 & 0xfe00) === 0xfc00) {
        return false; // ULA fc00::/7
    }
    if ((w0 & 0xffc0) === 0xfe80) {
        return false; // link-local
    }
    if ((w0 & 0xffc0) === 0xfec0) {
        return false; // site-local (deprecated)
    }
    if ((w0 & 0xff00) === 0xff00) {
        return false; // multicast
    }
    if (w0 === 0x2001 && w1 === 0x0db8) {
        return false; // documentation
    }
    return true;
}

export function expandIpv6(address: string): number[] | null {
    let mapped4: string | null = null;
    const v4Candidate = address.includes("::ffff:")
        ? address.slice(address.indexOf("::ffff:") + 7)
        : null;
    if (v4Candidate && v4Candidate.includes(".")) {
        mapped4 = v4Candidate;
    }
    const hexPart = mapped4 ? null : address;
    if (mapped4) {
        const parts = mapped4.split(".");
        if (parts.length !== 4) {
            return null;
        }
        const octets = parts.map((part) => Number.parseInt(part, 10));
        if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
            return null;
        }
        if (!isPublicIpv4(mapped4)) {
            return null;
        }
        return [0, 0, 0, 0, 0, 0xffff, (octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    }
    const pieces = hexPart!.split("::");
    if (pieces.length > 2) {
        return null;
    }
    const head = pieces[0] ? pieces[0].split(":") : [];
    const tail = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
    const headWords = head.map((part) => Number.parseInt(part, 16));
    const tailWords = tail.map((part) => Number.parseInt(part, 16));
    if (headWords.some((word) => Number.isNaN(word)) || tailWords.some((word) => Number.isNaN(word))) {
        return null;
    }
    const gap = pieces.length === 2 ? 8 - headWords.length - tailWords.length : 0;
    if (gap < 0 || (pieces.length === 1 && headWords.length !== 8)) {
        return null;
    }
    return [...headWords, ...Array.from({ length: gap }, () => 0), ...tailWords];
}
