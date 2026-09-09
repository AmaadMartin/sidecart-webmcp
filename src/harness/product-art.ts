/**
 * Product illustrations for the stand-in storefront.
 *
 * Keyed by product handle, not by collection. Keying by collection meant two
 * jackets shared one drawing and two knits shared another, so four of the nine
 * cards were literally the same picture — which reads as a template rather
 * than a catalog the moment anyone looks along a row.
 *
 * Real storefronts give roughly three quarters of a product card to the
 * picture. These are drawn on a 4:5 canvas to fill that space without the line
 * work disappearing at projector distance.
 */

const INK = '#4a5361';
const SOFT = '#98a2b0';

/** A warm neutral behind each drawing, varied enough to read as different. */
/**
 * One tile tone for the whole grid.
 *
 * An earlier version tinted each product differently. Every reference store
 * uses a single tone across the collection, and eight competing pastels both
 * read as a swatch gallery and spent the chroma that should belong to the
 * assistant panel.
 */
const WASH = '#ece6dc';

/** One drawing per product. Viewbox is 0 0 200 250. */
const SHAPES: Record<string, string> = {
  // A hooded shell: hood, centre zip, hem drawcord.
  'trailhead-rain-shell': `
    <path d="M100 52 q-20 0-26 16 l-30 14 -12 62 22 8 4 66 h84 l4-66 22-8 -12-62 -30-14 q-6-16-26-16Z"
      fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M74 68 q26 22 52 0" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M100 74 V218" stroke="${SOFT}" stroke-width="3"/>
    <path d="M58 196 h84" stroke="${SOFT}" stroke-width="3"/>`,

  // A down jacket: horizontal baffles, collar, no hood.
  'cirrus-down-jacket': `
    <path d="M100 54 l-32 12 -22 16 8 56 16-4 4 84h52l4-84 16 4 8-56 -22-16Z"
      fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M78 60 q22 16 44 0" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M72 104 h56 M70 130 h60 M70 156 h60 M72 182 h56"
      stroke="${SOFT}" stroke-width="3"/>
    <path d="M100 84 V218" stroke="${INK}" stroke-width="3"/>`,

  // An alpine pack: lid, compression strap, haul loop.
  'summit-45-pack': `
    <rect x="60" y="76" width="80" height="132" rx="18"
      fill="#fff" stroke="${INK}" stroke-width="4"/>
    <path d="M60 106 q40 16 80 0" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M80 76 V62 a20 20 0 0 1 40 0 v14" fill="none"
      stroke="${INK}" stroke-width="4"/>
    <rect x="76" y="132" width="48" height="34" rx="8" fill="none"
      stroke="${SOFT}" stroke-width="3"/>
    <path d="M64 186 h72" stroke="${SOFT}" stroke-width="3"/>`,

  // A long sleeve crew: set-in sleeves, ribbed collar.
  'merino-base-layer': `
    <path d="M100 62 l-30 10 -30 20 16 30 16-8 v98 h56 v-98 l16 8 16-30 -30-20Z"
      fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M80 66 q20 16 40 0" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M72 200 h56" stroke="${SOFT}" stroke-width="3"/>`,

  // A trail shoe in profile: lugged outsole, laces.
  'granite-trail-runner': `
    <path d="M40 176 q6-42 34-42 q16 0 22 16 q14 20 44 26 q22 6 22 22 v12 H42Z"
      fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M40 194 h122" stroke="${INK}" stroke-width="4"/>
    <path d="M48 206 h8 m10 0 h8 m10 0 h8 m10 0 h8 m10 0 h8 m10 0 h8"
      stroke="${SOFT}" stroke-width="4"/>
    <path d="M76 146 l14 12 M88 138 l14 13 M100 132 l14 14"
      stroke="${SOFT}" stroke-width="3"/>`,

  // A crew sock: cuff ribbing, heel.
  'ridge-wool-sock': `
    <path d="M84 62 h34 v78 q0 14 12 24 l22 18 q12 10 4 22 -8 12-22 6 l-46-22
      q-20-10-20-32Z" fill="#fff" stroke="${INK}" stroke-width="4"
      stroke-linejoin="round"/>
    <path d="M84 76 h34 M84 90 h34" stroke="${SOFT}" stroke-width="3"/>
    <path d="M74 158 q22 14 44 20" fill="none" stroke="${SOFT}" stroke-width="3"/>`,

  // An insulated flask: lid, body seam.
  'basecamp-flask': `
    <rect x="76" y="80" width="48" height="128" rx="14"
      fill="#fff" stroke="${INK}" stroke-width="4"/>
    <rect x="84" y="58" width="32" height="24" rx="7"
      fill="#fff" stroke="${INK}" stroke-width="4"/>
    <path d="M76 118 h48" stroke="${SOFT}" stroke-width="3"/>
    <path d="M90 140 v44" stroke="${SOFT}" stroke-width="3"/>`,

  // A service rather than a thing: a shield with a check.
  'extended-care-plan': `
    <path d="M100 56 l46 20 v44 q0 46-46 68 -46-22-46-68 V76Z"
      fill="#fff" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M80 132 l14 15 26-32" fill="none" stroke="${INK}"
      stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,

  // A liner glove: four fingers and a thumb.
  'alpine-glove-liner': `
    <path d="M76 128 V88 a9 9 0 0 1 18 0 v34 m0 0 V78 a9 9 0 0 1 18 0 v44 m0 0
      V86 a9 9 0 0 1 18 0 v42 m0 0 V102 a9 9 0 0 1 18 0 v58 q0 44-38 44
      -22 0-32-18 l-22-38 a10 10 0 0 1 17-10 l11 18"
      fill="#fff" stroke="${INK}" stroke-width="4"
      stroke-linecap="round" stroke-linejoin="round"/>`,
};

/** Returns an inline SVG for a product, by handle. */
export function productArt(handle: string): string {
  const shape = SHAPES[handle];
  if (!shape) {
    // A product with no drawing gets an empty tile, never someone else's.
    return `<svg viewBox="0 0 200 200" role="img" aria-hidden="true">
              <rect width="200" height="200" fill="${WASH}"/>
            </svg>`;
  }
  // A square viewBox, because the tile is square. A 4:5 box inside it was
  // letterboxed, which put a white margin down the left of every card while
  // the text below sat flush, and made the grid look misaligned.
  return `<svg viewBox="0 0 200 200" role="img" aria-hidden="true"
               preserveAspectRatio="xMidYMid meet">
            <rect width="200" height="200" fill="${WASH}"/>
            <g transform="translate(100 100) scale(0.84) translate(-100 -125)">
              ${shape}
            </g>
          </svg>`;
}
