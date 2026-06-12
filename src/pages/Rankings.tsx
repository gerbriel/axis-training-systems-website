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

// ── Helpers ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

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

const toNum = (v: string | undefined) => parseFloat(v || '0') || 0
// We always fetch units=kg from the API and convert here for display
const fmt = (v: string | undefined, unit: 'lbs' | 'kg') => {
  const n = toNum(v); if (!n) return '—'
  const d = unit === 'lbs' ? n * 2.20462 : n
  return unit === 'lbs' ? String(Math.round(d)) : String(Math.round(d * 10) / 10)
}
const fmtScore = (v: string | undefined) => {
  const n = toNum(v); return n > 0 ? n.toFixed(2) : '—'
}
// OPL returns rows as positional arrays — no fieldnames key in response
// Positions: [0]=idx [1]=rank [2]=name [3]=slug [4]=social [5]=badge
// [6]=country [7]=state-code [8]=fed [9]=date [10]=country [11]=state
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
      country:         s(10),
      division:        s(16),
      weightClassKg:   s(18),
      bodyweightKg:    s(17),
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

const SEL: React.CSSProperties = {
  background: '#0e1c30', border: '1px solid #152842', borderRadius: '.3rem',
  color: '#d6d6d6', fontSize: '.78rem', padding: '.65rem .75rem',
  fontFamily: 'inherit', outline: 'none', cursor: 'pointer', width: '100%',
}
const TH: React.CSSProperties = {
  padding: '.6rem .8rem', textAlign: 'left', color: '#3a3f47',
  fontSize: '.52rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.1em', whiteSpace: 'nowrap', background: '#10131a',
}
const TD: React.CSSProperties = { padding: '.65rem .8rem', fontSize: '.78rem', whiteSpace: 'nowrap' }
const LBL: React.CSSProperties = {
  color: '#3a3f47', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', display: 'block', marginBottom: '.4rem',
}

const LOAD_SIZE = 100  // rows to add per scroll trigger

