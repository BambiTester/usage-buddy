// Claude as a small pixel creature. It ages with the 7-day window (a beard that
// grows, greying brows and hair), tires with the 5-hour window (drooping
// eyelids, faster breathing, puffs of breath, a sweat drop), carries a backpack
// that grows with the cache, and cools as the cache heads for cold: bluer and
// shivering, then frozen. A request that breaks a cold cache plays a thaw: the
// ice cracks, bursts with heat and Claude is warm again.
// age, tired and pack run 0..10 (one step per 10%); chill runs 0..4.

export type Look = { age: number; tired: number; pack: number; chill: number; thaw: boolean }

const SKIN = '#d97757'
const ICY = '#7fb6d9'
const EYE = '#1c1a16'
const BEARD = '#ece7dd'
const GREY = '#bdb6a8'
const PUFF = '#e8e2d2'
const SWEAT = '#9fd0e6'
const FROST = '#eef8ff'
const PACK = '#8a5a35'
const STRAP = '#5e3a20'
const HEAT = '#ffb347'

/** Room on the left for the backpack. */
const OX = 4.5
export const CLAWD_H = 34
const U = CLAWD_H / 11
export const CLAWD_W = Math.round(U * (OX + 16))

const n = (v: number) => (v * U).toFixed(2)
const x_ = (v: number) => n(v + OX)
const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
  `<rect x="${x_(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${extra}/>`

/** Skin per cold stage: warm orange, paling, lilac, blue, ice blue (no muddy grey in between). */
const CHILL_SKIN = [SKIN, '#e0957a', '#b89ccc', '#8fb2e0', ICY]

/** The figure's parts in one skin: what stands still and what breathes. */
const figure = (skin: string, look: Look) => {
  let legs = ''
  for (const x of [2, 4, 7, 9]) legs += rect(x, 8, 1, 1.6, skin)

  let body = ''

  // The backpack, behind the body: bigger with every 10% of the context cached.
  if (look.pack >= 1) {
    const w = 1 + look.pack * 0.3
    const h = 2.4 + look.pack * 0.32
    const x = 1.3 - w
    const y = 2.4
    body +=
      rect(x, y, w, h, PACK) +
      rect(x, y, w, 0.6, STRAP) +
      rect(x + w * 0.25, y + h * 0.5, w * 0.5, 0.35, STRAP)
  }

  body += rect(1, 2, 10, 6, skin) + rect(0, 4, 1, 2, skin) + rect(11, 4, 1, 2, skin)
  if (look.pack >= 1) body += rect(1.4, 2, 0.45, 4.6, STRAP)

  // Eyes, with lids that close further as the 5-hour window fills.
  const lid = Math.min(0.85, look.tired * 0.085) * 1.5
  for (const x of [3, 8]) {
    body += rect(x, 3.4, 1, 1.5, EYE)
    if (lid > 0) body += rect(x - 0.1, 3.4, 1.2, lid, skin)
  }

  // Age: greying brows from 40%, a grey crown from 70%.
  if (look.age >= 4) body += rect(2.7, 2.6, 1.6, 0.45, GREY) + rect(7.7, 2.6, 1.6, 0.45, GREY)
  if (look.age >= 7) body += rect(1, 2, 10, 0.25 + (look.age - 7) * 0.12, GREY)

  // Tired: an open, panting mouth from 40%.
  if (look.tired >= 4) body += rect(5.3, 5.5, 1.4, 0.35 + look.tired * 0.03, EYE)

  // A moustache, then a beard from the chin: longer with every 10% of the week used.
  if (look.age >= 1) {
    body += rect(4.3, 6.15, 1.5, 0.4, BEARD) + rect(6.2, 6.15, 1.5, 0.4, BEARD)
    const top = 6.9
    const len = 0.3 + look.age * 0.38
    const w = 2.2 + look.age * 0.12
    body +=
      `<path d="M${x_(6 - w / 2)} ${n(top)}H${x_(6 + w / 2)}L${x_(6 + w * 0.3)} ${n(top + len * 0.8)}` +
      `L${x_(6)} ${n(top + len)}L${x_(6 - w * 0.3)} ${n(top + len * 0.8)}Z" fill="${BEARD}"/>`
  }

  // Frost on the head from the third cold stage; icicles once frozen.
  if (look.chill >= 3) {
    for (let x = 1.4; x < 10.6; x += 1.6) body += rect(x, 1.75, 0.8, 0.4, FROST, ' opacity=".85"')
  }
  if (look.chill >= 4) {
    for (const x of [0.2, 11.2]) body += `<path d="M${x_(x)} ${n(6)}h${n(0.6)}l${n(-0.3)} ${n(1.1)}z" fill="${FROST}"/>`
  }

  return { legs, body }
}

const breatheAnim = (look: Look) => {
  const dur = (3.2 - look.tired * 0.22).toFixed(2)
  const lift = n(0.12 + look.tired * 0.05)
  return (
    `<animateTransform attributeName="transform" type="translate" values="0 0;0 -${lift};0 0" ` +
    `dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/>`
  )
}

