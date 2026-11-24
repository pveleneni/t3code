import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { configuredHostedAppOrigin, normalizeHostedAppOrigin } from "./connectAuth.ts";

export const THREAD_LINK_PROTOCOL = "t3-thread";
const V1_PREFIX = `${THREAD_LINK_PROTOCOL}://v1/`;
const V2_PREFIX = `${THREAD_LINK_PROTOCOL}://v2/`;
const HOSTED_SEGMENT = "[A-Za-z0-9_%-]+";
const THREAD_HREF = String.raw`t3-thread:\/\/v[12]\/`;
// A label stops at any bracket, so a run of unclosed brackets is scanned once, not once per bracket.
const LABEL = String.raw`[^[\]\n]*`;
const patternCache = new Map<string, RegExp>();

function hostedPrefix(origin: string | null | undefined): string | null {
  const normalized = normalizeHostedAppOrigin(origin ?? undefined);
  return normalized === null ? null : `${normalized}/threads/`;
}

/** Only a configured hosted app's links are thread links; every build still reads `t3-thread://`. */
function threadLinkPattern(origin: string | null | undefined): RegExp {
  const key = hostedPrefix(origin) ?? "";
  const cached = patternCache.get(key);
  if (cached) return cached;
  const escapedPrefix = key.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const hostedLink = key ? `${escapedPrefix}${HOSTED_SEGMENT}/${HOSTED_SEGMENT}` : null;
  const href = (suffix: string) =>
    hostedLink ? `${THREAD_HREF}${suffix}|${hostedLink}` : `${THREAD_HREF}${suffix}`;
  // Earlier alternatives claim text so later ones cannot match inside it: an escaped character opens
  // nothing, code is literal, and a link to anywhere else keeps a thread URL in its label or href.
  const pattern = new RegExp(
    [
      String.raw`\\[!-/:-@[-\`{-~]`,
      String.raw`(?<fence>(\`{3,}|~{3,})[\s\S]*?(?:\2|$))`,
      String.raw`(?<span>(\`+)[^\n]*?\4)`,
      // A labeled link's destination may be angle-bracketed, as CommonMark allows: [label](<href>).
      String.raw`\[(?<label>${LABEL})\]\((?:<(?<angleHref>${href("[^\\s<>]+")})>|(?<href>${href("[^\\s>)]+")}))\)`,
      String.raw`\[${LABEL}\]\((?:<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?\)`,
      String.raw`<(?<autolink>${href("[^\\s<>]+")})>`,
      // After a URL character the hosted link is part of a longer URL, such as a redirect target.
      ...(hostedLink
        ? [String.raw`(?<![A-Za-z0-9%/?#=&@+-])(?<bare>${hostedLink})(?![\w%/?#-])`]
        : []),
    ].join("|"),
    "g",
  );
  patternCache.set(key, pattern);
  return pattern;
}

const decodeThreadId = Schema.decodeUnknownOption(ThreadId);
const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);

/** A v1 link names no environment; the message's own, or a unique match, stands in. */
export interface ThreadLink {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId;
}