// ── Component ─────────────────────────────────────────────────────────────
export default function Rankings() {
  const [name,        setName]        = useState('')
  const [federation,  setFederation]  = useState('')
  const [sex,         setSex]         = useState('')
  const [equipment,   setEquipment]   = useState('')
  const [weightClass, setWeightClass] = useState('')
  const [ageClass,    setAgeClass]    = useState('')
  const [year,        setYear]        = useState('')
  const [unit,        setUnit]        = useState<'lbs' | 'kg'>('lbs')
  const [rows,        setRows]        = useState<RankRow[]>([])
  const [totalHint,   setTotalHint]   = useState(0)   // server's total_length for the display hint
  const [hasMore,     setHasMore]     = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,       setError]       = useState('')
  const [searched,    setSearched]    = useState(false)
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [histRows,    setHistRows]    = useState<RankRow[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [histError,   setHistError]   = useState('')
  const [sortKey,     setSortKey]     = useState<string>('dots')
  const [sortDir,     setSortDir]     = useState<'asc'|'desc'>('desc')

  const abortRef        = useRef<AbortController | null>(null)
  const sentinelRef     = useRef<HTMLDivElement | null>(null)
  // batch-scan state (for non-name searches)
  const serverOffsetRef = useRef(0)
  const serverTotalRef  = useRef(Infinity)
  // name-search state (for name searches via /api/search/rankings)
  const nameSearchStart = useRef(0)
  const nameSearchDone  = useRef(false)
  // guard against concurrent loadChunk calls
  const isLoadingRef    = useRef(false)

  const buildPath = useCallback(() => {
    const parts: string[] = []
    if (federation) parts.push(federation.toLowerCase())
    if (equipment)  parts.push(equipment)
    if (sex === 'M') parts.push('men')
    else if (sex === 'F') parts.push('women')
    if (year) parts.push(year)
    return '/api/rankings' + (parts.length ? '/' + parts.join('/') : '')
  }, [federation, equipment, sex, year])

  // Client-side filters: weight class, age class (and name as a post-filter for batch scan)
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
      return true
    })
  }, [name, weightClass, ageClass])

  // Core load function. isInit=true resets the table; false appends (infinite scroll).
  const loadChunk = useCallback(async (isInit: boolean) => {
    if (isLoadingRef.current) return
    isLoadingRef.current = true
    if (isInit) setLoading(true); else setLoadingMore(true)
    setError('')

    const ctrl   = abortRef.current!
    const signal = ctrl.signal
    const path   = buildPath()
    const BASE_Q = { lang: 'en', units: 'kg' } as const

    try {
      const newRows: RankRow[] = []

      if (name.trim()) {
        // ── Name search: use OPL's search/rankings API which walks the FULL database ──
        // Each call returns the next matching row index; we fetch that row and apply
        // remaining client-side filters (weight class, age class).
        let start = nameSearchStart.current
        while (newRows.length < LOAD_SIZE && !nameSearchDone.current) {
          if (signal.aborted) return
          const sq = new URLSearchParams({ q: name.trim(), start: String(start), end: '9999999' })
          let sdata: any
          try { sdata = await oplFetch(opl('/api/search/rankings?' + sq), signal) }
          catch { nameSearchDone.current = true; break }
          if (sdata?.next_index == null) { nameSearchDone.current = true; break }
          const idx = Number(sdata.next_index)
          start = idx + 1
          // Fetch the actual row from the (possibly filtered) rankings path
          const rq = new URLSearchParams({ ...BASE_Q, start: String(idx), end: String(idx) })
          try {
            const rdata = await oplFetch(opl('/api/rankings?' + rq), signal)
            const filtered = applyClientFilters(parseRows(rdata))
            newRows.push(...filtered)
          } catch { /* skip individual row errors */ }
          await sleep(80)
        }
        nameSearchStart.current = start
        if (isInit) setRows(newRows); else setRows(prev => [...prev, ...newRows])
        setHasMore(!nameSearchDone.current)

      } else {
        // ── Batch scan: fetch ranked rows in 100-row pages, filter client-side ──
        // Used for weight class / age class / unfiltered browsing.
        while (newRows.length < LOAD_SIZE && serverOffsetRef.current < serverTotalRef.current) {
          if (signal.aborted) return
          const q = new URLSearchParams({
            ...BASE_Q,
            start: String(serverOffsetRef.current),
            end:   String(serverOffsetRef.current + 99),
          })
          const data = await oplFetch(opl(path + '?' + q), signal)
          const total = data?.total_length ?? serverTotalRef.current
          serverTotalRef.current = total
          if (isInit && serverOffsetRef.current === 0) setTotalHint(total)
          const hasClientFilter = !!(weightClass || ageClass)
          newRows.push(...(hasClientFilter ? applyClientFilters(parseRows(data)) : parseRows(data)))
          serverOffsetRef.current += 100
          if (newRows.length < LOAD_SIZE) await sleep(150)
        }
        if (isInit) setRows(newRows); else setRows(prev => [...prev, ...newRows])
        setHasMore(serverOffsetRef.current < serverTotalRef.current)
      }

      setSearched(true)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Failed to load rankings. Try again.')
    } finally {
      isLoadingRef.current = false
      if (isInit) setLoading(false); else setLoadingMore(false)
    }
  }, [name, weightClass, ageClass, buildPath, applyClientFilters])

  const handleSearch = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    // Reset all scroll/scan state
    serverOffsetRef.current = 0
    serverTotalRef.current  = Infinity
    nameSearchStart.current = 0
    nameSearchDone.current  = false
    isLoadingRef.current    = false
    setRows([])
    setHasMore(false)
    setTotalHint(0)
    setExpanded(null)
    setHistRows([])
    loadChunk(true)
  }, [loadChunk])

  // IntersectionObserver: fires loadChunk(false) when the sentinel scrolls into view
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
    if (sortKey === 'age')           diff = n(a.age) - n(b.age)
    else if (sortKey === 'bodyweightKg') diff = n(a.bodyweightKg) - n(b.bodyweightKg)
    else diff = n((a as any)[sortKey]) - n((b as any)[sortKey])
    return sortDir === 'desc' ? -diff : diff
  })

  const toggleHistory = async (row: RankRow, key: string) => {
    if (expanded === key) { setExpanded(null); setHistRows([]); return }
    setExpanded(key); setLoadingHist(true); setHistError('')
    try {
      // Step 1: collect all row indices for this lifter via sequential search calls
      const indices: number[] = []
      let searchStart = 0
      while (indices.length < 150) {
        const sq = new URLSearchParams({ q: row.name, start: String(searchStart), end: '999999' })
        try {
          const sdata = await oplFetch(opl('/api/search/rankings?' + sq.toString()))
          if (sdata?.next_index == null) break
          indices.push(Number(sdata.next_index))
          searchStart = Number(sdata.next_index) + 1
          await sleep(100)
        } catch { break }
      }
      if (indices.length === 0) { setHistRows([]); return }
      // Step 2: fetch rows one at a time with a small delay to stay under rate limits
      const allRows: RankRow[] = []
      const BASE_Q = { lang: 'en', units: 'kg' } as const
      for (const idx of indices) {
        const rq = new URLSearchParams({ ...BASE_Q, start: String(idx), end: String(idx) })
        try {
          const data = await oplFetch(opl('/api/rankings?' + rq.toString()))
          allRows.push(...parseRows(data))
          await sleep(100)
        } catch { /* skip failed row */ }
      }
      const nl = row.name.toLowerCase()
      setHistRows(allRows.filter(r => r.name.toLowerCase() === nl).sort((a, b) => b.date.localeCompare(a.date)))
    } catch { setHistError('Could not load competition history.') }
    finally { setLoadingHist(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#10131a', color: '#fff', fontFamily: 'inherit' }}>

      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(10,31,60,0.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #1c3255', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}><img src={BASE + 'logo.svg'} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }}/></a>
        <span style={{ color: '#112038' }}>›</span>
        <span style={{ color: '#444', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Rankings</span>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3.5rem 1.5rem 6rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{ color: '#c8102e', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Powered by OpenPowerlifting</p>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05, marginBottom: '.75rem' }}>Powerlifting Rankings</h1>
          <p style={{ color: '#555', fontSize: '.875rem', maxWidth: 560, lineHeight: 1.7 }}>Browse ranked results from 3M+ competition entries worldwide. Filter by federation, equipment, sex, weight class and more.</p>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div style={{ background: '#0c1827', border: '1px solid #112038', borderRadius: '.4rem', padding: '1.25rem 1.5rem', marginBottom: '1.75rem' }}>
          <p style={{ color: '#243650', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Filters</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={LBL}>Lifter Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="e.g. John Haack" maxLength={80}
                style={{ ...SEL, boxSizing: 'border-box' }} />
            </div>
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
              <label style={LBL}>Year</label>
              <select value={year} onChange={e => setYear(e.target.value)} style={SEL}>
                {YEARS.map(y => <option key={y.value} value={y.value}>{y.label}</option>)}
              </select>
            </div>
          </div>

          {/* Unit toggle + search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#0a1f3c', border: '1px solid #152842', borderRadius: '.3rem', overflow: 'hidden' }}>
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
              background: loading ? '#0a1f3c' : '#c8102e', color: loading ? '#3a3f47' : '#fff',
              border: 'none', borderRadius: '.3rem', padding: '.6rem 2rem',
              fontWeight: 900, fontSize: '.65rem', letterSpacing: '.15em',
              textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>{loading ? 'Loading…' : 'Browse Rankings'}</button>
            {searched && !loading && (
              <span style={{ color: '#243650', fontSize: '.72rem', marginLeft: 'auto' }}>
                {rows.length.toLocaleString()} loaded
                {!name.trim() && totalHint > 0 && (
                  <span style={{ color: '#112038' }}> / {totalHint.toLocaleString()} total</span>
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
          <div style={{ overflowX: 'auto', border: '1px solid #0a1f3c', borderRadius: '.35rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #0a1f3c' }}>
                  {([
                    ['#',                  null],
                    ['Name',               null],
                    ['Fed',                null],
                    ['Sex',                null],
                    ['Equip',              null],
                    ['Wt Class',           null],
                    ['BW',                 'bodyweightKg'],
                    ['Age',                'age'],
                    ['Squat (' + unit + ')','best3SquatKg'],
                    ['Bench (' + unit + ')','best3BenchKg'],
                    ['Dead ('  + unit + ')','best3DeadliftKg'],
                    ['Total (' + unit + ')','totalKg'],
                    ['Dots',               'dots'],
                    ['Date',               null],
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
                {sortedRows.map((row, i) => {
                  const rk = row.name + '|' + i
                  const isExp = expanded === rk
                  return (
                    <>
                      <tr key={rk}
                        style={{ borderBottom: '1px solid #0c1827', cursor: 'pointer', background: isExp ? '#0e0e0e' : 'transparent' }}
                        onClick={() => toggleHistory(row, rk)}
                        onMouseEnter={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = '#0e1c30' }}
                        onMouseLeave={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                      >
                        <td style={{ ...TD, color: '#3a3f47', width: 36 }}>{i + 1}</td>
                        <td style={{ ...TD, color: '#c8102e', fontWeight: 700, minWidth: 160 }}>
                          {row.name}<span style={{ color: '#112038', marginLeft: 6, fontSize: '.6rem' }}>{isExp ? '▲' : '▼'}</span>
                        </td>
                        <td style={{ ...TD, color: '#555' }}>{row.federation || '—'}</td>
                        <td style={{ ...TD, color: '#444' }}>{row.sex || '—'}</td>
                        <td style={{ ...TD, color: '#555' }}>{row.equipment || '—'}</td>
                        <td style={{ ...TD, color: '#555' }}>{row.weightClassKg ? (unit === 'lbs' ? Math.round(toNum(row.weightClassKg) * 2.20462) + 'lbs' : row.weightClassKg + 'kg') : '—'}</td>
                        <td style={{ ...TD, color: '#444' }}>{row.bodyweightKg ? fmt(row.bodyweightKg, unit) + (unit === 'lbs' ? 'lbs' : 'kg') : '—'}</td>
                        <td style={{ ...TD, color: '#444' }}>{row.age ? row.age.replace('~','') : '—'}</td>
                        <td style={{ ...TD, color: toNum(row.best3SquatKg) > 0 ? '#aaa' : '#1c3255' }}>{fmt(row.best3SquatKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.best3BenchKg) > 0 ? '#aaa' : '#1c3255' }}>{fmt(row.best3BenchKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.best3DeadliftKg) > 0 ? '#aaa' : '#1c3255' }}>{fmt(row.best3DeadliftKg, unit)}</td>
                        <td style={{ ...TD, color: toNum(row.totalKg) > 0 ? '#fff' : '#1c3255', fontWeight: 700 }}>{fmt(row.totalKg, unit)}</td>
                        <td style={{ ...TD, color: '#444' }}>{fmtScore(row.dots)}</td>
                        <td style={{ ...TD, color: '#3a3f47' }}>{row.date || '—'}</td>
                      </tr>

                      {isExp && (
                        <tr key={'hist-' + rk} style={{ background: '#10131a' }}>
                          <td colSpan={14} style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #0e1c30' }}>
                            {loadingHist && <p style={{ color: '#243650', fontSize: '.75rem' }}>Loading competition history…</p>}
                            {histError  && <p style={{ color: '#f87171',  fontSize: '.75rem' }}>{histError}</p>}
                            {!loadingHist && !histError && histRows.length > 0 && (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
                                  <p style={{ color: '#444', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>
                                    {row.name} — {histRows.length} entries
                                  </p>
                                  <a href={'https://www.openpowerlifting.org/u/' + row.slug}
                                    target="_blank" rel="noopener noreferrer"
                                    style={{ color: '#c8102e', fontSize: '.65rem', textDecoration: 'none' }}
                                    onClick={e => e.stopPropagation()}>View on OPL ↗</a>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.73rem' }}>
                                    <thead>
                                      <tr>
                                        {['Date', 'Meet', 'Fed', 'Equip', 'Div', 'Wt', 'BW',
                                          'SQ (' + unit + ')', 'BP (' + unit + ')', 'DL (' + unit + ')',
                                          'Total (' + unit + ')', 'Dots', 'Place'].map(h => (
                                          <th key={h} style={{ ...TH, fontSize: '.5rem', background: '#0c1827' }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {histRows.map((hr, hi) => (
                                        <tr key={hi} style={{ borderBottom: '1px solid #0e1c30' }}>
                                          <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.date || '—'}</td>
                                          <td style={{ ...TD, color: '#999', fontSize: '.72rem', minWidth: 140 }}>{hr.meetName || '—'}</td>
                                          <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.federation || '—'}</td>
                                          <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.equipment || '—'}</td>
                                          <td style={{ ...TD, color: '#3a3f47', fontSize: '.72rem' }}>{hr.division || '—'}</td>
                                          <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.weightClassKg ? (unit === 'lbs' ? Math.round(toNum(hr.weightClassKg) * 2.20462) + 'lbs' : hr.weightClassKg + 'kg') : '—'}</td>
                                          <td style={{ ...TD, color: '#3a3f47', fontSize: '.72rem' }}>{hr.bodyweightKg ? fmt(hr.bodyweightKg, unit) + (unit === 'lbs' ? 'lbs' : 'kg') : '—'}</td>
                                          <td style={{ ...TD, color: toNum(hr.best3SquatKg) > 0 ? '#aaa' : '#1c3255', fontSize: '.72rem' }}>{fmt(hr.best3SquatKg, unit)}</td>
                                          <td style={{ ...TD, color: toNum(hr.best3BenchKg) > 0 ? '#aaa' : '#1c3255', fontSize: '.72rem' }}>{fmt(hr.best3BenchKg, unit)}</td>
                                          <td style={{ ...TD, color: toNum(hr.best3DeadliftKg) > 0 ? '#aaa' : '#1c3255', fontSize: '.72rem' }}>{fmt(hr.best3DeadliftKg, unit)}</td>
                                          <td style={{ ...TD, color: toNum(hr.totalKg) > 0 ? '#fff' : '#1c3255', fontWeight: 700, fontSize: '.72rem' }}>{fmt(hr.totalKg, unit)}</td>
                                          <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{fmtScore(hr.dots)}</td>
                                          <td style={{ ...TD, fontWeight: 700, color: hr.place === '1' ? '#c8102e' : '#666', fontSize: '.72rem' }}>
                                            {hr.place === '1' ? '🥇 1' : (hr.place || '—')}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                            {!loadingHist && !histError && histRows.length === 0 && (
                              <p style={{ color: '#3a3f47', fontSize: '.75rem' }}>No competition history found.</p>
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
              <div style={{ textAlign: 'center', padding: '2rem 0', color: '#243650', fontSize: '.75rem', letterSpacing: '.1em' }}>
                Loading more…
              </div>
            )}
            {!loadingMore && !hasMore && rows.length > 0 && (
              <div style={{ textAlign: 'center', padding: '1.75rem 0', color: '#112038', fontSize: '.68rem', letterSpacing: '.15em', textTransform: 'uppercase' }}>
                — {rows.length.toLocaleString()} results —
              </div>
            )}
          </>
        )}

        {/* Pre-search state */}
        {!searched && !loading && (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <div style={{ fontSize: 44, marginBottom: '1.25rem' }}>🏋️</div>
            <p style={{ color: '#243650', fontSize: '.875rem', marginBottom: '.5rem' }}>Set your filters and click Browse Rankings.</p>
            <p style={{ color: '#112038', fontSize: '.75rem' }}>All filters optional — browse the full database or narrow by federation, equipment, and more.</p>
          </div>
        )}
        {searched && !loading && rows.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: '#243650', fontSize: '.875rem' }}>
            No results. Try broadening your filters.
          </div>
        )}

        {/* Attribution */}
        <div style={{ marginTop: '4rem', paddingTop: '1.25rem', borderTop: '1px solid #0e1c30', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', fontSize: '.65rem', color: '#152842' }}>
          <span>Data © OpenPowerlifting contributors — CC BY 4.0 + ODbL</span>
          <a href="https://www.openpowerlifting.org" target="_blank" rel="noopener noreferrer" style={{ color: '#243650', textDecoration: 'none' }}>openpowerlifting.org ↗</a>
        </div>
      </div>
    </div>
  )
}
