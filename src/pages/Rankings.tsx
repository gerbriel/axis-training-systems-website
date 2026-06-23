import { useState, useCallback, useRef, useEffect } from 'react'
import { href } from '../utils/nav'

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

async function oplFetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url)
    if (res.status === 429) {
      if (attempt < 3) { await sleep(1200 * (attempt + 1)); continue }
      throw new Error('Rate limited.')
    }
    if (!res.ok) throw new Error('History endpoint returned ' + res.status)
    return res.text()
  }
  return ''
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
// [17]=wt-class-kg [18]=bw-kg [19]=squat [20]=bench [21]=dead [22]=total [23]=dots
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
      country:         s(6),   // lifter's nationality (col 6)
      division:        s(16),
      weightClassKg:   s(17),  // wt-class-kg
      bodyweightKg:    s(18),  // bw-kg
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
async function fetchLifterHistory(slug: string): Promise<HistRow[]> {
  const cached = HIST_CACHE.get(slug)
  if (cached) return cached
  const csv = await oplFetchText(opl('/api/liftercsv/' + encodeURIComponent(slug)))
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
  background: '#1a1a1a', border: '1px solid #222222', borderRadius: '.3rem',
  color: '#d6d6d6', fontSize: '.78rem', padding: '.65rem .75rem',
  fontFamily: 'inherit', outline: 'none', cursor: 'pointer', width: '100%',
}
const TH: React.CSSProperties = {
  padding: '.6rem .8rem', textAlign: 'left', color: '#888888',
  fontSize: '.52rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.1em', whiteSpace: 'nowrap', background: '#000000',
}
const TD: React.CSSProperties = { padding: '.65rem .8rem', fontSize: '.78rem', whiteSpace: 'nowrap' }
const LBL: React.CSSProperties = {
  color: '#888888', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', display: 'block', marginBottom: '.4rem',
}

const LOAD_SIZE = 100