// Escapes even URL-safe punctuation, so a sentence's closing period never reads as part of an id.
const hostedSegment = (id: string) =>
  encodeURIComponent(id).replace(
    /[.!~*'()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Opens the thread from anywhere; null when no hosted app origin is configured. */
export function hostedThreadLink(
  ref: ScopedThreadRef,
  origin: string | null = configuredHostedAppOrigin(),
): string | null {
  const normalized = normalizeHostedAppOrigin(origin ?? undefined);
  if (normalized === null) return null;
  const path = `/threads/${hostedSegment(ref.environmentId)}/${hostedSegment(ref.threadId)}`;
  return new URL(path, normalized).toString();
}

const HOSTED_PATH = new RegExp(`^(${HOSTED_SEGMENT})/(${HOSTED_SEGMENT})$`);

function parseHostedThreadLink(href: string, prefix: string): ThreadLink | null {
  const match = HOSTED_PATH.exec(href.slice(prefix.length));
  if (!match) return null;
  try {
    const environmentId = Option.getOrNull(decodeEnvironmentId(decodeURIComponent(match[1]!)));
    const threadId = Option.getOrNull(decodeThreadId(decodeURIComponent(match[2]!)));
    return environmentId === null || threadId === null ? null : { environmentId, threadId };
  } catch {
    return null;
  }
}

/**
 * The ids as written. Thread ids can hold percent escapes of their own, so they are not decoded,
 * except in a hosted link, which escapes them itself.
 */
export function parseThreadLinkHref(
  href: string,
  hostedAppOrigin: string | null = configuredHostedAppOrigin(),
): ThreadLink | null {
  const prefix = hostedPrefix(hostedAppOrigin);
  if (prefix !== null && href.startsWith(prefix)) return parseHostedThreadLink(href, prefix);
  if (href.startsWith(V1_PREFIX)) {
    const threadId = Option.getOrNull(decodeThreadId(href.slice(V1_PREFIX.length)));
    return threadId === null ? null : { environmentId: null, threadId };
  }
  if (!href.startsWith(V2_PREFIX)) return null;
  const path = href.slice(V2_PREFIX.length);
  const slash = path.indexOf("/");
  if (slash < 0) return null;
  const environmentId = Option.getOrNull(decodeEnvironmentId(path.slice(0, slash)));
  const threadId = Option.getOrNull(decodeThreadId(path.slice(slash + 1)));
  return environmentId === null || threadId === null ? null : { environmentId, threadId };
}

function percentDecodedThreadLinkId(threadId: ThreadId): ThreadId | null {
  try {
    const decoded = decodeURIComponent(threadId);
    return decoded === threadId ? null : Option.getOrNull(decodeThreadId(decoded));
  } catch {
    return null;
  }
}

/** The threads a link can name, in its own environment or else the message's: as written, then decoded. */
export function threadLinkCandidates(
  link: ThreadLink,
  messageEnvironmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  const environmentId = link.environmentId ?? messageEnvironmentId;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  const written = { environmentId, threadId: link.threadId };
  return decodedId === null ? [written] : [written, { environmentId, threadId: decodedId }];
}

/** A v1 link its message's environment lacks opens a unique match elsewhere; a v2 link never does. */
export function guessThreadLinkRef(
  link: ThreadLink,
  refs: ReadonlyArray<ScopedThreadRef>,
): ScopedThreadRef | null {
  if (link.environmentId !== null) return null;
  const decodedId = percentDecodedThreadLinkId(link.threadId);
  for (const threadId of decodedId === null ? [link.threadId] : [link.threadId, decodedId]) {
    let match: ScopedThreadRef | null = null;
    for (const ref of refs) {
      if (ref.threadId !== threadId) continue;
      if (match !== null) return null;
      match = ref;
    }
    if (match !== null) return match;
  }
  return null;
}

function threadLinkHref(link: ThreadLink): string {
  return link.environmentId === null
    ? `${V1_PREFIX}${link.threadId}`
    : `${V2_PREFIX}${link.environmentId}/${link.threadId}`;
}

const linkLabel = (label: string | undefined) =>
  label
    ?.replace(/[[\]\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Without a label, an autolink: clients show the thread's current title. */
export function formatThreadLink(ref: ThreadLink, label?: string): string {
  const cleaned = linkLabel(label);
  const href = threadLinkHref(ref);
  const destination = /[()]/.test(href) ? `<${href}>` : href;
  return cleaned ? `[${cleaned}](${destination})` : `<${href}>`;
}

/** What a person copies out of T3 Code: a Markdown link that opens the thread anywhere. */
export function formatHostedThreadLink(
  ref: ScopedThreadRef,
  label: string,
  origin: string | null = configuredHostedAppOrigin(),
): string | null {
  const href = hostedThreadLink(ref, origin);
  if (href === null) return null;
  const cleaned = linkLabel(label);
  return cleaned ? `[${cleaned}](${href})` : href;
}

export function hasThreadLinks(
  markdown: string,
  hostedAppOrigin: string | null = configuredHostedAppOrigin(),
): boolean {
  const prefix = hostedPrefix(hostedAppOrigin);
  return (
    markdown.includes(`${THREAD_LINK_PROTOCOL}://v`) ||
    (prefix !== null && markdown.includes(prefix))
  );
}

/** Every thread the markdown's links can name, so their titles are keyed reads. */
export function threadLinkRefs(
  markdown: string,
  messageEnvironmentId: EnvironmentId,
  hostedAppOrigin: string | null = configuredHostedAppOrigin(),
): ReadonlyArray<ScopedThreadRef> {
  const refs = new Map<string, ScopedThreadRef>();
  // Hermes' matchAll yields matches without `groups`; exec keeps them.
  const pattern = new RegExp(threadLinkPattern(hostedAppOrigin));
  for (let match = pattern.exec(markdown); match !== null; match = pattern.exec(markdown)) {
    const href =
      match.groups?.angleHref ?? match.groups?.href ?? match.groups?.autolink ?? match.groups?.bare;
    const link = href === undefined ? null : parseThreadLinkHref(href, hostedAppOrigin);
    if (link === null) continue;
    for (const ref of threadLinkCandidates(link, messageEnvironmentId)) {
      refs.set(`${ref.environmentId}/${ref.threadId}`, ref);
    }
  }
  return [...refs.values()];
}

/** Rewrites each link outside code `replace` answers for. `label` is a Markdown link's own text. */
export function replaceThreadLinks(
  markdown: string,
  replace: (link: ThreadLink, label: string | undefined) => string | undefined,
  hostedAppOrigin: string | null = configuredHostedAppOrigin(),
): string {
  if (!hasThreadLinks(markdown, hostedAppOrigin)) return markdown;
  return markdown.replace(threadLinkPattern(hostedAppOrigin), (source, ...args) => {
    const groups = args.at(-1) as Partial<
      Record<"angleHref" | "href" | "autolink" | "bare" | "label", string>
    >;
    const href = groups.angleHref ?? groups.href ?? groups.autolink ?? groups.bare;
    const link = href === undefined ? null : parseThreadLinkHref(href, hostedAppOrigin);
    return (link && replace(link, groups.label)) ?? source;
  });
}
