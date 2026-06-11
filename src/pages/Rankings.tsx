import { useState, useCallback, useRef } from 'react'
import { href } from '../utils/nav'

const BASE = (import.meta as any).env?.BASE_URL ?? '/'

// ── OPL API types ─────────────────────────────────────────────────────────
// OPL search returns an array of lifter name strings
// OPL lifter history is fetched via their rankings endpoint filtered by name

interface OPLEntry {
  name: string
  federation: string
  date: string
  country: string
  state: string
  meetName: string
  division: string
  weightClassKg: string | number
  bodyweightKg: string | number
  equipment: string
  best3SquatKg: string | number
  best3BenchKg: string | number
  best3DeadliftKg: string | number
  totalKg: string | number
  place: string
  dots: string | number
  wilks: string | number
  age: string | number
  sex: string
}

// ── Helpers ───────────────────────────────────────────────────────────────
function toNum(v: string | number | undefined): number {
  if (v === undefined || v === null || v === '') return 0
  return typeof v === 'number' ? v : parseFloat(v) || 0
}

function fmtKg(v: string | number | undefined): string {
  const n = toNum(v)
  return n > 0 ? `${n} kg` : '—'
}

function fmtLbs(v: string | number | undefined): string {
  const n = toNum(v)
  return n > 0 ? `${Math.round(n * 2.20462)} lbs` : '—'
}

function fmtVal(v: string | number | undefined): string {
  if (v === undefined || v === null || v === '') return '—'
  const s = String(v).trim()
  return s === '' || s === '0' ? '—' : s
}

const lbl: React.CSSProperties = {
  color: '#e63e3e', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.15em', textTransform: 'uppercase',
  display: 'block', marginBottom: 4,
}

