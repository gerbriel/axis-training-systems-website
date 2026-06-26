import { useState, useCallback, useRef, useEffect, Fragment } from 'react'
import { href } from '../utils/nav'

export interface CompareScore {
  myDots: number; myTotal: number; myBw: number
  mySquat: number; myBench: number; myDead: number
  sex: string; wt: string; fed: string; equip: string
  ageClass: string; year: string
}
export interface RankingsProps { embedded?: boolean; compare?: CompareScore }

const BASE = (import.meta as any).env?.BASE_URL ?? '/'
const opl = (path: string) =>
  `https://corsproxy.io/?${encodeURIComponent(`https://www.openpowerlifting.org${path}`)}`

// ── Filter option lists ────────────────────────────────────────────────────
const FEDERATIONS = [
  { value: '', label: 'All Federations' },
  { value: 'USAPL', label: 'USAPL' }, { value: 'USPA', label: 'USPA' },
  { value: 'IPF', label: 'IPF' }, { value: 'CPU', label: 'CPU' },
  { value: 'APU', label: 'APU' }, { value: 'WRPF', label: 'WRPF' },
  { value: 'APA', label: 'APA' }, { value: 'NASA', label: 'NASA' },
  { value: 'SPF', label: 'SPF' }, { value: 'RPS', label: 'RPS' },
  { value: 'CAPO', label: 'CAPO' }, { value: 'GPC', label: 'GPC' },
  { value: 'IPL', label: 'IPL' }, { value: 'WUAP', label: 'WUAP' },
  { value: 'BVDK', label: 'BVDK' },
]
const SEX_OPTIONS = [
  { value: '', label: 'All' }, { value: 'M', label: 'Men' },
  { value: 'F', label: 'Women' }, { value: 'Mx', label: 'Mx' },
]
const EQUIPMENT = [
  { value: '', label: 'All Equipment' }, { value: 'raw', label: 'Raw' },
  { value: 'wraps', label: 'Wraps' }, { value: 'single-ply', label: 'Single-ply' },
  { value: 'multi-ply', label: 'Multi-ply' }, { value: 'unlimited', label: 'Unlimited' },
  { value: 'straps', label: 'Straps' },
]
const WEIGHT_CLASSES = [
  { value: '', label: 'All Weight Classes' },
  { value: '59', label: '59 kg (130 lbs)' }, { value: '66', label: '66 kg (145.5 lbs)' },
  { value: '74', label: '74 kg (163 lbs)' }, { value: '83', label: '83 kg (183 lbs)' },
  { value: '93', label: '93 kg (205 lbs)' }, { value: '105', label: '105 kg (231.5 lbs)' },
  { value: '120', label: '120 kg (264.5 lbs)' }, { value: '120+', label: '120+ kg (SHW)' },
  { value: '47', label: '47 kg (103.5 lbs)' }, { value: '52', label: '52 kg (114.5 lbs)' },
  { value: '57', label: '57 kg (125.5 lbs)' }, { value: '63', label: '63 kg (139 lbs)' },
  { value: '69', label: '69 kg (152 lbs)' }, { value: '76', label: '76 kg (167.5 lbs)' },
  { value: '84', label: '84 kg (185 lbs)' }, { value: '84+', label: '84+ kg (SHW Women)' },
  { value: '56', label: '56 kg (legacy)' }, { value: '60', label: '60 kg (legacy)' },
  { value: '67.5', label: '67.5 kg (legacy)' }, { value: '75', label: '75 kg (legacy)' },
  { value: '82.5', label: '82.5 kg (legacy)' }, { value: '90', label: '90 kg (legacy)' },
  { value: '100', label: '100 kg (legacy)' }, { value: '110', label: '110 kg (legacy)' },
  { value: '125', label: '125 kg (legacy)' }, { value: '140', label: '140 kg (legacy)' },
  { value: '140+', label: '140+ kg (legacy SHW)' },
]
const AGE_CLASSES = [
  { value: '', label: 'All Age Classes' },
  { value: '5-12', label: 'Youth (5-12)' }, { value: '13-15', label: 'Sub-Juniors (13-15)' },
  { value: '16-17', label: 'Teens 16-17' }, { value: '18-19', label: 'Juniors 18-19' },
  { value: '20-23', label: 'Juniors 20-23' }, { value: '24-34', label: 'Open (24-34)' },
  { value: '35-39', label: 'Masters 1 (35-39)' }, { value: '40-44', label: 'Masters 1 (40-44)' },
  { value: '45-49', label: 'Masters 2 (45-49)' }, { value: '50-54', label: 'Masters 2 (50-54)' },
  { value: '55-59', label: 'Masters 3 (55-59)' }, { value: '60-64', label: 'Masters 4 (60-64)' },
  { value: '65-69', label: 'Masters 4 (65-69)' }, { value: '70-999', label: 'Masters 4 (70+)' },
]
const YEARS = [
  { value: '', label: 'All Years' },
  ...Array.from({ length: 27 }, (_, i) => {
    const y = String(2026 - i)
    return { value: y, label: y }
  }),
]

// ── Types ─────────────────────────────────────────────────────────────────
interface RankRow {
  name: string; slug: string; federation: string; date: string; country: string
  division: string; weightClassKg: string; bodyweightKg: string
  equipment: string; best3SquatKg: string; best3BenchKg: string
  best3DeadliftKg: string; totalKg: string; place: string
  dots: string; wilks: string; age: string; sex: string; meetName: string
}

// Richer row type from the /api/liftercsv/{slug} endpoint
interface HistRow {
  name: string; sex: string; event: string; equipment: string
  age: string; ageClass: string; division: string
  bodyweightKg: string; weightClassKg: string
  squat1Kg: string; squat2Kg: string; squat3Kg: string; best3SquatKg: string
  bench1Kg: string; bench2Kg: string; bench3Kg: string; best3BenchKg: string
  deadlift1Kg: string; deadlift2Kg: string; deadlift3Kg: string; best3DeadliftKg: string
  totalKg: string; place: string; dots: string; wilks: string
  glossbrenner: string; goodlift: string; tested: string
  country: string; federation: string; date: string
  meetName: string; meetTown: string; meetCountry: string
  slug: string
}

// ── Helpers ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const BASE_PARAMS = { lang: 'en', units: 'kg' } as const

// Session caches — survive filter changes within one page load
// KEY: "name.toLowerCase()|filterSuffix" (e.g. "john haack|/usapl/raw/men")
const NAME_CACHE = new Map<string, RankRow[]>()
// KEY: lifter slug
const HIST_CACHE = new Map<string, HistRow[]>()

async function oplFetch(url: string, signal?: AbortSignal): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, signal ? { signal } : undefined)
    if (res.status === 429) {
      if (attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
      throw new Error('Rate limited (429). Wait a few seconds, then search again.')
    }
    if (!res.ok) throw new Error('OpenPowerlifting API returned ' + res.status + '. Try adjusting your filters.')
    return res.json()
  }
}

async function oplFetchText(url: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, signal ? { signal } : undefined)
    if (res.status === 429) {
      if (attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
      throw new Error('Rate limited.')
    }
    if (!res.ok) throw new Error('History endpoint returned ' + res.status)
    return res.text()
  }
  return ''
}

// OPL browse endpoint returns null for weightClassKg (col 18) in all-federation
// queries. Infer weight class from actual body weight (col 17) + sex instead.
function inferWeightClass(bwKg: string, sex: string): string {
  const bw = parseFloat(bwKg)
  if (!bw) return ''
  if (sex === 'M' || sex.toLowerCase() === 'male') {
    if (bw <= 59)  return '59'
    if (bw <= 66)  return '66'
    if (bw <= 74)  return '74'
    if (bw <= 83)  return '83'
    if (bw <= 93)  return '93'
    if (bw <= 105) return '105'
    if (bw <= 120) return '120'
    return '120+'
  }
  if (bw <= 47) return '47'
  if (bw <= 52) return '52'
  if (bw <= 57) return '57'
  if (bw <= 63) return '63'
  if (bw <= 69) return '69'
  if (bw <= 76) return '76'
  if (bw <= 84) return '84'
  return '84+'
}

const toNum = (v: string | undefined) => parseFloat(v || '0') || 0
const fmt = (v: string | undefined, unit: 'lbs' | 'kg') => {
  const n = toNum(v); if (!n) return '—'
  const d = unit === 'lbs' ? n * 2.20462 : n
  return unit === 'lbs' ? String(Math.round(d)) : String(Math.round(d * 10) / 10)
}
const fmtScore = (v: string | undefined) => {
  const n = toNum(v); return n > 0 ? n.toFixed(2) : '—'
}

