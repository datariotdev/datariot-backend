const day = 86_400;
const minimumAgeSeconds = 180 * day;
const pageSize = 200;
const maxPagesPerWindow = 5;
const searchUrl = "https://hn.algolia.com/api/v1/search";
const recommendation =
  /\b(?:recommend (?:you |to )?(?:watch(?:ing)?|check(?:ing)? out)|worth (?:a watch|watching|checking out)|must[- ]watch|(?:great|excellent|fantastic|helpful|good|interesting|useful) (?:video|clip|demo|explainer|explanation|overview|breakdown|tutorial|points)|does a (?:great|good|excellent) job (?:of )?explain(?:ing)?|explains? (?:it|this) (?:well|clearly)|well explained|check (?:this|it) out)\b/i;
const missingReference =
  /\b(?:can['’]t|couldn['’]t|cannot|don['’]t (?:seem to be able to|know where to))\s+find\b/i;
const negatedRecommendation =
  /(?:\b(?:not|never)\b|n['’]t)\s+(?:(?:a|really|particularly|exactly|very|even)\s+){0,3}$/i;

export interface Comment {
  objectID: string;
  author: string;
  story_id: number;
  created_at_i: number;
  comment_text: string;
}

interface Reference {
  comment_id: string;
  thread_id: number;
  posted_at: string;
}

export type VideoSource = "tiktok" | "youtube_shorts";

export interface Candidate {
  source: VideoSource;
  source_video_id: string;
  source_url: string;
  title: string;
  first_reference_at: string;
  recommendation_count: number;
  recommendation_evidence: Reference[];
}

interface Mentions {
  candidate: Candidate;
  recommendedBy: Map<string, Reference>;
}

function decodeHtml(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
    nbsp: " ",
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, encoded: string) => {
      if (!encoded.startsWith("#")) {
        return entities[encoded.toLowerCase()] ??
          entity;
      }
      const point = encoded[1].toLowerCase() === "x"
        ? Number.parseInt(encoded.slice(2), 16)
        : Number.parseInt(encoded.slice(1), 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    },
  );
}

function plainText(html: string) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function videoLink(rawHref: string) {
  const href = decodeHtml(rawHref);
  const short =
    /^https:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([a-z0-9_-]{11})\/?(?:[?#][^\s]*)?$/i
      .exec(href);
  if (short) {
    const id = short[1];
    return {
      source: "youtube_shorts" as const,
      id,
      url: `https://www.youtube.com/shorts/${id}`,
      title: `YouTube Short ${id}`,
    };
  }

  const match =
    /^https:\/\/(?:www\.|m\.)?tiktok\.com\/@([a-z0-9_.]{1,32})\/video\/(\d{15,22})\/?(?:[?#][^\s]*)?$/i
      .exec(href);
  if (!match) return null;
  const [, handle, id] = match;
  return {
    source: "tiktok" as const,
    id,
    url: `https://www.tiktok.com/@${handle}/video/${id}`,
    title: `TikTok video by @${handle}`,
  };
}

function isRecommendation(before: string, after: string) {
  const nearby = `${before.slice(-220)} ${after.slice(0, 120)}`;
  const match = recommendation.exec(nearby);
  return match !== null &&
    !negatedRecommendation.test(nearby.slice(0, match.index)) &&
    !missingReference.test(nearby.slice(match.index + match[0].length));
}

export function findCandidates(
  comments: Comment[],
  now = Date.now(),
): Candidate[] {
  const videos = new Map<string, Mentions>();
  const sorted = comments.toSorted((a, b) =>
    a.created_at_i - b.created_at_i || a.objectID.localeCompare(b.objectID)
  );
  for (const comment of sorted) {
    if (
      !/^\d+$/.test(comment.objectID) || !comment.author ||
      !Number.isSafeInteger(comment.story_id) || comment.story_id <= 0 ||
      !Number.isSafeInteger(comment.created_at_i) ||
      comment.created_at_i <= 0 ||
      comment.created_at_i * 1000 > now ||
      typeof comment.comment_text !== "string"
    ) continue;

    const anchors = [
      ...comment.comment_text.matchAll(
        /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>.*?<\/a>/gis,
      ),
    ];
    const postedAt = new Date(comment.created_at_i * 1000).toISOString();
    for (const [index, anchor] of anchors.entries()) {
      const link = videoLink(anchor[1]);
      if (!link) continue;
      const key = `${link.source}:${link.id}`;
      let mentions = videos.get(key);
      if (!mentions) {
        mentions = {
          candidate: {
            source: link.source,
            source_video_id: link.id,
            source_url: link.url,
            title: link.title,
            first_reference_at: postedAt,
            recommendation_count: 0,
            recommendation_evidence: [],
          },
          recommendedBy: new Map(),
        };
        videos.set(key, mentions);
      }
      const author = comment.author.toLowerCase();
      if (mentions.recommendedBy.has(author)) continue;
      const previousEnd = index === 0
        ? 0
        : anchors[index - 1].index + anchors[index - 1][0].length;
      const before = plainText(
        comment.comment_text.slice(previousEnd, anchor.index),
      );
      const after = anchors[index + 1] ? "" : plainText(
        comment.comment_text.slice(anchor.index + anchor[0].length),
      );
      if (isRecommendation(before, after)) {
        mentions.recommendedBy.set(author, {
          comment_id: comment.objectID,
          thread_id: comment.story_id,
          posted_at: postedAt,
        });
      }
    }
  }

  const cutoff = new Date(now - minimumAgeSeconds * 1000).toISOString();
  return [...videos.values()]
    .filter(({ candidate, recommendedBy }) =>
      recommendedBy.size > 0 && candidate.first_reference_at <= cutoff
    )
    .map(({ candidate, recommendedBy }) => ({
      ...candidate,
      recommendation_count: recommendedBy.size,
      recommendation_evidence: [...recommendedBy.values()].slice(0, 12),
    }))
    .sort((a, b) =>
      b.recommendation_count - a.recommendation_count ||
      b.first_reference_at.localeCompare(a.first_reference_at)
    );
}

interface SearchWindow {
  query: string;
  start: number;
  end: number;
}

async function searchWindow(
  { query, start, end }: SearchWindow,
  fetcher: typeof fetch,
): Promise<Comment[]> {
  const url = new URL(searchUrl);
  url.search = new URLSearchParams({
    query,
    tags: "comment",
    numericFilters: `created_at_i>=${start},created_at_i<${end}`,
    hitsPerPage: String(pageSize),
    attributesToRetrieve: "objectID,author,story_id,created_at_i,comment_text",
    attributesToHighlight: "[]",
  }).toString();

  const comments: Comment[] = [];
  for (let page = 0; page < maxPagesPerWindow; page++) {
    url.searchParams.set("page", String(page));
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`hn_search_http_${response.status}`);
    const result = await response.json();
    if (
      !Array.isArray(result.hits) || !Number.isSafeInteger(result.nbHits) ||
      !Number.isSafeInteger(result.nbPages)
    ) throw new Error("hn_search_invalid_response");
    if (result.nbHits > pageSize * maxPagesPerWindow) {
      throw new Error("hn_search_result_limit");
    }
    comments.push(...result.hits);
    if (page + 1 >= result.nbPages) return comments;
  }
  throw new Error("hn_search_result_limit");
}

const searchSources = {
  tiktok: { query: "tiktok.com", firstYear: 2018, monthsPerWindow: 12 },
  youtube_shorts: {
    query: "youtube.com/shorts",
    firstYear: 2020,
    monthsPerWindow: 6,
  },
} satisfies Record<
  VideoSource,
  { query: string; firstYear: number; monthsPerWindow: number }
>;

export async function searchHackerNews(
  now: number,
  source: VideoSource,
  fetcher = fetch,
): Promise<Comment[]> {
  const { query, firstYear, monthsPerWindow } = searchSources[source];
  const windows: SearchWindow[] = [];
  for (
    let month = 0;
    Date.UTC(firstYear, month, 1) <= now;
    month += monthsPerWindow
  ) {
    windows.push({
      query,
      start: Date.UTC(firstYear, month, 1) / 1000,
      end: Date.UTC(firstYear, month + monthsPerWindow, 1) / 1000,
    });
  }

  const comments: Comment[] = [];
  for (let i = 0; i < windows.length; i += 4) {
    const batch = await Promise.all(
      windows.slice(i, i + 4).map((window) => searchWindow(window, fetcher)),
    );
    for (const window of batch) comments.push(...window);
  }
  return comments;
}
