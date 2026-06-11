import { useState, useCallback, useRef } from 'react'
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
  { value: '', label: 'All Equipment' }, { value: 'Raw', label: 'Raw' },
  { value: 'Wraps', label: 'Wraps' }, { value: 'Single-ply', label: 'Single-ply' },
  { value: 'Multi-ply', label: 'Multi-ply' }, { value: 'Unlimited', label: 'Unlimited' },
  { value: 'Straps', label: 'Straps' },
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

// ── Types ─────────────────────────────────────────────────────────────────
interface RankRow {
  name: string; federation: string; date: string; country: string
  division: string; weightClassKg: string; bodyweightKg: string
  equipment: string; best3SquatKg: string; best3BenchKg: string
  best3DeadliftKg: string; totalKg: string; place: string
  dots: string; wilks: string; age: string; sex: string; meetName: string
}

// ── Helpers ───────────────────────────────────────────────────────────────
const toNum = (v: string | undefined) => parseFloat(v || '0') || 0
const fmt = (v: string | undefined, unit: 'lbs' | 'kg') => {
  const n = toNum(v); if (!n) return '—'
  return unit === 'lbs' ? String(Math.round(n * 2.20462)) : String(n)
}
const fmtScore = (v: string | undefined) => {
  const n = toNum(v); return n > 0 ? n.toFixed(2) : '—'
}
function parseRows(data: { fieldnames?: string[]; rows?: unknown[][] }): RankRow[] {
  const fields: string[] = data?.fieldnames ?? []
  const rows: unknown[][] = data?.rows ?? []
  const idx = (col: string) => fields.findIndex(f => f.toLowerCase() === col.toLowerCase())
  const get = (row: unknown[], col: string) => {
    const i = idx(col); return i >= 0 ? String((row as string[])[i] ?? '') : ''
  }
  return rows.map(row => ({
    name: get(row, 'Name'), federation: get(row, 'Federation'), date: get(row, 'Date'),
    country: get(row, 'Country'), division: get(row, 'Division'),
    weightClassKg: get(row, 'WeightClassKg'), bodyweightKg: get(row, 'BodyweightKg'),
    equipment: get(row, 'Equipment'), best3SquatKg: get(row, 'Best3SquatKg'),
    best3BenchKg: get(row, 'Best3BenchKg'), best3DeadliftKg: get(row, 'Best3DeadliftKg'),
    totalKg: get(row, 'TotalKg'), place: get(row, 'Place'), dots: get(row, 'Dots'),
    wilks: get(row, 'Wilks'), age: get(row, 'Age'), sex: get(row, 'Sex'),
    meetName: get(row, 'MeetName'),
  }))
}

const SEL: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '.3rem',
  color: '#ccc', fontSize: '.78rem', padding: '.65rem .75rem',
  fontFamily: 'inherit', outline: 'none', cursor: 'pointer', width: '100%',
}
const TH: React.CSSProperties = {
  padding: '.6rem .8rem', textAlign: 'left', color: '#333',
  fontSize: '.52rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.1em', whiteSpace: 'nowrap', background: '#080808',
}
const TD: React.CSSProperties = { padding: '.65rem .8rem', fontSize: '.78rem', whiteSpace: 'nowrap' }
const LBL: React.CSSProperties = {
  color: '#333', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em',
  textTransform: 'uppercase', display: 'block', marginBottom: '.4rem',
}
const PAGE_SIZE = 100