// OPL ranking row columns (positional):
// [0]=idx [1]=rank [2]=name [3]=slug [4]=social [5]=badge
// [6]=country [7]=state [8]=fed [9]=date [10]=meet-country [11]=state
// [12]=meet-path [13]=sex [14]=equip [15]=age [16]=division
// [17]=bw-kg [18]=wt-class-kg [19]=squat [20]=bench [21]=dead [22]=total [23]=dots
function parseRows(data: { rows?: unknown[][] }): RankRow[] {
  const rows: unknown[][] = data?.rows ?? []
  return rows.map(row => {
    const r = row as (string | number | null)[]
    const s = (i: number) => r[i] != null ? String(r[i]) : ''
    return {
      name:            s(2),
      slug:            s(3),
      federation:      s(8),
      date:            s(9),
      country:         s(6),   // lifter's nationality
      division:        s(16),
      bodyweightKg:    s(17),  // bw-kg   (col 17 = actual scale weight)
      weightClassKg:   s(18),  // wt-class-kg (col 18 = competitive class)
      equipment:       s(14),
      best3SquatKg:    s(19),
      best3BenchKg:    s(20),
      best3DeadliftKg: s(21),
      totalKg:         s(22),
      place:           '',
      dots:            s(23),
      wilks:           '',
      age:             s(15),
      sex:             s(13),
      meetName:        s(12),
    }
  })
}

// Minimal CSV parser that handles quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
    else cur += ch
  }
  result.push(cur.trim())
  return result
}

// Fetch rich lifter history from OPL's CSV endpoint
async function fetchLifterHistory(slug: string, signal?: AbortSignal): Promise<HistRow[]> {
  const cached = HIST_CACHE.get(slug)
  if (cached) return cached
  const csv = await oplFetchText(opl('/api/liftercsv/' + encodeURIComponent(slug)), signal)
  const lines = csv.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0])
  const ci = (h: string) => headers.indexOf(h)
  const rows: HistRow[] = lines.slice(1).map(line => {
    const f = parseCSVLine(line)
    const g = (h: string) => { const i = ci(h); return i >= 0 ? (f[i] ?? '') : '' }
    return {
      name: g('Name'), sex: g('Sex'), event: g('Event'),
      equipment: g('Equipment'), age: g('Age'), ageClass: g('AgeClass'),
      division: g('Division'), bodyweightKg: g('BodyweightKg'), weightClassKg: g('WeightClassKg'),
      squat1Kg: g('Squat1Kg'), squat2Kg: g('Squat2Kg'), squat3Kg: g('Squat3Kg'), best3SquatKg: g('Best3SquatKg'),
      bench1Kg: g('Bench1Kg'), bench2Kg: g('Bench2Kg'), bench3Kg: g('Bench3Kg'), best3BenchKg: g('Best3BenchKg'),
      deadlift1Kg: g('Deadlift1Kg'), deadlift2Kg: g('Deadlift2Kg'), deadlift3Kg: g('Deadlift3Kg'), best3DeadliftKg: g('Best3DeadliftKg'),
      totalKg: g('TotalKg'), place: g('Place'), dots: g('Dots'), wilks: g('Wilks'),
      glossbrenner: g('Glossbrenner'), goodlift: g('Goodlift'), tested: g('Tested'),
      country: g('Country'), federation: g('Federation'), date: g('Date'),
      meetName: g('MeetName'), meetTown: g('MeetTown'), meetCountry: g('MeetCountry'),
      slug,
    }
  })
  HIST_CACHE.set(slug, rows)
  return rows
}

// When a meet name filter is active during a name search, replace the raw meet path
// stored in row.meetName (e.g. "amp/2026-CA-02") with the real human-readable name
// (e.g. "Cayco Classic 3") by fetching each unique lifter's history CSV and matching on date.
async function enrichMeetNames(rows: RankRow[], signal?: AbortSignal): Promise<RankRow[]> {
  const slugs = [...new Set(rows.map(r => r.slug).filter(Boolean))]
  await Promise.all(slugs.map(slug =>
    HIST_CACHE.has(slug) ? Promise.resolve() : fetchLifterHistory(slug, signal).catch(() => {})
  ))
  if (signal?.aborted) return rows
  return rows.map(row => {
    const history = HIST_CACHE.get(row.slug) ?? []
    const match = history.find(h => h.date === row.date)
    return match ? { ...row, meetName: match.meetName } : row
  })
}

// Fetch all records for a given name within an optional filter context.
// Searches are sequential (each call needs the previous next_index), but row
// fetches are launched immediately without awaiting so they run in parallel.
// Cache key includes filterSuffix so different filter contexts cache separately.
async function nameSearch(name: string, filterSuffix: string, signal?: AbortSignal): Promise<RankRow[]> {
  const key = name.trim().toLowerCase() + '|' + filterSuffix
  const cached = NAME_CACHE.get(key)
  if (cached) return cached

  const fetchPromises: Promise<RankRow[]>[] = []
  let start = 0

  while (fetchPromises.length < 500) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const sq = new URLSearchParams({ q: name.trim(), start: String(start), end: '9999999' })
    let sdata: any
    // Use filter path in the search URL — OPL searches the filtered dataset instead of
    // all 600k+ entries, giving ~100x speed improvement when filters are set
    try { sdata = await oplFetch(opl('/api/search/rankings' + filterSuffix + '?' + sq), signal) }
    catch (e: any) {
      if (e?.name === 'AbortError') throw e  // re-throw so loadChunk's outer catch handles it
      break  // only break on real network errors
    }
    if (sdata?.next_index == null) break
    const idx = Number(sdata.next_index)
    start = idx + 1
    // Launch row fetch immediately without awaiting — runs in parallel with next search
    const rq = new URLSearchParams({ ...BASE_PARAMS, start: String(idx), end: String(idx) })
    fetchPromises.push(
      oplFetch(opl('/api/rankings' + filterSuffix + '?' + rq), signal)
        .then((d: any) => parseRows(d))
        .catch((): RankRow[] => [])
    )
  }

  // Don't cache partial/empty results from an aborted search
  if (signal?.aborted) return []
  const rows = (await Promise.all(fetchPromises)).flat()
  NAME_CACHE.set(key, rows)
  return rows
}

// ── Styles ────────────────────────────────────────────────────────────────
const SEL: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '.3rem',
  color: 'var(--chalk)', fontSize: '.78rem', padding: '.65rem .75rem',
  fontFamily: 'inherit', outline: 'none', cursor: 'pointer', width: '100%',
}
const TH: React.CSSProperties = {
  padding: '.6rem .8rem', textAlign: 'left', color: 'var(--text-3)',
  fontSize: '.52rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.1em', whiteSpace: 'nowrap', background: 'var(--bg)',
}
const TD: React.CSSProperties = { padding: '.65rem .8rem', fontSize: '.78rem', whiteSpace: 'nowrap' }
const LBL: React.CSSProperties = {
  color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', display: 'block', marginBottom: '.4rem',
}

const LOAD_SIZE = 100

// ── User score row (injected from DotsCalc comparison flow) ──────────────
interface UserScoreRowProps {
  myDots: number; myTotal: number; myBw: number
  mySquat: number; myBench: number; myDead: number
  unit: 'lbs' | 'kg'; myWtClass?: string
}
function UserScoreRow({ myDots, myTotal, myBw, mySquat, myBench, myDead, unit, myWtClass }: UserScoreRowProps) {
  const disp = (v: number) => {
    if (!v) return '—'
    const d = unit === 'lbs' ? Math.round(v * 2.20462) : Math.round(v * 10) / 10
    return d + (unit === 'lbs' ? ' lbs' : ' kg')
  }
  return (
    <tr data-you-row style={{ background: 'rgba(39,44,132,.1)' }}>
      <td style={{ ...TD, color: '#272C84', fontWeight: 900, fontSize: '.58rem', letterSpacing: '.1em', textTransform: 'uppercase', borderLeft: '3px solid #272C84' }}>▶ YOU</td>
      <td style={{ ...TD, color: '#272C84', fontWeight: 900 }}>Your Score</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
      <td style={{ ...TD, color: myWtClass ? 'var(--text-2)' : 'var(--text-3)' }}>{myWtClass || '—'}</td>
      <td style={{ ...TD, color: 'var(--text-2)' }}>{disp(myBw)}</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
      <td style={{ ...TD, color: mySquat > 0 ? 'var(--text-dim)' : 'var(--border)' }}>{disp(mySquat)}</td>
      <td style={{ ...TD, color: myBench > 0 ? 'var(--text-dim)' : 'var(--border)' }}>{disp(myBench)}</td>
      <td style={{ ...TD, color: myDead  > 0 ? 'var(--text-dim)' : 'var(--border)' }}>{disp(myDead)}</td>
      <td style={{ ...TD, color: '#272C84', fontWeight: 700 }}>{disp(myTotal)}</td>
      <td style={{ ...TD, color: '#272C84', fontWeight: 900 }}>{myDots.toFixed(2)}</td>
      <td style={{ ...TD, color: 'var(--text-3)' }}>—</td>
    </tr>
  )
}