// ── Component ─────────────────────────────────────────────────────────────
export default function Rankings() {
  const [query, setQuery]           = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSug, setLoadingSug] = useState(false)
  const [entries, setEntries]       = useState<OPLEntry[]>([])
  const [lifterName, setLifterName] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [unit, setUnit]             = useState<'lbs' | 'kg'>('lbs')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [searched, setSearched]     = useState(false)
  const [showSug, setShowSug]       = useState(false)

  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const w = useCallback((v: string | number | undefined) =>
    unit === 'kg' ? fmtKg(v) : fmtLbs(v), [unit])

  // Autocomplete suggestions via OPL search endpoint
  const onQueryChange = (val: string) => {
    setQuery(val)
    if (sugTimer.current) clearTimeout(sugTimer.current)
    if (val.trim().length < 2) { setSuggestions([]); return }
    sugTimer.current = setTimeout(async () => {
      setLoadingSug(true)
      try {
        const res = await fetch(
          `https://www.openpowerlifting.org/api/search/rankings?q=${encodeURIComponent(val.trim())}&lang=en&units=lbs`,
          { headers: { Accept: 'application/json' } }
        )
        if (res.ok) {
          const data = await res.json()
          // OPL returns { names: string[] }
          setSuggestions((data?.names ?? []).slice(0, 8))
          setShowSug(true)
        }
      } catch { /* silently ignore autocomplete errors */ }
      finally { setLoadingSug(false) }
    }, 300)
  }

  // Fetch full competition history for a lifter name
  const fetchLifter = useCallback(async (name: string) => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    setEntries([])
    setLifterName(name)
    setSearched(true)
    setShowSug(false)
    setSuggestions([])

    try {
      // OPL rankings endpoint filtered to a specific lifter name
      const slug = name.trim().replace(/\s+/g, '-').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const url = `https://www.openpowerlifting.org/api/rankings?start=0&end=500&q=${encodeURIComponent(name.trim())}&lang=en&units=lbs`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`API error (${res.status}) — try again shortly.`)
      const data = await res.json()

      // OPL rankings response: { rows: [...], fieldnames: [...] }
      const fields: string[] = data?.fieldnames ?? []
      const rows: unknown[][] = data?.rows ?? []

      if (fields.length === 0 || rows.length === 0) {
        // Fallback: try the lifter-specific endpoint
        const res2 = await fetch(
          `https://www.openpowerlifting.org/u/${encodeURIComponent(slug)}/csv`,
          { headers: { Accept: 'text/csv' } }
        )
        if (!res2.ok) throw new Error('No lifter found with that name. Check spelling and try again.')
        const csv = await res2.text()
        const parsed = parseCSV(csv, name)
        if (parsed.length === 0) throw new Error('No competition records found for this lifter.')
        setEntries(parsed)
        return
      }

      const idx = (col: string) => fields.findIndex(f => f.toLowerCase() === col.toLowerCase())
      const get = (row: unknown[], col: string): string => {
        const i = idx(col)
        return i >= 0 ? String((row as string[])[i] ?? '') : ''
      }

      // Filter rows to only this lifter (exact name match, case-insensitive)
      const nameLower = name.trim().toLowerCase()
      const mapped: OPLEntry[] = rows
        .filter(row => get(row, 'Name').toLowerCase() === nameLower)
        .map(row => ({
          name:            get(row, 'Name'),
          federation:      get(row, 'Federation'),
          date:            get(row, 'Date'),
          country:         get(row, 'Country'),
          state:           get(row, 'State'),
          meetName:        get(row, 'MeetName'),
          division:        get(row, 'Division'),
          weightClassKg:   get(row, 'WeightClassKg'),
          bodyweightKg:    get(row, 'BodyweightKg'),
          equipment:       get(row, 'Equipment'),
          best3SquatKg:    get(row, 'Best3SquatKg'),
          best3BenchKg:    get(row, 'Best3BenchKg'),
          best3DeadliftKg: get(row, 'Best3DeadliftKg'),
          totalKg:         get(row, 'TotalKg'),
          place:           get(row, 'Place'),
          dots:            get(row, 'Dots'),
          wilks:           get(row, 'Wilks'),
          age:             get(row, 'Age'),
          sex:             get(row, 'Sex'),
        }))
        .sort((a, b) => b.date.localeCompare(a.date))

      if (mapped.length === 0) throw new Error('No competition records found for this lifter.')
      setEntries(mapped)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSearch = () => fetchLifter(query)

  // Best competition entry (highest total)
  const best = entries.reduce<OPLEntry | null>((acc, e) =>
    toNum(e.totalKg) > toNum(acc?.totalKg) ? e : acc, null)

  const statBox = (label: string, val: string) => (
    <div key={label} style={{ textAlign: 'center', minWidth: 80 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: '#e63e3e', lineHeight: 1.1 }}>{val}</div>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>{label}</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'inherit' }}>

      {/* Mini nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(5,5,5,0.96)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #111', padding: '0 2rem', display: 'flex', alignItems: 'center', height: '3.5rem', gap: '1.5rem' }}>
        <a href={href('/')}>
          <img src={`${BASE}logo.svg`} alt="Axis" style={{ height: 22, filter: 'brightness(0) invert(1)' }} />
        </a>
        <span style={{ color: '#1a1a1a' }}>›</span>
        <span style={{ color: '#444', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>Rankings</span>
      </nav>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '4rem 1.5rem 6rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '3rem' }}>
          <p style={lbl}>Powered by OpenPowerlifting</p>
          <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 900, textTransform: 'uppercase', lineHeight: 1.05, marginBottom: '1rem' }}>
            Lifter Records
          </h1>
          <p style={{ color: '#666', fontSize: '.95rem', maxWidth: 540, lineHeight: 1.7 }}>
            Search any powerlifter's full competition history — 3&nbsp;million+ entries updated continuously from meets worldwide.
          </p>
        </div>

        {/* Search */}
        <div style={{ display: 'flex', gap: '.75rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
            <input
              type="text"
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              onFocus={() => suggestions.length > 0 && setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              placeholder="Lifter name…"
              maxLength={80}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0d0d0d', border: '1px solid #1e1e1e',
                borderRadius: '.35rem', padding: '.875rem 1rem',
                color: '#fff', fontSize: '.9rem', outline: 'none', fontFamily: 'inherit',
              }}
            />
            {/* Autocomplete dropdown */}
            {showSug && suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                background: '#111', border: '1px solid #1e1e1e', borderRadius: '.35rem',
                zIndex: 100, overflow: 'hidden',
              }}>
                {suggestions.map(s => (
                  <button key={s} onMouseDown={() => { setQuery(s); fetchLifter(s) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: 'none', border: 'none', padding: '.75rem 1rem',
                      color: '#ccc', fontSize: '.875rem', cursor: 'pointer',
                      borderBottom: '1px solid #0d0d0d', fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >{s}</button>
                ))}
              </div>
            )}
          </div>

          {/* kg / lbs toggle */}
          <div style={{ display: 'flex', background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '.35rem', overflow: 'hidden', flexShrink: 0 }}>
            {(['lbs', 'kg'] as const).map(u => (
              <button key={u} onClick={() => setUnit(u)} style={{
                padding: '.875rem 1.25rem', border: 'none', cursor: 'pointer',
                background: unit === u ? '#e63e3e' : 'transparent',
                color: unit === u ? '#fff' : '#555',
                fontWeight: 700, fontSize: '.65rem', letterSpacing: '.1em',
                textTransform: 'uppercase', fontFamily: 'inherit', transition: 'all .15s',
              }}>{u}</button>
            ))}
          </div>

          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            style={{
              background: loading ? '#1a1a1a' : '#e63e3e',
              color: loading ? '#555' : '#fff', border: 'none', borderRadius: '.35rem',
              padding: '.875rem 2rem', fontWeight: 900, fontSize: '.7rem',
              letterSpacing: '.15em', textTransform: 'uppercase',
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'background .15s', flexShrink: 0,
            }}
          >{loading ? 'Searching…' : 'Search'}</button>
        </div>

        {/* Autocomplete loading indicator */}
        {loadingSug && (
          <p style={{ color: '#2a2a2a', fontSize: '.75rem', marginBottom: '1rem' }}>Looking up names…</p>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: '#150505', border: '1px solid #4a1010', borderRadius: '.35rem', padding: '.875rem 1.25rem', color: '#f87171', fontSize: '.85rem', marginBottom: '1.5rem' }}>
            {error}
            {error.includes('CORS') || error.includes('fetch') || error.includes('network') ? (
              <p style={{ marginTop: '.5rem', color: '#a05050', fontSize: '.75rem' }}>
                This is likely a browser security restriction. Try searching directly on{' '}
                <a href="https://www.openpowerlifting.org" target="_blank" rel="noopener noreferrer" style={{ color: '#e63e3e' }}>openpowerlifting.org</a>.
              </p>
            ) : null}
          </div>
        )}

        {/* Lifter results */}
        {entries.length > 0 && (
          <>
            {/* Summary card */}
            <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '.5rem', padding: '1.75rem 2rem', marginBottom: '2rem', display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <h2 style={{ fontSize: 'clamp(1.25rem, 3vw, 2rem)', fontWeight: 900, textTransform: 'uppercase', marginBottom: '.25rem' }}>{lifterName}</h2>
                <p style={{ color: '#444', fontSize: '.75rem' }}>
                  {entries.length} competition{entries.length !== 1 ? 's' : ''} on record
                  {entries[0]?.federation ? ` · ${entries[0].federation}` : ''}
                </p>
              </div>
              {best && (
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  {statBox('Best Squat', w(best.best3SquatKg))}
                  {statBox('Best Bench', w(best.best3BenchKg))}
                  {statBox('Best Dead', w(best.best3DeadliftKg))}
                  {statBox('Best Total', w(best.totalKg))}
                  {toNum(best.dots) > 0 && statBox('Dots', parseFloat(String(best.dots)).toFixed(2))}
                </div>
              )}
            </div>

            {/* Table */}
            <p style={{ color: '#333', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.75rem' }}>
              Competition History — click any row for details
            </p>
            <div style={{ overflowX: 'auto', border: '1px solid #111', borderRadius: '.35rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #111' }}>
                    {['Date', 'Meet', 'Fed', 'Equip', 'Wt Class', 'Squat', 'Bench', 'Dead', 'Total', 'Dots', 'Place'].map(h => (
                      <th key={h} style={{ padding: '.75rem .875rem', textAlign: 'left', color: '#333', fontSize: '.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap', background: '#080808' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const isExp = expandedRow === i
                    const hasTotal = toNum(e.totalKg) > 0
                    return (
                      <>
                        <tr key={i}
                          onClick={() => setExpandedRow(isExp ? null : i)}
                          style={{ borderBottom: '1px solid #0d0d0d', cursor: 'pointer', background: isExp ? '#111' : 'transparent', transition: 'background .1s' }}
                          onMouseEnter={ev => { if (!isExp) (ev.currentTarget as HTMLElement).style.background = '#0d0d0d' }}
                          onMouseLeave={ev => { if (!isExp) (ev.currentTarget as HTMLElement).style.background = 'transparent' }}
                        >
                          <td style={{ padding: '.75rem .875rem', color: '#666', whiteSpace: 'nowrap' }}>{fmtVal(e.date)}</td>
                          <td style={{ padding: '.75rem .875rem', color: '#ccc', fontWeight: 600, minWidth: 160 }}>{fmtVal(e.meetName)}</td>
                          <td style={{ padding: '.75rem .875rem', color: '#555', whiteSpace: 'nowrap' }}>{fmtVal(e.federation)}</td>
                          <td style={{ padding: '.75rem .875rem', color: '#555', whiteSpace: 'nowrap' }}>{fmtVal(e.equipment)}</td>
                          <td style={{ padding: '.75rem .875rem', color: '#555', whiteSpace: 'nowrap' }}>{fmtVal(e.weightClassKg)}{String(e.weightClassKg) !== '—' && e.weightClassKg ? 'kg' : ''}</td>
                          <td style={{ padding: '.75rem .875rem', color: toNum(e.best3SquatKg) > 0 ? '#ccc' : '#2a2a2a', whiteSpace: 'nowrap' }}>{w(e.best3SquatKg)}</td>
                          <td style={{ padding: '.75rem .875rem', color: toNum(e.best3BenchKg) > 0 ? '#ccc' : '#2a2a2a', whiteSpace: 'nowrap' }}>{w(e.best3BenchKg)}</td>
                          <td style={{ padding: '.75rem .875rem', color: toNum(e.best3DeadliftKg) > 0 ? '#ccc' : '#2a2a2a', whiteSpace: 'nowrap' }}>{w(e.best3DeadliftKg)}</td>
                          <td style={{ padding: '.75rem .875rem', fontWeight: 700, color: hasTotal ? '#e63e3e' : '#2a2a2a', whiteSpace: 'nowrap' }}>{w(e.totalKg)}</td>
                          <td style={{ padding: '.75rem .875rem', color: '#555' }}>{toNum(e.dots) > 0 ? parseFloat(String(e.dots)).toFixed(2) : '—'}</td>
                          <td style={{ padding: '.75rem .875rem', fontWeight: 700, color: e.place === '1' ? '#e63e3e' : '#888', whiteSpace: 'nowrap' }}>
                            {e.place === '1' && <span style={{ marginRight: 4 }}>🥇</span>}{fmtVal(e.place)}
                          </td>
                        </tr>
                        {isExp && (
                          <tr key={`exp-${i}`} style={{ background: '#0a0a0a' }}>
                            <td colSpan={11} style={{ padding: '1rem 1.25rem' }}>
                              <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                                {[
                                  { label: 'Bodyweight', val: fmtVal(e.bodyweightKg) + (e.bodyweightKg ? ' kg' : '') },
                                  { label: 'Age', val: fmtVal(e.age) },
                                  { label: 'Division', val: fmtVal(e.division) },
                                  { label: 'Country', val: fmtVal(e.country) },
                                  { label: 'State / Region', val: fmtVal(e.state) },
                                  { label: 'Wilks', val: toNum(e.wilks) > 0 ? parseFloat(String(e.wilks)).toFixed(2) : '—' },
                                ].map(d => (
                                  <div key={d.label}>
                                    <div style={{ color: '#333', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 3, fontWeight: 700 }}>{d.label}</div>
                                    <div style={{ color: '#aaa', fontWeight: 600, fontSize: '.8rem' }}>{d.val}</div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Empty / pre-search state */}
        {searched && !loading && entries.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '5rem 0', color: '#2a2a2a', fontSize: '.875rem' }}>No results found.</div>
        )}
        {!searched && (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <div style={{ fontSize: 48, marginBottom: '1rem' }}>🏋️</div>
            <p style={{ color: '#333', fontSize: '.875rem' }}>Search any lifter by name to pull their full competition history.</p>
            <p style={{ color: '#1e1e1e', fontSize: '.75rem', marginTop: '.5rem' }}>Data sourced from OpenPowerlifting · Updated within days of each meet</p>
          </div>
        )}

        {/* Attribution */}
        <div style={{ marginTop: '4rem', paddingTop: '1.5rem', borderTop: '1px solid #0d0d0d', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', fontSize: '.7rem', color: '#2a2a2a' }}>
          <span>Data © OpenPowerlifting contributors, licensed under CC BY 4.0 + ODbL</span>
          <a href="https://www.openpowerlifting.org" target="_blank" rel="noopener noreferrer" style={{ color: '#333', textDecoration: 'none' }}>openpowerlifting.org ↗</a>
        </div>
      </div>
    </div>
  )
}

// ── CSV parser for fallback lifter endpoint ─────────────────────────────────
function parseCSV(csv: string, _lifterName: string): OPLEntry[] {
  const lines = csv.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const idx = (col: string) => headers.findIndex(h => h.toLowerCase() === col.toLowerCase())
  const get = (row: string[], col: string): string => {
    const i = idx(col)
    if (i < 0) return ''
    const v = (row[i] ?? '').trim().replace(/^"|"$/g, '')
    return v === 'NA' || v === 'None' ? '' : v
  }
  return lines.slice(1)
    .map(line => {
      const row = line.split(',')
      return {
        name:            get(row, 'Name'),
        federation:      get(row, 'Federation'),
        date:            get(row, 'Date'),
        country:         get(row, 'Country'),
        state:           get(row, 'State'),
        meetName:        get(row, 'MeetName'),
        division:        get(row, 'Division'),
        weightClassKg:   get(row, 'WeightClassKg'),
        bodyweightKg:    get(row, 'BodyweightKg'),
        equipment:       get(row, 'Equipment'),
        best3SquatKg:    get(row, 'Best3SquatKg'),
        best3BenchKg:    get(row, 'Best3BenchKg'),
        best3DeadliftKg: get(row, 'Best3DeadliftKg'),
        totalKg:         get(row, 'TotalKg'),
        place:           get(row, 'Place'),
        dots:            get(row, 'Dots'),
        wilks:           get(row, 'Wilks'),
        age:             get(row, 'Age'),
        sex:             get(row, 'Sex'),
      } as OPLEntry
    })
    .filter(e => e.name || e.meetName)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}