/** Puffs of breath on each exhale: more and bigger as the 5-hour window fills, and always once cold. */
const puffs = (look: Look) => {
  const level = Math.max(look.tired, look.chill >= 3 ? 4 : 0)
  if (level === 0) return ''
  const period = 3.2 - look.tired * 0.22
  const dur = `${period.toFixed(2)}s`
  const count = Math.min(3, Math.ceil(level / 3.5))
  const r0 = 0.3 + level * 0.035
  let s = ''
  for (let i = 0; i < count; i++) {
    const begin = `${((i * period) / 3).toFixed(2)}s`
    const anim = (attr: string, values: string, extra = '') =>
      `<animate attributeName="${attr}" values="${values}" dur="${dur}" begin="${begin}" repeatCount="indefinite"${extra}/>`
    s +=
      `<circle cx="${x_(12)}" cy="${n(4.6)}" r="${n(r0)}" fill="${PUFF}" opacity="0">` +
      anim('cx', `${x_(12)};${x_(15.2)}`) +
      anim('cy', `${n(4.6)};${n(3.4)}`) +
      anim('r', `${n(r0)};${n(r0 * 2.2)}`) +
      anim('opacity', '0;.85;0', ' keyTimes="0;0.2;1"') +
      `</circle>`
  }
  return s
}

/** A side-to-side shiver from the second cold stage, harder as it cools. */
const shiver = (chill: number) => {
  if (chill < 2) return ''
  const a = n([0, 0, 0.12, 0.25, 0.4][chill] ?? 0.4)
  return `<animateTransform attributeName="transform" type="translate" values="0 0;-${a} 0;${a} 0;0 0" dur="0.18s" repeatCount="indefinite"/>`
}

const sweat = (look: Look) =>
  look.tired >= 8
    ? `<path d="M${x_(10.3)} ${n(0.6)}q${n(0.55)} ${n(0.8)} 0 ${n(1.3)}q${n(-0.55)} ${n(-0.5)} 0 ${n(-1.3)}z" fill="${SWEAT}">` +
      `<animate attributeName="opacity" values="1;.4;1" dur="1.6s" repeatCount="indefinite"/></path>`
    : ''

/** Plays once: frozen in ice, it shakes, cracks, bursts with heat and steam, then stands warm. */
const thawOverlay = (look: Look) => {
  const frozen = figure(ICY, { ...look, chill: 4 })
  const once = 'fill="freeze"'
  let s = `<g opacity="1"><animate attributeName="opacity" values="1;1;0" keyTimes="0;0.55;0.75" dur="3s" ${once}/>`
  s += `<g><animateTransform attributeName="transform" type="translate" values="0 0;-${n(0.35)} 0;${n(0.35)} 0;0 0" dur="0.12s" begin="0.9s" repeatCount="6"/>`
  s += frozen.legs + frozen.body
  s += `<rect x="${x_(-0.6)}" y="${n(1)}" width="${n(13.2)}" height="${n(9.4)}" rx="${n(1)}" fill="${ICY}" fill-opacity=".45" stroke="${FROST}" stroke-width="${n(0.25)}"/>`
  s +=
    `<path d="M${x_(5.5)} ${n(1)}l${n(-1)} ${n(2.5)}l${n(1.6)} ${n(1.2)}l${n(-1.4)} ${n(2.6)}M${x_(5.1)} ${n(3.5)}l${n(-2.5)} ${n(0.9)}M${x_(5.7)} ${n(4.7)}l${n(3)} ${n(-0.6)}" ` +
    `stroke="#ffffff" stroke-width="${n(0.22)}" fill="none" opacity="0"><animate attributeName="opacity" values="0;1" begin="0.8s" dur="0.1s" ${once}/></path>`
  s += `</g></g>`

  // Heat flash and flying shards as the ice breaks.
  s +=
    `<circle cx="${x_(6)}" cy="${n(5)}" r="0" fill="${HEAT}" opacity="0">` +
    `<animate attributeName="r" values="0;${n(9)}" begin="1.6s" dur="0.7s" ${once}/>` +
    `<animate attributeName="opacity" values="0;.85;0" begin="1.6s" dur="0.7s" ${once}/></circle>`
  for (const [dx, dy] of [[-3, -2], [3, -2.5], [-3.5, 1.5], [3.5, 1.2]] as const) {
    s +=
      `<rect x="${x_(5.6)}" y="${n(4.6)}" width="${n(0.8)}" height="${n(0.8)}" fill="${FROST}" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="0 0;${n(dx)} ${n(dy)}" begin="1.6s" dur="0.6s" ${once}/>` +
      `<animate attributeName="opacity" values="1;0" begin="1.6s" dur="0.6s" ${once}/></rect>`
  }
  // Steam rising off the warm body.
  for (let i = 0; i < 3; i++) {
    const begin = `${(1.7 + i * 0.12).toFixed(2)}s`
    s +=
      `<circle cx="${x_(3 + i * 3)}" cy="${n(2)}" r="${n(0.5)}" fill="${PUFF}" opacity="0">` +
      `<animate attributeName="cy" values="${n(2)};${n(0)}" begin="${begin}" dur="1s" ${once}/>` +
      `<animate attributeName="opacity" values="0;.8;0" begin="${begin}" dur="1s" ${once}/></circle>`
  }
  return s
}

export const clawdSvg = (look: Look): string => {
  // A thaw ends warm: the figure under the ice is drawn at chill 0.
  const base: Look = look.thaw ? { ...look, chill: 0 } : look
  const skin = CHILL_SKIN[base.chill] ?? ICY
  const { legs, body } = figure(skin, base)

  const live =
    `<g>${shiver(base.chill)}<g shape-rendering="crispEdges">${legs}<g>${breatheAnim(base)}${body}</g></g>` +
    `${sweat(base)}${puffs(base)}</g>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CLAWD_W}" height="${CLAWD_H}" viewBox="0 0 ${CLAWD_W} ${CLAWD_H}">` +
    live +
    (look.thaw ? `<g shape-rendering="crispEdges">${thawOverlay(look)}</g>` : '') +
    `</svg>`
  )
}