// ── Component ─────────────────────────────────────────────────────────────
export default function Rankings() {
  const [name,        setName]        = useState('')
  const [federation,  setFederation]  = useState('')
  const [sex,         setSex]         = useState('')
  const [equipment,   setEquipment]   = useState('')
  const [weightClass, setWeightClass] = useState('')
  const [ageClass,    setAgeClass]    = useState('')
  const [unit,        setUnit]        = useState<'lbs' | 'kg'>('lbs')
  const [rows,        setRows]        = useState<RankRow[]>([])
  const [totalCount,  setTotalCount]  = useState(0)
  const [page,        setPage]        = useState(0)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [searched,    setSearched]    = useState(false)
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [histRows,    setHistRows]    = useState<RankRow[]>([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [histError,   setHistError]   = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const buildParams = useCallback((pg: number) => {
    const p = new URLSearchParams()
    p.set('start', String(pg * PAGE_SIZE))
    p.set('end',   String(pg * PAGE_SIZE + PAGE_SIZE - 1))
    if (name.trim())  p.set('q',            name.trim())
    if (federation)   p.set('federation',    federation)
    if (sex)          p.set('sex',           sex)
    if (equipment)    p.set('equipment',     equipment)
    if (weightClass)  p.set('weightclasskg', weightClass)
    if (ageClass)     p.set('ageclass',      ageClass)
    p.set('lang', 'en'); p.set('units', unit)
    return p.toString()
  }, [name, federation, sex, equipment, weightClass, ageClass, unit])

  const fetchPage = useCallback(async (pg: number) => {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    setLoading(true); setError(''); setExpanded(null); setHistRows([])
    try {
      const res = await fetch(opl('/api/rankings?' + buildParams(pg)), { signal: abortRef.current.signal })
      if (!res.ok) throw new Error('OpenPowerlifting API returned ' + res.status + '. Try adjusting your filters.')
      const data = await res.json()
      const parsed = parseRows(data)
      setRows(parsed)
      setTotalCount(data?.total_length ?? parsed.length)
      setPage(pg); setSearched(true)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Failed to load rankings. Try again.')
    } finally { setLoading(false) }
  }, [buildParams])

  const handleSearch = () => fetchPage(0)

  const toggleHistory = async (row: RankRow, key: string) => {
    if (expanded === key) { setExpanded(null); setHistRows([]); return }
    setExpanded(key); setLoadingHist(true); setHistError('')
    try {
      const p = new URLSearchParams({ start: '0', end: '999', q: row.name, lang: 'en', units: unit })
      const res = await fetch(opl('/api/rankings?' + p.toString()))
      if (!res.ok) throw new Error('API ' + res.status)
      const data = await res.json()
      const all = parseRows(data)
      const nl = row.name.toLowerCase()
      const filtered = all.filter(r => r.name.toLowerCase() === nl)
                          .sort((a, b) => b.date.localeCompare(a.date))
      setHistRows(filtered.length > 0 ? filtered : all.sort((a, b) => b.date.localeCompare(a.date)))
    } catch { setHistError('Could not load competition history.') }
    finally { setLoadingHist(false) }
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)
  const canNext = (page + 1) * PAGE_SIZE < totalCount

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'inherit' }}>

      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(5,5,5,0.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #111', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}><img src={BASE + 'logo.svg'} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }}/></a>
        <span style={{ color: '#1a1a1a' }}>›</span>
        <span style={{ color: '#444', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Rankings</span>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '3.5rem 1.5rem 6rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{ color: '#e63e3e', fontSize: '.62rem', fontWeight: 900, letterSpacing: '.35em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Powered by OpenPowerlifting</p>
          <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05, marginBottom: '.75rem' }}>Powerlifting Rankings</h1>
          <p style={{ color: '#555', fontSize: '.875rem', maxWidth: 560, lineHeight: 1.7 }}>Browse ranked results from 3M+ competition entries worldwide. Filter by federation, equipment, sex, weight class and more.</p>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '.4rem', padding: '1.25rem 1.5rem', marginBottom: '1.75rem' }}>
          <p style={{ color: '#2a2a2a', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', marginBottom: '1rem' }}>Filters</p>
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
          </div>

          {/* Unit toggle + search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', background: '#111', border: '1px solid #1e1e1e', borderRadius: '.3rem', overflow: 'hidden' }}>
              {(['lbs', 'kg'] as const).map(u => (
                <button key={u} onClick={() => setUnit(u)} style={{
                  padding: '.55rem 1.1rem', border: 'none', cursor: 'pointer',
                  background: unit === u ? '#e63e3e' : 'transparent',
                  color: unit === u ? '#fff' : '#444',
                  fontWeight: 700, fontSize: '.62rem', letterSpacing: '.1em',
                  textTransform: 'uppercase', fontFamily: 'inherit',
                }}>{u}</button>
              ))}
            </div>
            <button onClick={handleSearch} disabled={loading} style={{
              background: loading ? '#111' : '#e63e3e', color: loading ? '#333' : '#fff',
              border: 'none', borderRadius: '.3rem', padding: '.6rem 2rem',
              fontWeight: 900, fontSize: '.65rem', letterSpacing: '.15em',
              textTransform: 'uppercase', cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}>{loading ? 'Loading…' : 'Browse Rankings'}</button>
            {searched && !loading && (
              <span style={{ color: '#2a2a2a', fontSize: '.72rem', marginLeft: 'auto' }}>
                {totalCount.toLocaleString()} results
              </span>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#150505', border: '1px solid #4a1010', borderRadius: '.35rem', padding: '.875rem 1.25rem', color: '#f87171', fontSize: '.82rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        {/* ── Results table ─────────────────────────────────────────────── */}
        {rows.length > 0 && (
          <>
            <div style={{ overflowX: 'auto', border: '1px solid #111', borderRadius: '.35rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #111' }}>
                    {['#', 'Name', 'Fed', 'Sex', 'Equip', 'Wt Class',
                      'Squat (' + unit + ')', 'Bench (' + unit + ')', 'Dead (' + unit + ')',
                      'Total (' + unit + ')', 'Dots', 'Date'].map(h => (
                      <th key={h} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const rk = row.name + '|' + i
                    const isExp = expanded === rk
                    const rank = page * PAGE_SIZE + i + 1
                    return (
                      <>
                        <tr key={rk}
                          style={{ borderBottom: '1px solid #0a0a0a', cursor: 'pointer', background: isExp ? '#0e0e0e' : 'transparent' }}
                          onClick={() => toggleHistory(row, rk)}
                          onMouseEnter={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = '#0d0d0d' }}
                          onMouseLeave={ev => { if (!isExp) (ev.currentTarget as HTMLTableRowElement).style.background = 'transparent' }}
                        >
                          <td style={{ ...TD, color: '#333', width: 36 }}>{rank}</td>
                          <td style={{ ...TD, color: '#e63e3e', fontWeight: 700, minWidth: 160 }}>
                            {row.name}<span style={{ color: '#1a1a1a', marginLeft: 6, fontSize: '.6rem' }}>{isExp ? '▲' : '▼'}</span>
                          </td>
                          <td style={{ ...TD, color: '#555' }}>{row.federation || '—'}</td>
                          <td style={{ ...TD, color: '#444' }}>{row.sex || '—'}</td>
                          <td style={{ ...TD, color: '#555' }}>{row.equipment || '—'}</td>
                          <td style={{ ...TD, color: '#555' }}>{row.weightClassKg ? row.weightClassKg + 'kg' : '—'}</td>
                          <td style={{ ...TD, color: toNum(row.best3SquatKg) > 0 ? '#aaa' : '#222' }}>{fmt(row.best3SquatKg, unit)}</td>
                          <td style={{ ...TD, color: toNum(row.best3BenchKg) > 0 ? '#aaa' : '#222' }}>{fmt(row.best3BenchKg, unit)}</td>
                          <td style={{ ...TD, color: toNum(row.best3DeadliftKg) > 0 ? '#aaa' : '#222' }}>{fmt(row.best3DeadliftKg, unit)}</td>
                          <td style={{ ...TD, color: toNum(row.totalKg) > 0 ? '#fff' : '#222', fontWeight: 700 }}>{fmt(row.totalKg, unit)}</td>
                          <td style={{ ...TD, color: '#444' }}>{fmtScore(row.dots)}</td>
                          <td style={{ ...TD, color: '#333' }}>{row.date || '—'}</td>
                        </tr>

                        {isExp && (
                          <tr key={'hist-' + rk} style={{ background: '#080808' }}>
                            <td colSpan={12} style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #0d0d0d' }}>
                              {loadingHist && <p style={{ color: '#2a2a2a', fontSize: '.75rem' }}>Loading competition history…</p>}
                              {histError  && <p style={{ color: '#f87171',  fontSize: '.75rem' }}>{histError}</p>}
                              {!loadingHist && !histError && histRows.length > 0 && (
                                <>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' }}>
                                    <p style={{ color: '#444', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>
                                      {row.name} — {histRows.length} entries
                                    </p>
                                    <a href={'https://www.openpowerlifting.org/lifters/' + row.name.toLowerCase().replace(/\s+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}
                                      target="_blank" rel="noopener noreferrer"
                                      style={{ color: '#e63e3e', fontSize: '.65rem', textDecoration: 'none' }}
                                      onClick={e => e.stopPropagation()}>View on OPL ↗</a>
                                  </div>
                                  <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.73rem' }}>
                                      <thead>
                                        <tr>
                                          {['Date', 'Meet', 'Fed', 'Equip', 'Div', 'Wt', 'BW',
                                            'SQ (' + unit + ')', 'BP (' + unit + ')', 'DL (' + unit + ')',
                                            'Total (' + unit + ')', 'Dots', 'Place'].map(h => (
                                            <th key={h} style={{ ...TH, fontSize: '.5rem', background: '#0a0a0a' }}>{h}</th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {histRows.map((hr, hi) => (
                                          <tr key={hi} style={{ borderBottom: '1px solid #0d0d0d' }}>
                                            <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.date || '—'}</td>
                                            <td style={{ ...TD, color: '#999', fontSize: '.72rem', minWidth: 140 }}>{hr.meetName || '—'}</td>
                                            <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.federation || '—'}</td>
                                            <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.equipment || '—'}</td>
                                            <td style={{ ...TD, color: '#333', fontSize: '.72rem' }}>{hr.division || '—'}</td>
                                            <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{hr.weightClassKg ? hr.weightClassKg + 'kg' : '—'}</td>
                                            <td style={{ ...TD, color: '#333', fontSize: '.72rem' }}>{hr.bodyweightKg ? hr.bodyweightKg + 'kg' : '—'}</td>
                                            <td style={{ ...TD, color: toNum(hr.best3SquatKg) > 0 ? '#aaa' : '#222', fontSize: '.72rem' }}>{fmt(hr.best3SquatKg, unit)}</td>
                                            <td style={{ ...TD, color: toNum(hr.best3BenchKg) > 0 ? '#aaa' : '#222', fontSize: '.72rem' }}>{fmt(hr.best3BenchKg, unit)}</td>
                                            <td style={{ ...TD, color: toNum(hr.best3DeadliftKg) > 0 ? '#aaa' : '#222', fontSize: '.72rem' }}>{fmt(hr.best3DeadliftKg, unit)}</td>
                                            <td style={{ ...TD, color: toNum(hr.totalKg) > 0 ? '#fff' : '#222', fontWeight: 700, fontSize: '.72rem' }}>{fmt(hr.totalKg, unit)}</td>
                                            <td style={{ ...TD, color: '#444', fontSize: '.72rem' }}>{fmtScore(hr.dots)}</td>
                                            <td style={{ ...TD, fontWeight: 700, color: hr.place === '1' ? '#e63e3e' : '#666', fontSize: '.72rem' }}>
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
                                <p style={{ color: '#333', fontSize: '.75rem' }}>No competition history found.</p>
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

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', flexWrap: 'wrap', gap: '.75rem' }}>
              <button onClick={() => fetchPage(page - 1)} disabled={page === 0 || loading} style={{
                background: page === 0 ? '#0a0a0a' : '#1a1a1a', border: '1px solid #1e1e1e',
                color: page === 0 ? '#222' : '#888', borderRadius: '.3rem', padding: '.55rem 1.25rem',
                fontWeight: 700, fontSize: '.65rem', letterSpacing: '.1em', textTransform: 'uppercase',
                cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>← Prev</button>
              <span style={{ color: '#333', fontSize: '.72rem' }}>
                Page {page + 1}{totalPages > 0 ? ' of ' + totalPages.toLocaleString() : ''}
                <span style={{ color: '#1e1e1e', marginLeft: '1rem' }}>{totalCount.toLocaleString()} total</span>
              </span>
              <button onClick={() => fetchPage(page + 1)} disabled={!canNext || loading} style={{
                background: !canNext ? '#0a0a0a' : '#1a1a1a', border: '1px solid #1e1e1e',
                color: !canNext ? '#222' : '#888', borderRadius: '.3rem', padding: '.55rem 1.25rem',
                fontWeight: 700, fontSize: '.65rem', letterSpacing: '.1em', textTransform: 'uppercase',
                cursor: !canNext ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}>Next →</button>
            </div>
          </>
        )}

        {/* Pre-search state */}
        {!searched && !loading && (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <div style={{ fontSize: 44, marginBottom: '1.25rem' }}>🏋️</div>
            <p style={{ color: '#2a2a2a', fontSize: '.875rem', marginBottom: '.5rem' }}>Set your filters and click Browse Rankings.</p>
            <p style={{ color: '#1a1a1a', fontSize: '.75rem' }}>All filters optional — browse the full database or narrow by federation, equipment, and more.</p>
          </div>
        )}
        {searched && !loading && rows.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: '#2a2a2a', fontSize: '.875rem' }}>
            No results. Try broadening your filters.
          </div>
        )}

        {/* Attribution */}
        <div style={{ marginTop: '4rem', paddingTop: '1.25rem', borderTop: '1px solid #0d0d0d', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', fontSize: '.65rem', color: '#1e1e1e' }}>
          <span>Data © OpenPowerlifting contributors — CC BY 4.0 + ODbL</span>
          <a href="https://www.openpowerlifting.org" target="_blank" rel="noopener noreferrer" style={{ color: '#2a2a2a', textDecoration: 'none' }}>openpowerlifting.org ↗</a>
        </div>
      </div>
    </div>
  )
}