// ── Component ─────────────────────────────────────────────────────────────
export default function Rankings({ embedded, compare }: RankingsProps = {}) {
  // `compare` prop (inline from DotsCalc) takes priority; URL params are fallback for standalone page
  const urlP = useRef(new URLSearchParams((embedded && compare) ? '' : window.location.search)).current
  const myDots  = compare?.myDots  ?? (parseFloat(urlP.get('myDots')  || '') || 0)
  const myTotal = compare?.myTotal ?? (parseFloat(urlP.get('myTotal') || '') || 0)
  const myBw    = compare?.myBw    ?? (parseFloat(urlP.get('myBw')    || '') || 0)
  const mySquat = compare?.mySquat ?? (parseFloat(urlP.get('mySquat') || '') || 0)
  const myBench = compare?.myBench ?? (parseFloat(urlP.get('myBench') || '') || 0)
  const myDead  = compare?.myDead  ?? (parseFloat(urlP.get('myDead')  || '') || 0)

  const [name,        setName]        = useState(urlP.get('lifter') || '')
  const [federation,  setFederation]  = useState(compare?.fed      ?? urlP.get('fed')   ?? '')
  const [sex,         setSex]         = useState(compare?.sex      ?? urlP.get('sex')   ?? '')
  const [equipment,   setEquipment]   = useState(compare?.equip    ?? urlP.get('equip') ?? '')
  const [weightClass, setWeightClass] = useState(compare?.wt ?? urlP.get('wt') ?? '')
  const [ageClass,    setAgeClass]    = useState(compare?.ageClass  ?? urlP.get('age')  ?? '')
  const [year,        setYear]        = useState(compare?.year     ?? urlP.get('year')  ?? '')
  const [country,     setCountry]     = useState('')
  const [division,    setDivision]    = useState(urlP.get('div')   || '')
  const [unit,        setUnit]        = useState<'lbs' | 'kg'>('lbs')
  const [rows,        setRows]        = useState<RankRow[]>([])
  const [totalHint,   setTotalHint]   = useState(0)
  const [hasMore,     setHasMore]     = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,       setError]       = useState('')
  const [searched,    setSearched]    = useState(false)
  const [collapsed,   setCollapsed]   = useState(!!compare)
  const [globalAbove,       setGlobalAbove]       = useState<number | null>(null)
  const [globalTotal,       setGlobalTotal]       = useState(0)
  const [globalRankLoading, setGlobalRankLoading] = useState(false)
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [histRows,    setHistRows]    = useState<HistRow[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [histError,   setHistError]   = useState('')
  const [sortKey,     setSortKey]     = useState<string>('dots')
  const [sortDir,     setSortDir]     = useState<'asc'|'desc'>('desc')
  const [globalSearch, setGlobalSearch] = useState('')  // top bar: client-side all-field + API name when name is empty
  const [meetName,    setMeetName]    = useState('')    // enriched meet name filter (via CSV during name searches)
  const [ageExact,    setAgeExact]    = useState('')    // exact competition age filter

  const abortRef        = useRef<AbortController | null>(null)
  const sentinelRef     = useRef<HTMLDivElement | null>(null)
  const serverOffsetRef = useRef(0)
  const serverTotalRef  = useRef(Infinity)
  const isLoadingRef    = useRef(false)
  const searchGenRef    = useRef(0)   // incremented each search; finally only clears if still current gen
  const handleSearchRef  = useRef<() => void>(() => {})
  const searchDebounce   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Filter suffix for the OPL API path (e.g. '/usapl/raw/men/2026')
  // Used in both the rankings browse path and the name search context path
  const buildFilterSuffix = useCallback(() => {
    const parts: string[] = []
    if (federation) parts.push(federation.toLowerCase())
    if (equipment)  parts.push(equipment)
    if (sex === 'M') parts.push('men')
    else if (sex === 'F') parts.push('women')
    if (year) parts.push(year)
    return parts.length ? '/' + parts.join('/') : ''
  }, [federation, equipment, sex, year])

  const buildPath = useCallback(() => {
    return '/api/rankings' + buildFilterSuffix()
  }, [buildFilterSuffix])

  // Client-side filters applied after fetching (weightClass, ageClass, country, division
  // are not in the server-side path). skipWt=true used for name searches so you can find
  // any lifter by name regardless of what weight class they competed in.
  const applyClientFilters = useCallback((r: RankRow[], skipWt = false) => {
    return r.filter(row => {
      if (name.trim() && !row.name.toLowerCase().includes(name.trim().toLowerCase())) return false
      if (!skipWt && weightClass) {
        const selWt = weightClass.replace(/\.0$/, '')
        // Column 18 stores federation-specific class names (OPL returns '90', '125', etc.
        // for WPC/old-IPF lifters). Always infer from actual body weight so that a
        // 87.2 kg lifter who competed at '90kg' (old IPF) is correctly grouped with
        // modern '93kg' class when the user filters by 93.
        const rowWt = inferWeightClass(row.bodyweightKg, row.sex)
        if (!rowWt || rowWt !== selWt) return false
      }
      if (ageClass) {
        const age = parseFloat(row.age)
        if (!isNaN(age)) {
          const [lo, hi] = ageClass.split('-').map(Number)
          if (age < lo || age > hi) return false
        }
      }
      if (ageExact.trim()) {
        const age = parseFloat(row.age)
        const target = parseFloat(ageExact.trim())
        if (!isNaN(age) && !isNaN(target) && Math.floor(age) !== Math.floor(target)) return false
      }
      if (country && !row.country.toLowerCase().includes(country.trim().toLowerCase())) return false
      if (division && !row.division.toLowerCase().includes(division.trim().toLowerCase())) return false
      if (meetName.trim() && !row.meetName.toLowerCase().includes(meetName.trim().toLowerCase())) return false
      if (ageExact.trim()) {
        const target = parseFloat(ageExact)
        if (!isNaN(target) && parseFloat(row.age) !== target) return false
      }
      return true
    })
  }, [name, weightClass, ageClass, country, division, meetName, ageExact])

  const loadChunk = useCallback(async (isInit: boolean) => {
    if (isLoadingRef.current) return
    isLoadingRef.current = true
    const myGen = ++searchGenRef.current  // snapshot generation; finally only resets if still ours
    if (isInit) setLoading(true); else setLoadingMore(true)
    setError('')

    const ctrl   = abortRef.current!
    const signal = ctrl.signal
    const path   = buildPath()
    const suffix = buildFilterSuffix()

    try {
      const newRows: RankRow[] = []
      // name field takes priority; globalSearch drives API only when name is empty
      const searchName = name.trim() || globalSearch.trim()

      if (searchName) {
        // Name search: use suffix WITHOUT year so the lifter is found across all years
        // (year is meaningful for browsing rankings but not for finding a specific person)
        const nameSuffix = suffix.replace(/\/\d{4}(\/|$)/, '$1').replace(/\/$/, '')
        let allRows = await nameSearch(searchName, nameSuffix, signal)
        // Meet name filter: enrich rows with real meet names from CSV (path → "Cayco Classic 3")
        if (meetName.trim()) {
          allRows = await enrichMeetNames(allRows, signal)
          if (signal.aborted) return
        }
        // Skip weight class filter for name searches — show all results for that person
        newRows.push(...applyClientFilters(allRows, true))
        if (isInit) setRows(newRows); else setRows(prev => [...prev, ...newRows])
        setHasMore(false)

      } else {
        // Browse mode
        const hasClientFilter = !!(weightClass || ageClass || country || division)

        const userDots = compare?.myDots ?? 0

        if (compare && userDots > 0 && isInit) {
          // Compare initial load: batch until the user's score appears in context.
          // This path runs REGARDLESS of client filters — filters are applied per-page so
          // ageClass="Open" or a weight-class pre-selection doesn't short-circuit loading.
          // 8 pages/batch × 25 batches = up to 20,000 server rows scanned.

          // Fire-and-forget parallel global rank fetch (no federation filter).
          // Only runs when a federation is active so "Global" differs from "Fed" rank.
          if (federation) {
            setGlobalAbove(null)
            setGlobalTotal(0)
            setGlobalRankLoading(true)
            const gParts: string[] = []
            if (equipment) gParts.push(equipment)
            if (sex === 'M') gParts.push('men'); else if (sex === 'F') gParts.push('women')
            if (year) gParts.push(year)
            const gPath = '/api/rankings' + (gParts.length ? '/' + gParts.join('/') : '')
            ;(async () => {
              let gAbove = 0
              let gOffset = 0
              const G_BATCH = 8
              const G_MAX = 30
              for (let gb = 0; gb < G_MAX; gb++) {
                if (signal.aborted) return
                const gPages = await Promise.all(
                  Array.from({ length: G_BATCH }, (_, gi) => {
                    const start = gOffset + gi * 100
                    const q = new URLSearchParams({ ...BASE_PARAMS, start: String(start), end: String(start + 99) })
                    return oplFetch(opl(gPath + '?' + q), signal)
                      .then((d: any) => {
                        if (gi === 0 && gb === 0) {
                          const gt = (d as any)?.total_length ?? 0
                          if (gt > 0) setGlobalTotal(gt)
                        }
                        return parseRows(d) as RankRow[]
                      })
                      .catch(() => [] as RankRow[])
                  })
                )
                if (signal.aborted) return
                const gRows = gPages.flat()
                if (!gRows.length) break
                const gFiltered = hasClientFilter ? applyClientFilters(gRows) : gRows
                gAbove += gFiltered.filter(r => parseFloat(r.dots || '0') > userDots).length
                gOffset += G_BATCH * 100
                setGlobalAbove(gAbove)
                if (gRows.some(r => parseFloat(r.dots || '0') < userDots)) break
              }
              if (!signal.aborted) setGlobalRankLoading(false)
            })()
          }

          const BATCH = 8
          const MAX_BATCHES = 25
          for (let b = 0; b < MAX_BATCHES; b++) {
            if (signal.aborted) return
            const bStart = serverOffsetRef.current
            if (bStart >= serverTotalRef.current) break
            const nPages = Math.min(BATCH, Math.ceil((serverTotalRef.current - bStart) / 100))
            const batchPages = await Promise.all(
              Array.from({ length: nPages }, (_, i) => {
                const start = bStart + i * 100
                if (start >= serverTotalRef.current) return Promise.resolve([] as RankRow[])
                const q = new URLSearchParams({ ...BASE_PARAMS, start: String(start), end: String(start + 99) })
                return oplFetch(opl(path + '?' + q), signal)
                  .then((d: any) => {
                    if (i === 0 && b === 0) {
                      const total = d?.total_length ?? serverTotalRef.current
                      serverTotalRef.current = total
                      setTotalHint(total)
                    }
                    const pageRows = parseRows(d)
                    return (hasClientFilter ? applyClientFilters(pageRows) : pageRows) as RankRow[]
                  })
                  .catch((e: unknown) => { throw e })
              })
            )
            if (signal.aborted) return
            for (const p of batchPages) newRows.push(...p)
            serverOffsetRef.current = bStart + nPages * 100
            // Progressive update so the user sees rows appear while batches land
            setRows([...newRows])
            // Stop once ANY loaded row is below the user's score — their position is now visible
            if (newRows.some(r => parseFloat(r.dots || '0') < userDots)) break
          }
        } else if (hasClientFilter) {
          // Standalone filter mode: 3 parallel pages — enough for browsing context.
          const PARALLEL = 3
          const start0 = serverOffsetRef.current
          const pages = await Promise.all(
            Array.from({ length: PARALLEL }, (_, i) => {
              const start = start0 + i * 100
              const q = new URLSearchParams({ ...BASE_PARAMS, start: String(start), end: String(start + 99) })
              return oplFetch(opl(path + '?' + q), signal)
                .then((d: any) => {
                  if (i === 0) {
                    const total = d?.total_length ?? serverTotalRef.current
                    serverTotalRef.current = total
                    if (isInit) setTotalHint(total)
                  }
                  return applyClientFilters(parseRows(d)) as RankRow[]
                })
                .catch((e: unknown) => { throw e })
            })
          )
          if (signal.aborted) return
          for (const page of pages) newRows.push(...page)
          serverOffsetRef.current = start0 + PARALLEL * 100
        } else {
          // No filters: sequential browse until LOAD_SIZE rows
          while (newRows.length < LOAD_SIZE && serverOffsetRef.current < serverTotalRef.current) {
            if (signal.aborted) return
            const q = new URLSearchParams({
              ...BASE_PARAMS,
              start: String(serverOffsetRef.current),
              end:   String(serverOffsetRef.current + 99),
            })
            const data = await oplFetch(opl(path + '?' + q), signal)
            const total = data?.total_length ?? serverTotalRef.current
            serverTotalRef.current = total
            if (isInit && serverOffsetRef.current === 0) setTotalHint(total)
            newRows.push(...parseRows(data))
            serverOffsetRef.current += 100
          }
        }

        if (isInit) setRows(newRows); else setRows(prev => [...prev, ...newRows])
        setHasMore(serverOffsetRef.current < serverTotalRef.current)
      }

      setSearched(true)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Failed to load rankings. Try again.')
    } finally {
      // Only reset if we're still the current search — a newer search may have already
      // incremented searchGenRef and set isLoadingRef = true again
      if (searchGenRef.current === myGen) {
        isLoadingRef.current = false
        if (isInit) setLoading(false); else setLoadingMore(false)
      }
    }
  }, [name, globalSearch, meetName, weightClass, ageClass, country, division, buildPath, buildFilterSuffix, applyClientFilters])

  const handleSearch = useCallback(() => {
    // Debounce at 80ms so rapid successive calls (e.g. multiple effects firing on
    // mount) coalesce into a single fetch instead of hammering the OPL API.
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()
      serverOffsetRef.current = 0
      serverTotalRef.current  = Infinity
      isLoadingRef.current    = false
      setRows([])
      setHasMore(false)
      setTotalHint(0)
      setExpanded(null)
      setHistRows([])
      loadChunk(true)
    }, 80)
  }, [loadChunk])

  // Keep ref current every render so effects can call latest version
  handleSearchRef.current = handleSearch

  // Live search on name — 200ms debounce
  useEffect(() => {
    if (!name.trim()) {
      handleSearchRef.current()
      return
    }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  // Global search bar — same 200ms debounce, only drives API when name is empty
  useEffect(() => {
    if (name.trim()) return  // name field has priority for API
    if (!globalSearch.trim()) {
      handleSearchRef.current()
      return
    }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSearch, name])

  // Dropdowns: fire immediately on change
  useEffect(() => {
    handleSearchRef.current()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [federation, sex, equipment, year, weightClass, ageClass])

  // Text filter fields: 200ms debounce — fire on first use, clear fires immediately if searched.
  useEffect(() => {
    if (!country) { handleSearchRef.current(); return }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country])

  useEffect(() => {
    if (!division) { handleSearchRef.current(); return }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [division])

  useEffect(() => {
    if (!meetName) { handleSearchRef.current(); return }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetName])

  useEffect(() => {
    if (!ageExact) { handleSearchRef.current(); return }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageExact])

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isLoadingRef.current) {
          loadChunk(false)
        }
      },
      { rootMargin: '600px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadChunk])

  const handleSort = (key: string) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortedRows = [...rows].sort((a, b) => {
    const n = (v: string) => parseFloat(v) || 0
    let diff = 0
    if (sortKey === 'age')               diff = n(a.age) - n(b.age)
    else if (sortKey === 'bodyweightKg') diff = n(a.bodyweightKg) - n(b.bodyweightKg)
    else diff = n((a as any)[sortKey]) - n((b as any)[sortKey])
    return sortDir === 'desc' ? -diff : diff
  })

  // displayRows: two independent client-side passes that are both instant.
  // globalSearch matches every column (broad multi-field find).
  // meetName matches the meet name column specifically (separate, additive filter).
  const displayRows = (() => {
    let result = sortedRows
    const gq = globalSearch.trim().toLowerCase()
    if (gq) {
      result = result.filter(row =>
        row.name.toLowerCase().includes(gq) ||
        row.federation.toLowerCase().includes(gq) ||
        row.country.toLowerCase().includes(gq) ||
        row.division.toLowerCase().includes(gq) ||
        row.equipment.toLowerCase().includes(gq) ||
        row.sex.toLowerCase().includes(gq) ||
        row.date.includes(gq) ||
        row.meetName.toLowerCase().includes(gq) ||
        row.weightClassKg.includes(gq) ||
        row.bodyweightKg.includes(gq) ||
        row.totalKg.includes(gq) ||
        row.dots.includes(gq) ||
        row.age.includes(gq)
      )
    }
    const mq = meetName.trim().toLowerCase()
    if (mq) result = result.filter(row => row.meetName.toLowerCase().includes(mq))
    return result
  })()

  const toggleHistory = async (row: RankRow, key: string) => {
    if (expanded === key) { setExpanded(null); setHistRows([]); return }
    setExpanded(key); setLoadingHist(true); setHistError('')
    try {
      // Try the rich CSV endpoint first; fall back to name search if it fails
      let csvRows: HistRow[] | null = null
      try { csvRows = await fetchLifterHistory(row.slug) } catch { /* fall back */ }

      if (csvRows && csvRows.length > 0) {
        setHistRows([...csvRows].sort((a, b) => b.date.localeCompare(a.date)))
      } else {
        // Fallback: use cached name search data and adapt to HistRow shape
        const allRows = await nameSearch(row.name, '', undefined)
        const nl = row.name.toLowerCase()
        setHistRows(
          allRows
            .filter(r => r.name.toLowerCase() === nl)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(r => ({
              name: r.name, sex: r.sex, event: '', equipment: r.equipment,
              age: r.age, ageClass: '', division: r.division,
              bodyweightKg: r.bodyweightKg, weightClassKg: r.weightClassKg,
              squat1Kg: '', squat2Kg: '', squat3Kg: '', best3SquatKg: r.best3SquatKg,
              bench1Kg: '', bench2Kg: '', bench3Kg: '', best3BenchKg: r.best3BenchKg,
              deadlift1Kg: '', deadlift2Kg: '', deadlift3Kg: '', best3DeadliftKg: r.best3DeadliftKg,
              totalKg: r.totalKg, place: '', dots: r.dots, wilks: '', glossbrenner: '', goodlift: '',
              tested: '', country: r.country, federation: r.federation, date: r.date,
              meetName: r.meetName, meetTown: '', meetCountry: '', slug: r.slug,
            }))
        )
      }
    } catch { setHistError('Could not load competition history.') }
    finally { setLoadingHist(false) }
  }

  // Comparison rank context — updated as rows load
  const cmpAbove    = compare ? rows.filter(r => parseFloat(r.dots || '0') > myDots) : []
  const cmpBelow    = compare ? rows.filter(r => parseFloat(r.dots || '0') < myDots) : []
  const cmpRank     = cmpAbove.length + 1
  const cmpPeerAbove = cmpAbove.length > 0 ? cmpAbove[cmpAbove.length - 1] : null
  const cmpPeerBelow = cmpBelow.length > 0 ? cmpBelow[0] : null
  const cmpPctTop   = totalHint > 0 ? Math.min(cmpRank / totalHint * 100, 100) : 0
  const cmpEquipLabel = equipment === 'raw' ? 'Raw' : equipment === 'single-ply' ? 'Single-ply' : equipment === 'multi-ply' ? 'Multi-ply' : equipment === 'wraps' ? 'Wraps' : equipment === 'unlimited' ? 'Unlimited' : equipment || ''
  const cmpCtx      = [
    federation ? federation.toUpperCase() : '',
    cmpEquipLabel,
    sex === 'M' ? 'Men' : sex === 'F' ? 'Women' : '',
    year || '',
  ].filter(Boolean).join(' · ')
  // Fed rank label: "[USPA] Rank" when fed is set, "Global Rank" otherwise
  const cmpFedLabel = federation ? federation.toUpperCase() + ' Rank' : 'Global Rank'
  // National rank: derived from loaded rows — count above-user rows by the most common
  // country in the data (for USPA this resolves to USA automatically, IPF to whatever dominates)
  const cmpCountryFreq = rows.reduce((acc, r) => {
    if (r.country) acc[r.country] = (acc[r.country] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const cmpTopCountry = Object.entries(cmpCountryFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  const cmpNatRank    = cmpTopCountry ? cmpAbove.filter(r => r.country === cmpTopCountry).length + 1 : 0
  // Global rank: only meaningful when a federation filter is active (otherwise cmpRank IS the global rank)
  const cmpGlobalRank = (compare && federation) ? (globalAbove !== null ? globalAbove + 1 : null) : null

  return (
    <div style={{ minHeight: embedded ? undefined : '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit' }}>

      {/* Mini nav — hidden when embedded inside Tools */}
      {!embedded && (
        <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--nav-overlay)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border)', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
          <a href={href('/')}><img src={BASE + 'logo.svg'} alt="Axis" style={{ height: 22, filter: 'var(--logo-filter)' }}/></a>
          <span style={{ color: 'var(--text-3)' }}>›</span>
          <span style={{ color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Rankings</span>
        </nav>
      )}

      <div style={{ maxWidth: embedded ? '100%' : 1200, margin: '0 auto', padding: embedded ? '1.5rem 0 3rem' : '3.5rem 1.5rem 6rem' }}>

        {/* Header — hidden when embedded */}
        {!embedded && (
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{ color: 'var(--text)', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Powered by OpenPowerlifting</p>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05, marginBottom: '.75rem' }}>Powerlifting Rankings</h1>
          <p style={{ color: 'var(--text-2)', fontSize: '.875rem', maxWidth: 560, lineHeight: 1.7 }}>Browse ranked results from 3M+ competition entries worldwide. All filters update results live — just type or select.</p>
        </div>
        )}

        {/* ── Comparison mode UI ────────────────────────────────────── */}
        {compare && myDots > 0 && (collapsed ? (

          /* ── Collapsed: full stat card ─────────────────────────── */
          <div style={{ background: 'var(--surface)', border: '1px solid rgba(39,44,132,.4)', borderRadius: '.5rem', padding: '1.5rem', marginBottom: '1.5rem' }}>

            {/* Card header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <span style={{ color: '#272C84', fontSize: '.58rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase' }}>▶ Comparison Results</span>
              <button onClick={() => setCollapsed(false)} style={{
                background: 'transparent', border: '1px solid rgba(39,44,132,.4)', borderRadius: '.25rem',
                color: '#272C84', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em',
                textTransform: 'uppercase', padding: '.4rem .9rem', cursor: 'pointer', fontFamily: 'inherit',
              }}>Expand Table ↓</button>
            </div>

            {loading && rows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.1em' }}>
                Finding your rank…
              </div>
            ) : (
              <>
                {/* Key stats: fed rank · nation rank · global rank (when fed set) · dots · percentile */}
                {(() => {
                  const hasGlobal = !!federation && (cmpGlobalRank !== null || globalRankLoading)
                  const cols = hasGlobal ? 3 : 2
                  const statItems: { value: string; label: string; color: string; sub?: string }[] = [
                    { value: `#${cmpRank.toLocaleString()}`, label: cmpFedLabel, color: '#272C84', sub: totalHint > 0 ? `of ${totalHint.toLocaleString()} lifters` : undefined },
                    { value: cmpNatRank > 0 ? `#${cmpNatRank.toLocaleString()}` : (loading ? '…' : '—'), label: cmpTopCountry ? cmpTopCountry + ' Rank' : 'Nation Rank', color: '#272C84', sub: cmpTopCountry || undefined },
                    ...(hasGlobal ? [{ value: cmpGlobalRank !== null ? `#${cmpGlobalRank.toLocaleString()}` : '…', label: 'Global Rank', color: '#272C84', sub: globalTotal > 0 ? `of ${globalTotal.toLocaleString()} · all feds` : 'all federations' }] : []),
                    { value: myDots.toFixed(2), label: 'Dots Score', color: 'var(--text)' },
                    { value: `Top ${cmpPctTop < 1 ? cmpPctTop.toFixed(2) : cmpPctTop.toFixed(1)}%`, label: 'Percentile', color: '#c8102e', sub: totalHint > 0 ? `${cmpFedLabel.replace(' Rank', '')}` : undefined },
                  ]
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '.75rem', marginBottom: '1.5rem' }}>
                      {statItems.map(({ value, label, color, sub }) => (
                        <div key={label} style={{ textAlign: 'center', padding: '.875rem .5rem', background: 'var(--bg)', borderRadius: '.35rem' }}>
                          <div style={{ fontSize: `clamp(.9rem,${cols === 3 ? '2.8' : '3.5'}vw,${cols === 3 ? '1.35' : '1.6'}rem)`, fontWeight: 900, color, lineHeight: 1, letterSpacing: '-.02em' }}>
                            {value}
                          </div>
                          <div style={{ fontSize: '.5rem', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-4)', marginTop: '.4rem' }}>
                            {label}
                          </div>
                          {sub && <div style={{ fontSize: '.48rem', color: 'var(--text-4)', marginTop: '.2rem', letterSpacing: '.06em' }}>{sub}</div>}
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Progress bar */}
                {totalHint > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ position: 'relative', height: 6, background: 'var(--surface-2)', borderRadius: 3, marginBottom: 14 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${cmpPctTop}%`, background: '#272C84', borderRadius: 3, transition: 'width .5s ease' }} />
                      <div style={{
                        position: 'absolute', top: '50%', left: `${cmpPctTop}%`,
                        transform: 'translate(-50%,-50%)',
                        width: 14, height: 14, background: '#272C84', borderRadius: '50%',
                        border: '3px solid var(--bg)', boxShadow: '0 0 0 1px #272C84',
                        transition: 'left .5s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.54rem', color: 'var(--text-4)', letterSpacing: '.06em' }}>
                      <span>Rank 1 ← Strongest</span>
                      <span>out of {totalHint.toLocaleString()}{cmpCtx ? ' · ' + cmpCtx : ''}</span>
                    </div>
                  </div>
                )}

                {/* Nearest lifters */}
                <div style={{ border: '1px solid var(--surface-2)', borderRadius: '.35rem', overflow: 'hidden', marginBottom: '1.25rem', fontSize: '.78rem' }}>
                  {cmpPeerAbove ? (
                    <div style={{ display: 'flex', padding: '.6rem 1rem', borderBottom: '1px solid var(--surface-2)', alignItems: 'center', gap: '.75rem' }}>
                      <span style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, minWidth: 56, flexShrink: 0 }}>#{(cmpRank - 1).toLocaleString()}</span>
                      <span style={{ color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmpPeerAbove.name}</span>
                      {cmpPeerAbove.country && <span style={{ color: 'var(--text-4)', fontSize: '.65rem', flexShrink: 0 }}>{cmpPeerAbove.country}</span>}
                      <span style={{ color: 'var(--text-2)', fontWeight: 700, flexShrink: 0 }}>{parseFloat(cmpPeerAbove.dots || '0').toFixed(2)}</span>
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', padding: '.6rem 1rem', borderBottom: cmpPeerBelow ? '1px solid var(--surface-2)' : undefined, alignItems: 'center', gap: '.75rem', background: 'rgba(39,44,132,.12)', borderLeft: '3px solid #272C84' }}>
                    <span style={{ color: '#272C84', fontSize: '.52rem', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', minWidth: 56, flexShrink: 0 }}>▶ YOU</span>
                    <span style={{ color: '#272C84', fontWeight: 700, flex: 1 }}>Your Score</span>
                    {compare.wt && <span style={{ color: '#272C84', opacity: .65, fontSize: '.65rem', flexShrink: 0 }}>{compare.wt} kg</span>}
                    <span style={{ color: '#272C84', fontWeight: 900, flexShrink: 0 }}>{myDots.toFixed(2)}</span>
                  </div>

                  {cmpPeerBelow ? (
                    <div style={{ display: 'flex', padding: '.6rem 1rem', alignItems: 'center', gap: '.75rem' }}>
                      <span style={{ color: 'var(--text-4)', fontSize: '.6rem', fontWeight: 700, minWidth: 56, flexShrink: 0 }}>#{(cmpRank + 1).toLocaleString()}</span>
                      <span style={{ color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmpPeerBelow.name}</span>
                      {cmpPeerBelow.country && <span style={{ color: 'var(--text-4)', fontSize: '.65rem', flexShrink: 0 }}>{cmpPeerBelow.country}</span>}
                      <span style={{ color: 'var(--text-2)', fontWeight: 700, flexShrink: 0 }}>{parseFloat(cmpPeerBelow.dots || '0').toFixed(2)}</span>
                    </div>
                  ) : null}
                </div>

                {loading && rows.length > 0 && (
                  <p style={{ fontSize: '.6rem', color: 'var(--text-4)', textAlign: 'center', marginBottom: '.75rem', letterSpacing: '.08em' }}>
                    Refining rank… ({rows.length.toLocaleString()} loaded)
                  </p>
                )}

                {/* Jump to full table */}
                <button
                  onClick={() => {
                    setCollapsed(false)
                    setTimeout(() => {
                      const el = document.querySelector('[data-you-row]') as HTMLElement
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 150)
                  }}
                  style={{ width: '100%', background: '#272C84', color: '#fff', border: 'none', borderRadius: '.3rem', padding: '.875rem', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.15em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1a1f6b' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#272C84' }}
                >
                  Jump to Full Rankings Table ↓
                </button>
              </>
            )}
          </div>

        ) : (

          /* ── Expanded: compact strip ──────────────────────────────── */
          <div style={{ background: 'rgba(39,44,132,.08)', border: '1px solid rgba(39,44,132,.25)', borderRadius: '.4rem', padding: '.75rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#272C84', fontSize: '.58rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', flexShrink: 0 }}>▶ Comparison Mode</span>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '.78rem', color: 'var(--text-2)', minWidth: 0 }}>
              <span>{cmpFedLabel.replace(' Rank', '')} <strong style={{ color: '#272C84' }}>#{cmpRank.toLocaleString()}</strong></span>
              {cmpNatRank > 0 && cmpTopCountry && <><span style={{ color: 'var(--text-4)' }}>·</span><span>{cmpTopCountry} <strong style={{ color: '#272C84' }}>#{cmpNatRank.toLocaleString()}</strong></span></>}
              {cmpGlobalRank !== null && <><span style={{ color: 'var(--text-4)' }}>·</span><span>Global (all feds) <strong style={{ color: '#272C84' }}>#{cmpGlobalRank.toLocaleString()}</strong>{globalTotal > 0 && <span style={{ color: 'var(--text-4)', fontWeight: 400 }}> / {globalTotal.toLocaleString()}</span>}</span></>}
              {federation && globalRankLoading && cmpGlobalRank === null && <><span style={{ color: 'var(--text-4)' }}>·</span><span style={{ color: 'var(--text-4)' }}>Global…</span></>}
              <span style={{ color: 'var(--text-4)' }}>·</span>
              <span>Dots <strong style={{ color: '#272C84' }}>{myDots.toFixed(2)}</strong></span>
              <span style={{ color: 'var(--text-4)' }}>·</span>
              <span>Top <strong style={{ color: '#c8102e' }}>{cmpPctTop < 1 ? cmpPctTop.toFixed(2) : cmpPctTop.toFixed(1)}%</strong></span>
              {totalHint > 0 && <span style={{ color: 'var(--text-3)', fontSize: '.7rem' }}>out of {totalHint.toLocaleString()}</span>}
            </div>
            <button onClick={() => setCollapsed(true)} style={{
              background: 'transparent', border: '1px solid rgba(39,44,132,.35)', borderRadius: '.25rem',
              color: '#272C84', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em',
              textTransform: 'uppercase', padding: '.4rem .9rem', cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0,
            }}>Collapse ↑</button>
          </div>

        ))}

        {/* ── Filters always visible; table hidden when collapsed ────── */}

        {/* ── Global search bar ────────────────────────────────────── */}
        <div data-cmp-top style={{ position: 'relative', marginBottom: '1.25rem' }}>
          <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)', fontSize: '.9rem', pointerEvents: 'none' }}>⌕</span>
          <input
            type="text"
            value={globalSearch}
            onChange={e => setGlobalSearch(e.target.value)}
            placeholder="Search all fields — name, federation, meet, country, division, score, date…"
            maxLength={120}
            style={{
              ...SEL, boxSizing: 'border-box', width: '100%',
              padding: '.85rem 1rem .85rem 2.5rem',
              fontSize: '.85rem', borderRadius: '.4rem',
              border: globalSearch ? '1px solid rgba(200,16,46,.4)' : '1px solid var(--border)',
            }}
          />
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')} style={{
              position: 'absolute', right: '.75rem', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '.9rem', padding: '.25rem',
            }}>✕</button>
          )}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '.4rem', padding: '1.25rem 1.5rem', marginBottom: '1.75rem' }}>
          <p style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Filters</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>

            {/* Name — live search with 400ms debounce; drives API search */}
            <div>
              <label style={LBL}>Lifter Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. John Haack" maxLength={80}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>

            {/* Server-side filters (included in the API path) */}
            <div>
              <label style={LBL}>Federation</label>
              <select value={federation} onChange={e => setFederation(e.target.value)} style={SEL}>
                {FEDERATIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Sex</label>
              <select value={sex} onChange={e => setSex(e.target.value)} style={SEL}>
                {SEX_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Equipment</label>
              <select value={equipment} onChange={e => setEquipment(e.target.value)} style={SEL}>
                {EQUIPMENT.map(eq => <option key={eq.value} value={eq.value}>{eq.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Year</label>
              <select value={year} onChange={e => setYear(e.target.value)} style={SEL}>
                {YEARS.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
              </select>
            </div>

            {/* Client-side filters (applied post-fetch) */}
            <div>
              <label style={LBL}>Weight Class</label>
              <select value={weightClass} onChange={e => setWeightClass(e.target.value)} style={SEL}>
                {WEIGHT_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Age Class</label>
              <select value={ageClass} onChange={e => setAgeClass(e.target.value)} style={SEL}>
                {AGE_CLASSES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Country <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(client)</span></label>
              <input type="text" value={country} onChange={e => setCountry(e.target.value)}
                placeholder="e.g. USA, Canada" maxLength={40}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={LBL}>Division <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(client)</span></label>
              <input type="text" value={division} onChange={e => setDivision(e.target.value)}
                placeholder="e.g. Open, Masters 1" maxLength={40}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={LBL}>Meet Name <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(enriched)</span></label>
              <input type="text" value={meetName} onChange={e => setMeetName(e.target.value)}
                placeholder="e.g. Cayco Classic 3" maxLength={80}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={LBL}>Age (exact) <span style={{ color: 'var(--text-4)', fontWeight: 400 }}>(client)</span></label>
              <input type="number" value={ageExact} onChange={e => setAgeExact(e.target.value)}
                placeholder="e.g. 32" min={5} max={100} step={1}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Unit toggle + search button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '.3rem', overflow: 'hidden' }}>
              {(['lbs', 'kg'] as const).map(u => (
                <button key={u} onClick={() => setUnit(u)} style={{
                  padding: '.55rem 1.1rem', border: 'none', cursor: 'pointer',
                  background: unit === u ? '#272C84' : 'transparent',
                  color: unit === u ? '#ffffff' : 'var(--text-dim)',
                  fontWeight: 700, fontSize: '.62rem', letterSpacing: '.1em',
                  textTransform: 'uppercase', fontFamily: 'inherit',
                }}>{u}</button>
              ))}
            </div>
            <button onClick={handleSearch} disabled={loading} style={{
              background: loading ? 'var(--surface)' : '#272C84', color: loading ? 'var(--steel)' : '#ffffff',
              border: 'none', borderRadius: '.3rem', padding: '.6rem 2rem',
              fontWeight: 900, fontSize: '.65rem', letterSpacing: '.15em',
              textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>{loading ? 'Loading…' : 'Refresh'}</button>
            {searched && !loading && (
              <span style={{ color: 'var(--text-3)', fontSize: '.72rem', marginLeft: 'auto' }}>
                {displayRows.length !== rows.length
                  ? <>{displayRows.length.toLocaleString()} <span style={{ color: 'var(--text-4)' }}>of {rows.length.toLocaleString()}</span></>
                  : rows.length.toLocaleString()
                }{' '}loaded
                {!name.trim() && !globalSearch.trim() && totalHint > 0 && (
                  <span style={{ color: 'var(--text-4)' }}> / {totalHint.toLocaleString()} total</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* ── Table + results — hidden when compare is collapsed ───── */}
        {(!compare || !collapsed) && (<>

        {/* Error */}
        {error && (
          <div style={{ background: '#120208', border: '1px solid #2d0810', borderRadius: '.35rem', padding: '.875rem 1.25rem', color: '#f87171', fontSize: '.82rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        {/* ── Results table ─────────────────────────────────────────────── */}
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto', border: '1px solid var(--surface)', borderRadius: '.35rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surface)' }}>
                  {([
                    ['#',                   null],
                    ['Name',                null],
                    ['Country',             null],
                    ['Fed',                 null],
                    ['Sex',                 null],
                    ['Equip',               null],
                    ['Div',                 null],
                    ['Wt Class',            null],
                    ['BW',                  'bodyweightKg'],
                    ['Age',                 'age'],
                    ['Squat (' + unit + ')','best3SquatKg'],
                    ['Bench (' + unit + ')','best3BenchKg'],
                    ['Dead ('  + unit + ')','best3DeadliftKg'],
                    ['Total (' + unit + ')','totalKg'],
                    ['Dots',                'dots'],
                    ['Date',                null],
                  ] as [string, string|null][]).map(([label, key]) => (
                    <th key={label} style={{ ...TH, cursor: key ? 'pointer' : 'default',
                      color: key && key === sortKey ? '#c8102e' : 'var(--steel)',
                      userSelect: 'none' }}
                      onClick={() => key && handleSort(key)}>
                      {label}{key && key === sortKey ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* User score above all loaded rows */}
                {myDots > 0 && displayRows.length > 0 && sortKey === 'dots' && sortDir === 'desc'
                  && parseFloat(displayRows[0].dots || '0') < myDots && (
                  <UserScoreRow myDots={myDots} myTotal={myTotal} myBw={myBw} mySquat={mySquat} myBench={myBench} myDead={myDead} unit={unit} myWtClass={compare?.wt} />
                )}
                {displayRows.map((row, i) => {
                  const rk = row.name + '|' + i
                  const isExp = expanded === rk
                  const insertUserAfter = myDots > 0 && sortKey === 'dots' && sortDir === 'desc'
                    && parseFloat(row.dots || '0') >= myDots
                    && (i + 1 >= displayRows.length || parseFloat(displayRows[i + 1].dots || '0') < myDots)
                  return (
                    <Fragment key={rk}>
                      <tr
                        style={{ borderBottom: '1px solid var(--surface)', cursor: 'pointer', background: isExp ? 'var(--surface)' : 'transparent' }}
                        onClick={() => toggleHistory(row, rk)}
                        onMouseEnter={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = 'var(--surface-2)' }}
                        onMouseLeave={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                      >
                        <td style={{ ...TD, color: 'var(--text-3)', width: 36 }}>{i + 1}</td>
                        <td style={{ ...TD, color: 'var(--text)', fontWeight: 700, minWidth: 160 }}>
                          {row.name}<span style={{ color: 'var(--text-3)', marginLeft: 6, fontSize: '.6rem' }}>{isExp ? '▲' : '▼'}</span>
                        </td>
                        <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.7rem' }}>{row.country || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{row.federation || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{row.sex || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{row.equipment || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.7rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.division || '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{row.weightClassKg ? (unit === 'lbs' ? Math.round(toNum(row.weightClassKg) * 2.20462) + 'lbs' : row.weightClassKg + 'kg') : '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{row.bodyweightKg ? fmt(row.bodyweightKg, unit) + (unit === 'lbs' ? 'lbs' : 'kg') : '—'}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{row.age ? row.age.replace('~','') : '—'}</td>
                        <td style={{ ...TD, color: toNum(row.best3SquatKg) > 0 ? 'var(--text-dim)' : 'var(--border)' }}>{fmt(row.best3SquatKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.best3BenchKg) > 0 ? 'var(--text-dim)' : 'var(--border)' }}>{fmt(row.best3BenchKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.best3DeadliftKg) > 0 ? 'var(--text-dim)' : 'var(--border)' }}>{fmt(row.best3DeadliftKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.totalKg) > 0 ? 'var(--text)' : 'var(--border)', fontWeight: 700 }}>{fmt(row.totalKg, unit)}</td>
                        <td style={{ ...TD, color: 'var(--text-2)' }}>{fmtScore(row.dots)}</td>
                        <td style={{ ...TD, color: 'var(--text-3)' }}>{row.date || '—'}</td>
                      </tr>

                      {insertUserAfter && (
                        <UserScoreRow myDots={myDots} myTotal={myTotal} myBw={myBw} mySquat={mySquat} myBench={myBench} myDead={myDead} unit={unit} myWtClass={compare?.wt} />
                      )}
                      {isExp && (
                        <tr key={'hist-' + rk} style={{ background: 'var(--bg)' }}>
                          <td colSpan={16} style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--surface-2)' }}>
                            {loadingHist && <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>Loading competition history…</p>}
                            {histError  && <p style={{ color: '#f87171',  fontSize: '.75rem' }}>{histError}</p>}
                            {!loadingHist && !histError && histRows.length > 0 && (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
                                  <p style={{ color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>
                                    {row.name} — {histRows.length} entries
                                  </p>
                                  <a href={'https://www.openpowerlifting.org/u/' + row.slug}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ color: 'var(--text)', fontSize: '.65rem', textDecoration: 'none' }}
                                    onClick={e => e.stopPropagation()}>View on OPL ↗</a>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.73rem' }}>
                                    <thead>
                                      <tr>
                                        {['Date', 'Meet', 'Town', 'Fed', 'Equip', 'Div', 'Wt', 'BW',
                                          'SQ1', 'SQ2', 'SQ3', 'Best SQ (' + unit + ')',
                                          'BP1', 'BP2', 'BP3', 'Best BP (' + unit + ')',
                                          'DL1', 'DL2', 'DL3', 'Best DL (' + unit + ')',
                                          'Total (' + unit + ')', 'Dots', 'Wilks', 'GL', 'Tested', 'Place'
                                        ].map(h => (
                                          <th key={h} style={{ ...TH, fontSize: '.5rem', background: 'var(--bg)' }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {histRows.map((hr, hi) => {
                                        const place1 = hr.place === '1'
                                        return (
                                          <tr key={hi} style={{ borderBottom: '1px solid var(--surface-2)' }}>
                                            <td style={{ ...TD, color: 'var(--text-2)', fontSize: '.72rem' }}>{hr.date || '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.72rem', minWidth: 140 }}>{hr.meetName || '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-4)', fontSize: '.72rem' }}>{hr.meetTown || '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-2)', fontSize: '.72rem' }}>{hr.federation || '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-2)', fontSize: '.72rem' }}>{hr.equipment || '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.72rem' }}>{hr.division || '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-2)', fontSize: '.72rem' }}>{hr.weightClassKg ? (unit === 'lbs' ? Math.round(toNum(hr.weightClassKg) * 2.20462) + 'lbs' : hr.weightClassKg + 'kg') : '—'}</td>
                                            <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.72rem' }}>{hr.bodyweightKg ? fmt(hr.bodyweightKg, unit) + (unit === 'lbs' ? 'lbs' : 'kg') : '—'}</td>
                                            {/* Individual attempts */}
                                            {(['squat1Kg','squat2Kg','squat3Kg','best3SquatKg',
                                               'bench1Kg','bench2Kg','bench3Kg','best3BenchKg',
                                               'deadlift1Kg','deadlift2Kg','deadlift3Kg','best3DeadliftKg'] as const).map(field => {
                                              const val = toNum(hr[field])
                                              const isBest = field.startsWith('best')
                                              const isMiss = hr[field].startsWith('-')
                                              return (
                                                <td key={field} style={{ ...TD, fontSize: '.72rem',
                                                  color: isMiss ? '#c8102e' : (val > 0 ? (isBest ? 'var(--text-dim)' : 'var(--text-3)') : 'var(--border)'),
                                                  fontWeight: isBest ? 600 : 400,
                                                }}>
                                                  {hr[field] ? fmt(hr[field].replace('-',''), unit) : '—'}
                                                </td>
                                              )
                                            })}
                                            <td style={{ ...TD, color: toNum(hr.totalKg) > 0 ? 'var(--text)' : 'var(--border)', fontWeight: 700, fontSize: '.72rem' }}>{fmt(hr.totalKg, unit)}</td>
                                            <td style={{ ...TD, color: 'var(--text-2)', fontSize: '.72rem' }}>{fmtScore(hr.dots)}</td>
                                            <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.72rem' }}>{fmtScore(hr.wilks)}</td>
                                            <td style={{ ...TD, color: 'var(--text-3)', fontSize: '.72rem' }}>{fmtScore(hr.glossbrenner)}</td>
                                            <td style={{ ...TD, fontSize: '.72rem' }}>
                                              {hr.tested === 'Yes'
                                                ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                                                : hr.tested === 'No'
                                                  ? <span style={{ color: 'var(--text-4)' }}>—</span>
                                                  : <span style={{ color: 'var(--text-4)' }}>?</span>}
                                            </td>
                                            <td style={{ ...TD, fontWeight: 700, color: place1 ? '#c8102e' : 'var(--text-3)', fontSize: '.72rem' }}>
                                              {place1 ? '🥇 1' : (hr.place || '—')}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                            {!loadingHist && !histError && histRows.length === 0 && (
                              <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>No competition history found.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Infinite scroll sentinel + loading indicator ───────────────── */}
        {searched && (
          <>
            <div ref={sentinelRef} style={{ height: 1 }} />
            {loadingMore && (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-3)', fontSize: '.75rem', letterSpacing: '.1em' }}>
                Loading more…
              </div>
            )}
            {!loadingMore && !hasMore && rows.length > 0 && (
              <div style={{ textAlign: 'center', padding: '1.75rem 0', color: 'var(--text-3)', fontSize: '.68rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
                — {rows.length.toLocaleString()} results —
              </div>
            )}
          </>
        )}

        {/* Pre-search state — only when no filters set */}
        {!searched && !loading && !name.trim() && !globalSearch.trim() && !federation && !equipment && !year && !weightClass && !ageClass && !country.trim() && !division.trim() && !meetName.trim() && !ageExact.trim() && (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <div style={{ fontSize: 44, marginBottom: '1.25rem' }}>🏋️</div>
            <p style={{ color: 'var(--text-3)', fontSize: '.875rem', marginBottom: '.5rem' }}>Type a name or set any filter — results load instantly.</p>
            <p style={{ color: 'var(--text-3)', fontSize: '.75rem' }}>All fields search live as you type. Combine multiple filters for precision.</p>
          </div>
        )}
        {searched && !loading && rows.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-3)', fontSize: '.875rem' }}>
            No results. Try broadening your filters.
          </div>
        )}
        {searched && !loading && rows.length > 0 && displayRows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-3)', fontSize: '.875rem' }}>
            No loaded results match "<span style={{ color: 'var(--text-2)' }}>{globalSearch || meetName}</span>".{' '}
            <button onClick={() => { setGlobalSearch(''); setMeetName('') }} style={{ background: 'none', border: 'none', color: '#c8102e', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }}>Clear filters</button>
          </div>
        )}

        </>)} {/* end (!compare || !collapsed) */}

        {/* Attribution */}
        <div style={{ marginTop: '4rem', paddingTop: '1.25rem', borderTop: '1px solid var(--surface-2)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', fontSize: '.65rem', color: 'var(--text-3)', paddingBottom: compare && !collapsed ? '3.5rem' : undefined }}>
          <span>Data © OpenPowerlifting contributors — CC BY 4.0 + ODbL</span>
          <a href="https://www.openpowerlifting.org" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-3)', textDecoration: 'none' }}>openpowerlifting.org ↗</a>
        </div>
      </div>

      {/* ── Sticky collapse bar — pinned to bottom when compare table is expanded ── */}
      {compare && !collapsed && myDots > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 60,
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '1rem', padding: '.65rem 1.5rem', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', fontSize: '.72rem', color: 'var(--text-3)' }}>
            <span style={{ color: '#272C84', fontWeight: 900, fontSize: '.58rem', letterSpacing: '.12em', textTransform: 'uppercase' }}>▶ YOU</span>
            <span>{cmpFedLabel.replace(' Rank', '')} <strong style={{ color: 'var(--text-2)' }}>#{cmpRank.toLocaleString()}</strong>{totalHint > 0 && <span style={{ color: 'var(--text-4)', fontWeight: 400 }}> / {totalHint.toLocaleString()}</span>}</span>
            {cmpNatRank > 0 && cmpTopCountry && <><span style={{ color: 'var(--text-4)' }}>·</span><span>{cmpTopCountry} <strong style={{ color: 'var(--text-2)' }}>#{cmpNatRank.toLocaleString()}</strong></span></>}
            {cmpGlobalRank !== null && <><span style={{ color: 'var(--text-4)' }}>·</span><span>All Feds <strong style={{ color: 'var(--text-2)' }}>#{cmpGlobalRank.toLocaleString()}</strong>{globalTotal > 0 && <span style={{ color: 'var(--text-4)', fontWeight: 400 }}> / {globalTotal.toLocaleString()}</span>}</span></>}
            {federation && globalRankLoading && cmpGlobalRank === null && <><span style={{ color: 'var(--text-4)' }}>·</span><span style={{ color: 'var(--text-4)', fontSize: '.7rem' }}>All Feds…</span></>}
            <span style={{ color: 'var(--text-4)' }}>·</span>
            <span>Dots <strong style={{ color: 'var(--text-2)' }}>{myDots.toFixed(2)}</strong></span>
            <span style={{ color: 'var(--text-4)' }}>·</span>
            <span>Top <strong style={{ color: '#c8102e' }}>{cmpPctTop < 1 ? cmpPctTop.toFixed(2) : cmpPctTop.toFixed(1)}%</strong></span>
          </div>
          <div style={{ display: 'flex', gap: '.75rem', flexShrink: 0 }}>
            <button
              onClick={() => {
                const el = document.querySelector('[data-cmp-top]') as HTMLElement
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '.25rem', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .9rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Filters ↑</button>
            <button
              onClick={() => {
                const el = document.querySelector('[data-you-row]') as HTMLElement
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '.25rem', color: 'var(--text-2)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .9rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >Find My Row ↑</button>
            <button
              onClick={() => setCollapsed(true)}
              style={{ background: '#272C84', border: 'none', borderRadius: '.25rem', color: '#fff', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.4rem .9rem', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1a1f6b' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#272C84' }}
            >Collapse ↑</button>
          </div>
        </div>
      )}
    </div>
  )
}
