import { useState, useEffect, useCallback } from 'react'
import {
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  monthlyExpenseTotals, money, EXPENSE_CATEGORIES,
} from '../../lib/store'
import type { Expense, ExpenseInput } from '../../lib/store'
import { usePermissions } from '../../lib/usePermissions'

const ACCENT = '#272C84'

const todayISO = () => new Date().toISOString().slice(0, 10)

/** Parse a dollar string into integer cents. Returns null on anything invalid. */
function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Math.round(parseFloat(cleaned) * 100)
}

interface FormState { description: string; amount: string; category: string; incurredOn: string; note: string }

const EMPTY_FORM: FormState = { description: '', amount: '', category: EXPENSE_CATEGORIES[0], incurredOn: todayISO(), note: '' }

export default function ExpensesPanel({ isDemo = false }: { isDemo?: boolean }) {
  const { can } = usePermissions()
  const canManage = can('manage_expenses')

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [form, setForm]         = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId]     = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setExpenses(await fetchExpenses(isDemo)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load expenses') }
    finally { setLoading(false) }
  }, [isDemo])

  useEffect(() => { refresh() }, [refresh])

  const resetForm = () => { setForm(EMPTY_FORM); setEditId(null) }

  const submit = async () => {
    setError(null)
    const cents = dollarsToCents(form.amount)
    if (!form.description.trim()) { setError('A description is required.'); return }
    if (cents === null || cents < 0) { setError('Enter a valid amount, e.g. 42.50.'); return }
    if (!form.incurredOn) { setError('Pick a date.'); return }

    const input: ExpenseInput = {
      description: form.description.trim(),
      amountCents: cents,
      category: form.category || null,
      incurredOn: form.incurredOn,
      note: form.note.trim() || null,
    }

    setSaving(true)
    try {
      if (editId) {
        const updated = await updateExpense(editId, input, isDemo)
        setExpenses((prev) => prev.map((e) => (e.id === editId ? updated : e)))
      } else {
        const created = await createExpense(input, isDemo)
        setExpenses((prev) => [created, ...prev])
      }
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the expense')
    } finally { setSaving(false) }
  }

  const startEdit = (e: Expense) => {
    setEditId(e.id)
    setForm({
      description: e.description,
      amount: (e.amountCents / 100).toFixed(2),
      category: e.category ?? '',
      incurredOn: e.incurredOn,
      note: e.note ?? '',
    })
  }

  const remove = async (e: Expense) => {
    if (!confirm(`Delete "${e.description}"? This cannot be undone.`)) return
    setError(null)
    try {
      await deleteExpense(e.id, isDemo)
      setExpenses((prev) => prev.filter((x) => x.id !== e.id))
      if (editId === e.id) resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the expense')
    }
  }

  const total = expenses.reduce((s, e) => s + e.amountCents, 0)
  const months = monthlyExpenseTotals(expenses)

  return (
    <>
      {isDemo && (
        <div style={{ background: '#2d2500', borderBottom: '1px solid #5c4800', padding: '.625rem 2rem', display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <span style={{ color: 'var(--text)', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.25em', textTransform: 'uppercase' }}>Demo Mode</span>
          <span style={{ color: '#7a6500', fontSize: '.75rem' }}>{expenses.length} sample expenses. Edits are in-memory.</span>
        </div>
      )}

      {/* Monthly totals */}
      {!loading && months.length > 0 && (
        <div style={{ padding: '1rem 2rem', borderBottom: '1px solid var(--surface)', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center' }}>
          <div>
            <div style={{ color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase' }}>All-time out</div>
            <div style={{ color: 'var(--text)', fontSize: '1.1rem', fontWeight: 900 }}>{money(total)}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {months.slice(0, 6).map((m) => (
              <span key={m.month} style={{ background: 'rgba(39,44,132,.08)', border: '1px solid rgba(39,44,132,.15)', color: 'var(--text)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.06em', padding: '.25rem .6rem', borderRadius: '.2rem' }}>
                {monthLabel(m.month)} · {money(m.cents)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Entry form */}
      {canManage && (
        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--surface)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', alignItems: 'flex-end' }}>
            <Labeled label="Description" style={{ flex: 2, minWidth: 200 }}>
              <input className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Tee restock, 50 units" />
            </Labeled>
            <Labeled label="Amount" style={{ width: 120 }}>
              <input className="field" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="42.50" inputMode="decimal" />
            </Labeled>
            <Labeled label="Category" style={{ width: 200 }}>
              <select className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Labeled>
            <Labeled label="Date" style={{ width: 160 }}>
              <input className="field" type="date" value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} />
            </Labeled>
          </div>
          <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', marginTop: '.75rem' }}>
            <Labeled label="Note (optional)" style={{ flex: 1 }}>
              <input className="field" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything worth remembering" />
            </Labeled>
            <button
              onClick={submit}
              disabled={saving}
              style={{ background: ACCENT, border: 'none', color: '#fff', fontSize: '.65rem', fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', padding: '.6rem 1.25rem', borderRadius: '.25rem', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              {editId ? 'Save changes' : 'Add expense'}
            </button>
            {editId && (
              <button onClick={resetForm} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: '.65rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.6rem 1rem', borderRadius: '.25rem', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div style={{ margin: '1.5rem 2rem', padding: '.75rem 1rem', background: 'rgba(180,40,40,.08)', border: '1px solid rgba(180,40,40,.25)', borderRadius: '.25rem', color: 'var(--text)', fontSize: '.8rem' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>Loading expenses…</div>
      ) : expenses.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '.8rem' }}>No expenses recorded yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Date', 'Description', 'Category', 'Amount', ''].map((h) => (
                  <th key={h} style={{ padding: '.9rem 1.25rem', textAlign: h === 'Amount' ? 'right' : 'left', color: 'var(--text-3)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--surface-2)' }}>
                  <td style={{ padding: '.85rem 1.25rem', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{new Date(e.incurredOn + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={{ padding: '.85rem 1.25rem', color: 'var(--text)' }}>
                    <div style={{ fontWeight: 600 }}>{e.description}</div>
                    {e.note && <div style={{ color: 'var(--text-3)', fontSize: '.72rem' }}>{e.note}</div>}
                  </td>
                  <td style={{ padding: '.85rem 1.25rem' }}>
                    {e.category && (
                      <span style={{ background: 'rgba(39,44,132,.08)', border: '1px solid rgba(39,44,132,.15)', color: 'var(--text)', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.06em', padding: '.2rem .55rem', borderRadius: '.15rem', whiteSpace: 'nowrap' }}>{e.category}</span>
                    )}
                  </td>
                  <td style={{ padding: '.85rem 1.25rem', color: 'var(--text)', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(e.amountCents)}</td>
                  <td style={{ padding: '.85rem 1.25rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canManage && (
                      <>
                        <button onClick={() => startEdit(e)} style={linkBtn}>Edit</button>
                        <button onClick={() => remove(e)} style={{ ...linkBtn, color: '#b42828' }}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ padding: '.75rem 1.25rem', color: 'var(--text-3)', fontSize: '.7rem' }}>
            {expenses.length} expenses · {money(total)} total
          </p>
        </div>
      )}
    </>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: ACCENT, fontSize: '.7rem', fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', padding: '.2rem .5rem',
}

function Labeled({ label, style, children }: { label: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', ...style }}>
      <span style={{ display: 'block', color: 'var(--text-3)', fontSize: '.55rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.3rem' }}>{label}</span>
      {children}
    </label>
  )
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}