// ── Component ─────────────────────────────────────────────────────────────
export default function Rankings() {
  const [name,        setName]        = useState('')
  const [federation,  setFederation]  = useState('')
  const [sex,         setSex]         = useState('')
  const [equipment,   setEquipment]   = useState('')
  const [weightClass, setWeightClass] = useState('')
  const [ageClass,    setAgeClass]    = useState('')
  const [year,        setYear]        = useState('')
  const [country,     setCountry]     = useState('')
  const [division,    setDivision]    = useState('')
  const [unit,        setUnit]        = useState<'lbs' | 'kg'>('lbs')
  const [rows,        setRows]        = useState<RankRow[]>([])
  const [totalHint,   setTotalHint]   = useState(0)
  const [hasMore,     setHasMore]     = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,       setError]       = useState('')
  const [searched,    setSearched]    = useState(false)
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [histRows,    setHistRows]    = useState<HistRow[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [histError,   setHistError]   = useState('')
  const [sortKey,     setSortKey]     = useState<string>('dots')
  const [sortDir,     setSortDir]     = useState<'asc'|'desc'>('desc')
  const [globalSearch, setGlobalSearch] = useState('')  // top bar: client-side all-field + API name when name is empty
  const [meetName,    setMeetName]    = useState('')    // client-side meet name filter
  const [ageFilter,   setAgeFilter]   = useState('')    // client-side exact or min age filter

  const abortRef        = useRef<AbortController | null>(null)
  const sentinelRef     = useRef<HTMLDivElement | null>(null)
  const serverOffsetRef = useRef(0)
  const serverTotalRef  = useRef(Infinity)
  const isLoadingRef    = useRef(false)
  const searchGenRef    = useRef(0)   // incremented each search; finally only clears if still current gen
  const handleSearchRef = useRef<() => void>(() => {})
  const didMountRef     = useRef(true)  // always fire effects — no skip needed

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
  // are not in the server-side path)
  const applyClientFilters = useCallback((r: RankRow[]) => {
    return r.filter(row => {
      if (name.trim() && !row.name.toLowerCase().includes(name.trim().toLowerCase())) return false
      if (weightClass) {
        const rowWt = row.weightClassKg.replace(/\.0$/, '')
        const selWt = weightClass.replace(/\.0$/, '')
        if (rowWt !== selWt) return false
      }
      if (ageClass) {
        const age = parseFloat(row.age)
        if (!isNaN(age)) {
          const [lo, hi] = ageClass.split('-').map(Number)
          if (age < lo || age > hi) return false
        }
      }
      if (ageFilter.trim()) {
        const age = parseFloat(row.age)
        const target = parseFloat(ageFilter.trim())
        if (!isNaN(age) && !isNaN(target) && Math.floor(age) !== Math.floor(target)) return false
      }
      if (country && !row.country.toLowerCase().includes(country.trim().toLowerCase())) return false
      if (division && !row.division.toLowerCase().includes(division.trim().toLowerCase())) return false
      if (meetName.trim() && !row.meetName.toLowerCase().includes(meetName.trim().toLowerCase())) return false
      return true
    })
  }, [name, weightClass, ageClass, ageFilter, country, division, meetName])

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
        // Name search: filtered API context + parallel row fetches + session cache
        const allRows = await nameSearch(searchName, suffix, signal)
        newRows.push(...applyClientFilters(allRows))
        if (isInit) setRows(newRows); else setRows(prev => [...prev, ...newRows])
        setHasMore(false)

      } else {
        // Browse mode: page through ranked list in chunks of 100
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
          const hasClientFilter = !!(weightClass || ageClass || country || division)
          newRows.push(...(hasClientFilter ? applyClientFilters(parseRows(data)) : parseRows(data)))
          serverOffsetRef.current += 100
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
  }, [name, globalSearch, weightClass, ageClass, country, division, buildPath, buildFilterSuffix, applyClientFilters])

  const handleSearch = useCallback(() => {
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
  }, [loadChunk])

  // Keep ref current every render so effects can call latest version
  handleSearchRef.current = handleSearch

  // Live search on name — 400ms debounce
  useEffect(() => {
    if (!name.trim()) {
      handleSearchRef.current()
      return
    }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  // Global search bar — same 400ms debounce, but only drives API when name is empty
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

  // Text filter fields: same debounce pattern as name — fire on first use, clear on empty.
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
    if (!ageFilter) { handleSearchRef.current(); return }
    const t = setTimeout(() => handleSearchRef.current(), 200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageFilter])

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

  return (
    <div style={{ minHeight: '100vh', background: '#000000', color: '#fff', fontFamily: 'inherit' }}>

      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(0,0,0,0.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #222222', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}><img src={BASE + 'logo.svg'} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }}/></a>
        <span style={{ color: '#888888' }}>›</span>
        <span style={{ color: '#c7c7c7', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Rankings</span>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3.5rem 1.5rem 6rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{ color: '#fff', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Powered by OpenPowerlifting</p>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05, marginBottom: '.75rem' }}>Powerlifting Rankings</h1>
          <p style={{ color: '#c7c7c7', fontSize: '.875rem', maxWidth: 560, lineHeight: 1.7 }}>Browse ranked results from 3M+ competition entries worldwide. All filters update results live — just type or select.</p>
        </div>

        {/* ── Global search bar ────────────────────────────────────── */}
        <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
          <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '.9rem', pointerEvents: 'none' }}>⌕</span>
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
              border: globalSearch ? '1px solid rgba(200,16,46,.4)' : '1px solid #222222',
            }}
          />
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')} style={{
              position: 'absolute', right: '.75rem', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '.9rem', padding: '.25rem',
            }}>✕</button>
          )}
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div style={{ background: '#000000', border: '1px solid #222222', borderRadius: '.4rem', padding: '1.25rem 1.5rem', marginBottom: '1.75rem' }}>
          <p style={{ color: '#888888', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Filters</p>
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
              <label style={LBL}>Country <span style={{ color: '#555', fontWeight: 400 }}>(client)</span></label>
              <input type="text" value={country} onChange={e => setCountry(e.target.value)}
                placeholder="e.g. USA, Canada" maxLength={40}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={LBL}>Division <span style={{ color: '#555', fontWeight: 400 }}>(client)</span></label>
              <input type="text" value={division} onChange={e => setDivision(e.target.value)}
                placeholder="e.g. Open, Masters 1" maxLength={40}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={LBL}>Meet Name <span style={{ color: '#555', fontWeight: 400 }}>(client)</span></label>
              <input type="text" value={meetName} onChange={e => setMeetName(e.target.value)}
                placeholder="e.g. Arnold Classic" maxLength={80}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={LBL}>Age <span style={{ color: '#555', fontWeight: 400 }}>(exact)</span></label>
              <input type="number" value={ageFilter} onChange={e => setAgeFilter(e.target.value)}
                placeholder="e.g. 32" min={0} max={100} step={1}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Unit toggle + search button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#0d0d0d', border: '1px solid #222222', borderRadius: '.3rem', overflow: 'hidden' }}>
              {(['lbs', 'kg'] as const).map(u => (
                <button key={u} onClick={() => setUnit(u)} style={{
                  padding: '.55rem 1.1rem', border: 'none', cursor: 'pointer',
                  background: unit === u ? '#c8102e' : 'transparent',
                  color: unit === u ? '#fff' : '#444',
                  fontWeight: 700, fontSize: '.62rem', letterSpacing: '.1em',
                  textTransform: 'uppercase', fontFamily: 'inherit',
                }}>{u}</button>
              ))}
            </div>
            <button onClick={handleSearch} disabled={loading} style={{
              background: loading ? '#0d0d0d' : '#c8102e', color: loading ? '#3a3f47' : '#fff',
              border: 'none', borderRadius: '.3rem', padding: '.6rem 2rem',
              fontWeight: 900, fontSize: '.65rem', letterSpacing: '.15em',
              textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>{loading ? 'Loading…' : 'Refresh'}</button>
            {searched && !loading && (
              <span style={{ color: '#888888', fontSize: '.72rem', marginLeft: 'auto' }}>
                {displayRows.length !== rows.length
                  ? <>{displayRows.length.toLocaleString()} <span style={{ color: '#555' }}>of {rows.length.toLocaleString()}</span></>
                  : rows.length.toLocaleString()
                }{' '}loaded
                {!name.trim() && !globalSearch.trim() && totalHint > 0 && (
                  <span style={{ color: '#555' }}> / {totalHint.toLocaleString()} total</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#120208', border: '1px solid #2d0810', borderRadius: '.35rem', padding: '.875rem 1.25rem', color: '#f87171', fontSize: '.82rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        {/* ── Results table ─────────────────────────────────────────────── */}
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto', border: '1px solid #0d0d0d', borderRadius: '.35rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #0d0d0d' }}>
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
                      color: key && key === sortKey ? '#c8102e' : '#3a3f47',
                      userSelect: 'none' }}
                      onClick={() => key && handleSort(key)}>
                      {label}{key && key === sortKey ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => {
                  const rk = row.name + '|' + i
                  const isExp = expanded === rk
                  return (
                    <>
                      <tr key={rk}
                        style={{ borderBottom: '1px solid #000000', cursor: 'pointer', background: isExp ? '#0e0e0e' : 'transparent' }}
                        onClick={() => toggleHistory(row, rk)}
                        onMouseEnter={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = '#1a1a1a' }}
                        onMouseLeave={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                      >
                        <td style={{ ...TD, color: '#888888', width: 36 }}>{i + 1}</td>
                        <td style={{ ...TD, color: '#fff', fontWeight: 700, minWidth: 160 }}>
                          {row.name}<span style={{ color: '#888888', marginLeft: 6, fontSize: '.6rem' }}>{isExp ? '▲' : '▼'}</span>
                        </td>
                        <td style={{ ...TD, color: '#888888', fontSize: '.7rem' }}>{row.country || '—'}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{row.federation || '—'}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{row.sex || '—'}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{row.equipment || '—'}</td>
                        <td style={{ ...TD, color: '#888888', fontSize: '.7rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.division || '—'}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{row.weightClassKg ? (unit === 'lbs' ? Math.round(toNum(row.weightClassKg) * 2.20462) + 'lbs' : row.weightClassKg + 'kg') : '—'}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{row.bodyweightKg ? fmt(row.bodyweightKg, unit) + (unit === 'lbs' ? 'lbs' : 'kg') : '—'}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{row.age ? row.age.replace('~','') : '—'}</td>
                        <td style={{ ...TD, color: toNum(row.best3SquatKg) > 0 ? '#aaa' : '#222222' }}>{fmt(row.best3SquatKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.best3BenchKg) > 0 ? '#aaa' : '#222222' }}>{fmt(row.best3BenchKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.best3DeadliftKg) > 0 ? '#aaa' : '#222222' }}>{fmt(row.best3DeadliftKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.totalKg) > 0 ? '#fff' : '#222222', fontWeight: 700 }}>{fmt(row.totalKg, unit)}</td>
                        <td style={{ ...TD, color: '#c7c7c7' }}>{fmtScore(row.dots)}</td>
                        <td style={{ ...TD, color: '#888888' }}>{row.date || '—'}</td>
                      </tr>

                      {isExp && (
                        <tr key={'hist-' + rk} style={{ background: '#000000' }}>
                          <td colSpan={16} style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #1a1a1a' }}>
                            {loadingHist && <p style={{ color: '#888888', fontSize: '.75rem' }}>Loading competition history…</p>}
                            {histError  && <p style={{ color: '#f87171',  fontSize: '.75rem' }}>{histError}</p>}
                            {!loadingHist && !histError && histRows.length > 0 && (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
                                  <p style={{ color: '#c7c7c7', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>
                                    {row.name} — {histRows.length} entries
                                  </p>
                                  <a href={'https://www.openpowerlifting.org/u/' + row.slug}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ color: '#fff', fontSize: '.65rem', textDecoration: 'none' }}
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
                                          <th key={h} style={{ ...TH, fontSize: '.5rem', background: '#000000' }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {histRows.map((hr, hi) => {
                                        const place1 = hr.place === '1'
                                        return (
                                          <tr key={hi} style={{ borderBottom: '1px solid #1a1a1a' }}>
                                            <td style={{ ...TD, color: '#c7c7c7', fontSize: '.72rem' }}>{hr.date || '—'}</td>
                                            <td style={{ ...TD, color: '#888888', fontSize: '.72rem', minWidth: 140 }}>{hr.meetName || '—'}</td>
                                            <td style={{ ...TD, color: '#555', fontSize: '.72rem' }}>{hr.meetTown || '—'}</td>
                                            <td style={{ ...TD, color: '#c7c7c7', fontSize: '.72rem' }}>{hr.federation || '—'}</td>
                                            <td style={{ ...TD, color: '#c7c7c7', fontSize: '.72rem' }}>{hr.equipment || '—'}</td>
                                            <td style={{ ...TD, color: '#888888', fontSize: '.72rem' }}>{hr.division || '—'}</td>
                                            <td style={{ ...TD, color: '#c7c7c7', fontSize: '.72rem' }}>{hr.weightClassKg ? (unit === 'lbs' ? Math.round(toNum(hr.weightClassKg) * 2.20462) + 'lbs' : hr.weightClassKg + 'kg') : '—'}</td>
                                            <td style={{ ...TD, color: '#888888', fontSize: '.72rem' }}>{hr.bodyweightKg ? fmt(hr.bodyweightKg, unit) + (unit === 'lbs' ? 'lbs' : 'kg') : '—'}</td>
                                            {/* Individual attempts */}
                                            {(['squat1Kg','squat2Kg','squat3Kg','best3SquatKg',
                                               'bench1Kg','bench2Kg','bench3Kg','best3BenchKg',
                                               'deadlift1Kg','deadlift2Kg','deadlift3Kg','best3DeadliftKg'] as const).map(field => {
                                              const val = toNum(hr[field])
                                              const isBest = field.startsWith('best')
                                              const isMiss = hr[field].startsWith('-')
                                              return (
                                                <td key={field} style={{ ...TD, fontSize: '.72rem',
                                                  color: isMiss ? '#c8102e' : (val > 0 ? (isBest ? '#aaa' : '#666') : '#222222'),
                                                  fontWeight: isBest ? 600 : 400,
                                                }}>
                                                  {hr[field] ? fmt(hr[field].replace('-',''), unit) : '—'}
                                                </td>
                                              )
                                            })}
                                            <td style={{ ...TD, color: toNum(hr.totalKg) > 0 ? '#fff' : '#222222', fontWeight: 700, fontSize: '.72rem' }}>{fmt(hr.totalKg, unit)}</td>
                                            <td style={{ ...TD, color: '#c7c7c7', fontSize: '.72rem' }}>{fmtScore(hr.dots)}</td>
                                            <td style={{ ...TD, color: '#888888', fontSize: '.72rem' }}>{fmtScore(hr.wilks)}</td>
                                            <td style={{ ...TD, color: '#888888', fontSize: '.72rem' }}>{fmtScore(hr.glossbrenner)}</td>
                                            <td style={{ ...TD, fontSize: '.72rem' }}>
                                              {hr.tested === 'Yes'
                                                ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
                                                : hr.tested === 'No'
                                                  ? <span style={{ color: '#555' }}>—</span>
                                                  : <span style={{ color: '#555' }}>?</span>}
                                            </td>
                                            <td style={{ ...TD, fontWeight: 700, color: place1 ? '#c8102e' : '#666', fontSize: '.72rem' }}>
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
                              <p style={{ color: '#888888', fontSize: '.75rem' }}>No competition history found.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
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
              <div style={{ textAlign: 'center', padding: '2rem 0', color: '#888888', fontSize: '.75rem', letterSpacing: '.1em' }}>
                Loading more…
              </div>
            )}
            {!loadingMore && !hasMore && rows.length > 0 && (
              <div style={{ textAlign: 'center', padding: '1.75rem 0', color: '#888888', fontSize: '.68rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
                — {rows.length.toLocaleString()} results —
              </div>
            )}
          </>
        )}

        {/* Pre-search state — only when no filters set */}
        {!searched && !loading && !name.trim() && !globalSearch.trim() && !federation && !equipment && !year && !weightClass && !ageClass && !country.trim() && !division.trim() && !meetName.trim() && !ageFilter.trim() && (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <div style={{ fontSize: 44, marginBottom: '1.25rem' }}>🏋️</div>
            <p style={{ color: '#888888', fontSize: '.875rem', marginBottom: '.5rem' }}>Type a name or set any filter — results load instantly.</p>
            <p style={{ color: '#888888', fontSize: '.75rem' }}>All fields search live as you type. Combine multiple filters for precision.</p>
          </div>
        )}
        {searched && !loading && rows.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: '#888888', fontSize: '.875rem' }}>
            No results. Try broadening your filters.
          </div>
        )}
        {searched && !loading && rows.length > 0 && displayRows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888888', fontSize: '.875rem' }}>
            No loaded results match "<span style={{ color: '#c7c7c7' }}>{globalSearch || meetName}</span>".{' '}
            <button onClick={() => { setGlobalSearch(''); setMeetName('') }} style={{ background: 'none', border: 'none', color: '#c8102e', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }}>Clear filters</button>
          </div>
        )}

        {/* Attribution */}
        <div style={{ marginTop: '4rem', paddingTop: '1.25rem', borderTop: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', fontSize: '.65rem', color: '#888888' }}>
          <span>Data © OpenPowerlifting contributors — CC BY 4.0 + ODbL</span>
          <a href="https://www.openpowerlifting.org" target="_blank" rel="noopener noreferrer" style={{ color: '#888888', textDecoration: 'none' }}>openpowerlifting.org ↗</a>
        </div>
      </div>
    </div>
  )
}
