// The links of an image of the media CDN that open (look appearance show, look themes show). The API gives an image
// (ThemeImage, Image, G-10) as the folder of its variants and their widths: the file is `<url>/<width>.webp`; the
// folder alone answers 403 (as the web, frontends/react src/mediaVariants.ts). The variants are public and do not
// expire: expiresAt null. --signed-links asks for time-limited links: the API has no operation for them yet.

export type MediaLink = { variant: 'day' | 'night'; width: number | null; url: string; expiresAt: string | null };
/** An image as served: the folder of its variants (day, night) and their widths. */
export type VariantImage = { url?: string | null; urlNight?: string | null; widths?: readonly number[] | null; widthsNight?: readonly number[] | null };
export type SignedLinks = { available: false; reason: string };

/** The width shown by default: the variant the apps draw on a phone. */
export const SHOWN_WIDTH = 1080;

/** The file of [url] at [width]. */
export const variantUrl = (url: string, width: number) => `${url.replace(/\/+$/, '')}/${width}.webp`;

/**
 * The links of one variant: the smallest width at least SHOWN_WIDTH (else the largest), then the largest when it
 * differs. Without widths, the URL is a file already (a screenshot, a poster): itself.
 */
export function openableLinks(url: string | null | undefined, widths: readonly number[] | null | undefined, variant: MediaLink['variant'] = 'day'): MediaLink[] {
  if (!url) return [];
  const sorted = [...new Set(widths ?? [])].filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  if (!sorted.length) return [{ variant, width: null, url, expiresAt: null }];
  const largest = sorted[sorted.length - 1];
  const shown = sorted.find((w) => w >= SHOWN_WIDTH) ?? largest;
  return [...new Set([shown, largest])].map((width) => ({ variant, width, url: variantUrl(url, width), expiresAt: null }));
}

/** The links of an image, day then night (a night URL equal to the day one is not repeated). */
export function imageLinks(image: VariantImage | null | undefined): MediaLink[] {
  if (!image) return [];
  const night = image.urlNight && image.urlNight !== image.url ? openableLinks(image.urlNight, image.widthsNight, 'night') : [];
  return [...openableLinks(image.url, image.widths, 'day'), ...night];
}

/** The answer to --signed-links: no operation of the API signs a link to a media. */
export const SIGNED_LINKS: SignedLinks = {
  available: false,
  reason: 'The API has no operation that gives a time-limited link to a media; the links shown are public and do not expire.',
};

/** The links in text, one per line: "<url>", then "largest <url>"; the night ones prefixed "night". */
export function linkLines(links: readonly MediaLink[]): string[] {
  return links.map((l) => {
    const same = links.filter((x) => x.variant === l.variant);
    const largest = same.length > 1 && same.indexOf(l) === same.length - 1;
    return `${l.variant === 'night' ? 'night ' : ''}${largest ? 'largest ' : ''}${l.url}${l.expiresAt ? `  until ${l.expiresAt}` : ''}`;
  });
}

/** The help of --signed-links. */
export const SIGNED_LINKS_HELP = 'Time-limited links to the images (not offered by the API yet: says so)';

/** The text of --signed-links. */
export const signedLinksLine = (s: SignedLinks) => `signed links: not available. ${s.reason}`;
