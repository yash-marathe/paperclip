import { URL } from "node:url";
import dns from "node:dns/promises";

/**
 * Private/reserved IPv4 and IPv6 ranges that should not be reachable
 * from outbound adapter requests (SSRF prevention).
 */
const PRIVATE_IPV4_PREFIXES = [
  "10.", "127.", "0.",
  "169.254.", "192.168.",
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
];

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateIpv4(address: string): boolean {
  for (const prefix of PRIVATE_IPV4_PREFIXES) {
    if (address.startsWith(prefix)) return true;
  }
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIpv4(lower.slice(7));
  return false;
}

function isPrivateIp(address: string): boolean {
  return isPrivateIpv4(address) || isPrivateIpv6(address);
}

/**
 * Validates that an outbound URL does not target internal/private networks
 * or cloud metadata endpoints. Resolves DNS to check the actual IP.
 *
 * Throws an Error if the URL is unsafe.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  const hostname = url.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`URL targets a blocked metadata endpoint: ${hostname}`);
  }

  if (isPrivateIp(hostname)) {
    throw new Error(`URL targets a private IP address: ${hostname}`);
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        throw new Error(
          `URL hostname "${hostname}" resolves to private IP ${addr.address}`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes("private IP") || err.message.includes("blocked metadata"))) {
      throw err;
    }
    // DNS resolution failures are not SSRF — the request will fail at fetch level
  }
}
