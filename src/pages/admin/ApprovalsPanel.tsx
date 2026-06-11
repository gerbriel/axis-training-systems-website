import { useState, useEffect, useCallback } from 'react'
import { fetchAllContent, reviewContent, removeContent, submitContent, updateContent } from '../../lib/contentApi'
import type { PendingContent, ContentStatus } from '../../data/pendingContent'
import { sanitize } from '../../utils/sanitize'

const STATUS_COLORS: Record<ContentStatus, string> = {
  pending:  '#f59e0b',
  approved: '#22c55e',
  rejected: '#e63e3e',
}
const lbl: React.CSSProperties = {
  color: '#555', fontSize: '.6rem', fontWeight: 700,
  letterSpacing: '.15em', textTransform: 'uppercase',
  marginBottom: '.35rem', display: 'block',
}
const inp: React.CSSProperties = {
  background: '#0d0d0d', border: '1px solid #222', borderRadius: '.2rem',
  color: '#fff', fontSize: '.875rem', fontWeight: 500,
  padding: '.65rem .875rem', outline: 'none',
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}

type SectionType = 'paragraph' | 'heading' | 'subheading' | 'list' | 'callout' | 'week' | 'divider'
interface EditorSection { _id: string; type: SectionType; text?: string; items?: string; label?: string }
function uid() { return Math.random().toString(36).slice(2, 12) }
function defaultSections(): EditorSection[] { return [{ _id: uid(), type: 'paragraph', text: '' }] }

function serializeSections(sections: EditorSection[]): string {
  return JSON.stringify(sections.map(({ _id: _i, ...s }) => {
    if (s.type === 'list' || s.type === 'week') return { ...s, items: (s.items ?? '').split('\n').map((i: string) => i.trim()).filter(Boolean) }
    return s
  }))
}

function deserializeSections(raw: string | undefined): EditorSection[] {
  if (!raw) return defaultSections()
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('[')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = JSON.parse(trimmed) as any[]
      return parsed.map((s: any) => ({ _id: uid(), type: s.type as SectionType, text: s.text, items: Array.isArray(s.items) ? s.items.join('\n') : s.items, label: s.label }))
    } catch { /* fallthrough */ }
  }
  return raw.split('\n\n').filter(Boolean).map(text => ({ _id: uid(), type: 'paragraph' as SectionType, text }))
}

function SectionEditor({ sections, onChange }: { sections: EditorSection[]; onChange: (s: EditorSection[]) => void }) {
  const add = (type: SectionType) => onChange([...sections, { _id: uid(), type, text: '', items: '', label: '' }])
  const upd = (id: string, patch: Partial<EditorSection>) => onChange(sections.map(s => s._id === id ? { ...s, ...patch } : s))
  const del = (id: string) => onChange(sections.filter(s => s._id !== id))
  const mov = (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex(s => s._id === id)
    if (idx < 0 || idx + dir < 0 || idx + dir >= sections.length) return
    const next = [...sections];[next[idx], next[idx + dir]] = [next[idx + dir], next[idx]]; onChange(next)
  }
  return (
    <div>
      {sections.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: '.75rem' }}>
          {sections.map((sec, idx) => (
            <div key={sec._id} style={{ background: '#050505', border: '1px solid #1a1a1a', borderRadius: '.2rem', padding: '.75rem' }}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: sec.type === 'divider' ? 0 : '.5rem', flexWrap: 'wrap' }}>
                <select value={sec.type} onChange={e => upd(sec._id, { type: e.target.value as SectionType })}
                  style={{ ...inp, width: 'auto', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.3rem .5rem', appearance: 'none', cursor: 'pointer', flex: 'none' }}>
                  {(['paragraph','heading','subheading','list','callout','week','divider'] as SectionType[]).map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                </select>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '.3rem' }}>
                  <button onClick={() => mov(sec._id, -1)} disabled={idx===0} style={{ background:'none',border:'1px solid #1e1e1e',color:'#444',fontSize:'.65rem',padding:'.2rem .5rem',borderRadius:'.15rem',cursor:idx===0?'default':'pointer',opacity:idx===0?0.3:1,fontFamily:'inherit' }}>&#8593;</button>
                  <button onClick={() => mov(sec._id, 1)} disabled={idx===sections.length-1} style={{ background:'none',border:'1px solid #1e1e1e',color:'#444',fontSize:'.65rem',padding:'.2rem .5rem',borderRadius:'.15rem',cursor:idx===sections.length-1?'default':'pointer',opacity:idx===sections.length-1?0.3:1,fontFamily:'inherit' }}>&#8595;</button>
                  <button onClick={() => del(sec._id)} style={{ background:'none',border:'1px solid #1e1e1e',color:'#555',fontSize:'.65rem',padding:'.2rem .5rem',borderRadius:'.15rem',cursor:'pointer',fontFamily:'inherit' }}
                    onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#e63e3e';(e.currentTarget as HTMLButtonElement).style.color='#e63e3e'}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#1e1e1e';(e.currentTarget as HTMLButtonElement).style.color='#555'}}>&#x2715;</button>
                </div>
              </div>
              {sec.type==='divider' && <div style={{height:1,background:'#2a2a2a',margin:'.3rem 0'}}/>}
              {(sec.type==='heading'||sec.type==='subheading') && <input style={inp} placeholder={sec.type==='heading'?'Section heading':'Subheading text'} value={sec.text??''} onChange={e=>upd(sec._id,{text:e.target.value})} maxLength={200}/>}
              {sec.type==='paragraph' && <textarea style={{...inp,minHeight:80,resize:'vertical'}} placeholder="Paragraph text" value={sec.text??''} onChange={e=>upd(sec._id,{text:e.target.value})} maxLength={2000}/>}
              {sec.type==='callout' && <textarea style={{...inp,minHeight:80,resize:'vertical'}} placeholder="Callout text" value={sec.text??''} onChange={e=>upd(sec._id,{text:e.target.value})} maxLength={1000}/>}
              {sec.type==='list' && <><p style={{color:'#333',fontSize:'.6rem',marginBottom:'.35rem'}}>One bullet item per line</p><textarea style={{...inp,minHeight:100,resize:'vertical'}} placeholder="Item one" value={sec.items??''} onChange={e=>upd(sec._id,{items:e.target.value})} maxLength={4000}/></>}
              {sec.type==='week' && <div style={{display:'flex',flexDirection:'column',gap:'.5rem'}}><input style={inp} placeholder="Week label" value={sec.label??''} onChange={e=>upd(sec._id,{label:e.target.value})} maxLength={100}/><textarea style={{...inp,minHeight:80,resize:'vertical'}} placeholder="Squat: 4x5 @ RPE 8" value={sec.items??''} onChange={e=>upd(sec._id,{items:e.target.value})} maxLength={2000}/></div>}
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex',gap:'.4rem',flexWrap:'wrap'}}>
        {(['paragraph','heading','subheading','list','callout','week','divider'] as SectionType[]).map(type=>(
          <button key={type} onClick={()=>add(type)}
            style={{background:'transparent',border:'1px solid #1e1e1e',color:'#444',fontSize:'.6rem',fontWeight:700,letterSpacing:'.1em',textTransform:'uppercase',padding:'.3rem .7rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',transition:'all .15s'}}
            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#444';(e.currentTarget as HTMLButtonElement).style.color='#ccc'}}
            onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#1e1e1e';(e.currentTarget as HTMLButtonElement).style.color='#444'}}
          >+ {type.charAt(0).toUpperCase()+type.slice(1)}</button>
        ))}
      </div>
    </div>
  )
}

function BlogPreview({ content }: { content: string }) {
  const trimmed = (content ?? '').trimStart()
  if (trimmed.startsWith('[')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sections = JSON.parse(trimmed) as any[]
      return (
        <div style={{display:'flex',flexDirection:'column',gap:'.5rem'}}>
          {sections.map((s: any, i: number)=>{
            if(s.type==='divider') return <div key={i} style={{height:1,background:'#222',margin:'.25rem 0'}}/>
            if(s.type==='heading') return <p key={i} style={{color:'#fff',fontWeight:900,fontSize:'.9rem',textTransform:'uppercase'}}>{s.text}</p>
            if(s.type==='subheading') return <p key={i} style={{color:'#e63e3e',fontWeight:900,fontSize:'.7rem',letterSpacing:'.2em',textTransform:'uppercase'}}>{s.text}</p>
            if(s.type==='paragraph') return <p key={i} style={{color:'#666',fontSize:'.825rem',lineHeight:1.65}}>{s.text}</p>
            if(s.type==='callout') return <blockquote key={i} style={{borderLeft:'3px solid #e63e3e',paddingLeft:'.875rem',color:'#888',fontSize:'.875rem',fontWeight:600,lineHeight:1.7}}>{s.text}</blockquote>
            if(s.type==='list') return <ul key={i} style={{listStyle:'none',padding:0,margin:0,display:'flex',flexDirection:'column',gap:'.3rem'}}>{(Array.isArray(s.items)?s.items:[]).map((item:string,j:number)=><li key={j} style={{display:'flex',gap:'.5rem',color:'#666',fontSize:'.825rem',lineHeight:1.6}}><span style={{color:'#e63e3e',flexShrink:0}}>·</span>{item}</li>)}</ul>
            if(s.type==='week') return <div key={i} style={{background:'#080808',border:'1px solid #1a1a1a',borderRadius:'.2rem',padding:'.875rem 1rem'}}><p style={{color:'#fff',fontWeight:700,fontSize:'.75rem',textTransform:'uppercase',letterSpacing:'.08em',marginBottom:'.5rem'}}>{s.label}</p><ul style={{listStyle:'none',padding:0,margin:0,display:'flex',flexDirection:'column',gap:'.25rem'}}>{(Array.isArray(s.items)?s.items:[]).map((item:string,j:number)=><li key={j} style={{color:'#555',fontSize:'.8rem',display:'flex',gap:'.5rem'}}><span style={{color:'#e63e3e'}}>·</span>{item}</li>)}</ul></div>
            return null
          })}
        </div>
      )
    } catch { /* fallthrough */ }
  }
  return <>{(content??'').split('\n\n').filter(Boolean).map((p,i)=><p key={i} style={{color:'#666',fontSize:'.825rem',lineHeight:1.65,marginBottom:'.5rem'}}>{p}</p>)}</>
}

interface BlogForm { title:string; subtitle:string; tags:string; summary:string; sections:EditorSection[] }
interface MeetForm { meetName:string; meetDate:string; meetLocation:string; federation:string; meetType:string; meetNote:string }
const emptyBlog = (): BlogForm => ({ title:'', subtitle:'', tags:'', summary:'', sections:defaultSections() })
const emptyMeet = (): MeetForm => ({ meetName:'', meetDate:'', meetLocation:'', federation:'', meetType:'National', meetNote:'' })
const itemToBlog = (item: PendingContent): BlogForm => ({ title:item.title??'', subtitle:item.subtitle??'', tags:item.tags??'', summary:item.summary??'', sections:deserializeSections(item.content) })
const itemToMeet = (item: PendingContent): MeetForm => ({ meetName:item.meetName??'', meetDate:item.meetDate??'', meetLocation:item.meetLocation??'', federation:item.federation??'', meetType:item.meetType??'National', meetNote:item.meetNote??'' })

type FilterType   = 'all' | 'blog' | 'meet'
type FilterStatus = 'pending' | 'reviewed'
type Mode = 'list' | 'create-blog' | 'create-meet' | 'edit'

export default function ApprovalsPanel({ isDemo = false }: { isDemo?: boolean }) {
  const [filterType,   setFilterType]   = useState<FilterType>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('pending')
  const [items,        setItems]        = useState<PendingContent[]>([])
  const [loading,      setLoading]      = useState(true)
  const [actionId,     setActionId]     = useState<string | null>(null)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [rejectNotes,  setRejectNotes]  = useState<Record<string,string>>({})
  const [rejectMode,   setRejectMode]   = useState<Record<string,boolean>>({})
  const [actionError,  setActionError]  = useState<string | null>(null)
  const [mode,         setMode]         = useState<Mode>('list')
  const [editItem,     setEditItem]     = useState<PendingContent | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [blog,  setBlog]  = useState<BlogForm>(emptyBlog())
  const [meet,  setMeet]  = useState<MeetForm>(emptyMeet())

  const refresh = useCallback(async () => {
    setLoading(true); setActionError(null)
    try { setItems(await fetchAllContent(isDemo)) }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [isDemo])
  useEffect(() => { refresh() }, [refresh])

  async function approve(id: string) {
    setActionId(id)
    try { await reviewContent(id,'approved',undefined,isDemo) } catch(err) { setActionError(err instanceof Error?err.message:'Failed') }
    setActionId(null); await refresh()
  }
  async function confirmReject(id: string) {
    setActionId(id)
    try { await reviewContent(id,'rejected',sanitize(rejectNotes[id]??'',500),isDemo) } catch(err) { setActionError(err instanceof Error?err.message:'Failed') }
    setRejectMode(p=>({...p,[id]:false})); setActionId(null); await refresh()
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this record permanently?')) return
    setActionId(id)
    try { await removeContent(id,isDemo) } catch(err) { setActionError(err instanceof Error?err.message:'Failed') }
    setActionId(null); await refresh()
  }

  function openCreate(type: 'blog' | 'meet') {
    setEditItem(null); setBlog(emptyBlog()); setMeet(emptyMeet())
    setMode(type==='blog'?'create-blog':'create-meet'); setActionError(null)
  }
  function openEdit(item: PendingContent) {
    setEditItem(item)
    if (item.type==='blog') setBlog(itemToBlog(item)); else setMeet(itemToMeet(item))
    setMode('edit'); setActionError(null); setExpandedId(null)
  }
  function cancelForm() { setMode('list'); setEditItem(null); setActionError(null) }

  async function saveCreate() {
    setSaving(true); setActionError(null)
    try {
      if (mode==='create-blog') {
        const item = await submitContent({ type:'blog', coachSlug:'admin', coachName:'Axis Admin', title:blog.title.trim(), subtitle:blog.subtitle.trim(), tags:blog.tags.trim(), summary:blog.summary.trim(), content:serializeSections(blog.sections) }, isDemo)
        await updateContent(item.id, { status:'approved', reviewedAt:new Date().toISOString() }, isDemo)
      } else {
        const item = await submitContent({ type:'meet', coachSlug:'admin', coachName:'Axis Admin', meetName:meet.meetName.trim(), meetDate:meet.meetDate.trim(), meetLocation:meet.meetLocation.trim(), federation:meet.federation.trim(), meetType:meet.meetType, meetNote:meet.meetNote.trim() }, isDemo)
        await updateContent(item.id, { status:'approved', reviewedAt:new Date().toISOString() }, isDemo)
      }
      setMode('list'); setFilterStatus('reviewed'); await refresh()
    } catch(err) { setActionError(err instanceof Error?err.message:'Save failed') }
    finally { setSaving(false) }
  }

  async function saveEdit() {
    if (!editItem) return
    setSaving(true); setActionError(null)
    try {
      if (editItem.type==='blog') await updateContent(editItem.id, { title:blog.title.trim(), subtitle:blog.subtitle.trim(), tags:blog.tags.trim(), summary:blog.summary.trim(), content:serializeSections(blog.sections) }, isDemo)
      else await updateContent(editItem.id, { meetName:meet.meetName.trim(), meetDate:meet.meetDate.trim(), meetLocation:meet.meetLocation.trim(), federation:meet.federation.trim(), meetType:meet.meetType, meetNote:meet.meetNote.trim() }, isDemo)
      setMode('list'); setEditItem(null); await refresh()
    } catch(err) { setActionError(err instanceof Error?err.message:'Save failed') }
    finally { setSaving(false) }
  }

  const filtered = items
    .filter(c => filterType==='all' || c.type===filterType)
    .filter(c => filterStatus==='pending' ? c.status==='pending' : c.status!=='pending')
    .sort((a,b) => b.submittedAt.localeCompare(a.submittedAt))

  const pendingCount = items.filter(c=>c.status==='pending').length
  const isCreate = mode==='create-blog' || mode==='create-meet'
  const isEdit = mode==='edit'
  const formType = isEdit ? editItem?.type : mode==='create-blog' ? 'blog' : 'meet'
  const formTitle = isCreate ? (formType==='blog'?'New Blog Post':'New Meet / Event') : ('Edit ' + (editItem?.type==='blog'?'Blog Post':'Meet'))
  const blogValid = blog.title.trim() && blog.summary.trim() && blog.sections.some(s => s.type==='divider' || (s.type==='list'||s.type==='week' ? (s.items??'').trim() : (s.text??'').trim()))
  const meetValid = meet.meetName.trim() && meet.meetDate.trim()
  const formValid = formType==='blog' ? blogValid : meetValid

  return (
    <div style={{ padding:'2rem', maxWidth:960 }}>
      {isDemo && mode==='list' && (
        <div style={{background:'#2d1f00',border:'1px solid #5c3d00',borderRadius:'.25rem',padding:'.75rem 1rem',marginBottom:'1.5rem'}}>
          <span style={{color:'#f59e0b',fontSize:'.7rem',fontWeight:700}}>Demo Mode — </span>
          <span style={{color:'#a06000',fontSize:'.75rem'}}>All changes are in-memory and reset on page reload.</span>
        </div>
      )}

      {mode==='list' && (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1.75rem',flexWrap:'wrap',gap:'1rem'}}>
          <div>
            <h2 style={{color:'#fff',fontSize:'1.25rem',fontWeight:900,marginBottom:'.25rem'}}>
              Content Approvals
              {pendingCount>0 && <span style={{background:'#e63e3e',color:'#fff',fontSize:'.6rem',fontWeight:900,borderRadius:'10rem',padding:'.15rem .55rem',marginLeft:'.5rem',verticalAlign:'middle'}}>{pendingCount}</span>}
            </h2>
            <p style={{color:'#333',fontSize:'.8rem'}}>Review coach submissions or create new content directly.</p>
          </div>
          <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',alignItems:'center'}}>
            <button onClick={refresh} style={{background:'none',border:'1px solid #222',color:'#555',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',padding:'.45rem .9rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Refresh</button>
            <button onClick={()=>openCreate('meet')} style={{background:'transparent',border:'1px solid #2a2a2a',color:'#ccc',fontSize:'.65rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}
              onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.borderColor='#555'} onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.borderColor='#2a2a2a'}>+ New Meet</button>
            <button onClick={()=>openCreate('blog')} style={{background:'#e63e3e',border:'1px solid #e63e3e',color:'#fff',fontSize:'.65rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}
              onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='#c42e2e'}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='#e63e3e'}}>+ New Blog Post</button>
          </div>
        </div>
      )}

      {(isCreate||isEdit) && (
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'1rem',marginBottom:'1.75rem',flexWrap:'wrap'}}>
            <button onClick={cancelForm} style={{background:'none',border:'1px solid #1e1e1e',color:'#444',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',padding:'.4rem .75rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Back</button>
            <h2 style={{color:'#fff',fontWeight:900,fontSize:'1.1rem',textTransform:'uppercase'}}>{formTitle}</h2>
            {isCreate && <span style={{background:'#22c55e18',border:'1px solid #22c55e55',color:'#22c55e',fontSize:'.6rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.2rem .6rem',borderRadius:'.2rem'}}>Auto-Approved</span>}
          </div>
          {actionError && <div style={{background:'#1a0808',border:'1px solid #4a1515',borderRadius:'.25rem',padding:'.75rem 1rem',marginBottom:'1.25rem',color:'#f87171',fontSize:'.8rem'}}>{actionError}</div>}

          {formType==='blog' && (
            <div style={{background:'#0a0a0a',border:'1px solid #1a1a1a',borderRadius:'.25rem',padding:'2rem'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'1.25rem'}}>
                <div><label style={lbl}>Title *</label><input style={inp} maxLength={200} placeholder="e.g. Meet Recap USAPL Raw Nationals 2026" value={blog.title} onChange={e=>setBlog(b=>({...b,title:e.target.value}))}/></div>
                <div><label style={lbl}>Subtitle</label><input style={inp} maxLength={300} placeholder="One-line description shown in the post header" value={blog.subtitle} onChange={e=>setBlog(b=>({...b,subtitle:e.target.value}))}/></div>
                <div><label style={lbl}>Tags (comma-separated)</label><input style={inp} maxLength={200} placeholder="Meet Recap, USAPL, Case Study" value={blog.tags} onChange={e=>setBlog(b=>({...b,tags:e.target.value}))}/></div>
                <div><label style={lbl}>Summary *</label><textarea style={{...inp,minHeight:80,resize:'vertical'}} maxLength={1000} placeholder="2-3 sentence summary shown on the blog listing page" value={blog.summary} onChange={e=>setBlog(b=>({...b,summary:e.target.value}))}/></div>
                <div><label style={{...lbl,marginBottom:'.75rem'}}>Content *</label><SectionEditor sections={blog.sections} onChange={sections=>setBlog(b=>({...b,sections}))}/></div>
              </div>
            </div>
          )}

          {formType==='meet' && (
            <div style={{background:'#0a0a0a',border:'1px solid #1a1a1a',borderRadius:'.25rem',padding:'2rem'}}>
              <div style={{display:'grid',gap:'1.25rem',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))'}}>
                <div style={{gridColumn:'1/-1'}}><label style={lbl}>Meet Name *</label><input style={inp} maxLength={200} placeholder="e.g. USAPL Raw Nationals 2026" value={meet.meetName} onChange={e=>setMeet(m=>({...m,meetName:e.target.value}))}/></div>
                <div><label style={lbl}>Date *</label><input style={inp} maxLength={100} placeholder="e.g. July 24-27, 2026" value={meet.meetDate} onChange={e=>setMeet(m=>({...m,meetDate:e.target.value}))}/></div>
                <div><label style={lbl}>Location</label><input style={inp} maxLength={200} placeholder="e.g. Reno, NV" value={meet.meetLocation} onChange={e=>setMeet(m=>({...m,meetLocation:e.target.value}))}/></div>
                <div><label style={lbl}>Federation</label><input style={inp} maxLength={50} placeholder="e.g. USAPL" value={meet.federation} onChange={e=>setMeet(m=>({...m,federation:e.target.value}))}/></div>
                <div><label style={lbl}>Type</label><select style={{...inp,appearance:'none',cursor:'pointer'}} value={meet.meetType} onChange={e=>setMeet(m=>({...m,meetType:e.target.value}))}><option>National</option><option>Regional</option><option>World</option><option>Local</option></select></div>
                <div style={{gridColumn:'1/-1'}}><label style={lbl}>Note</label><input style={inp} maxLength={300} placeholder="e.g. Axis coaches attending" value={meet.meetNote} onChange={e=>setMeet(m=>({...m,meetNote:e.target.value}))}/></div>
              </div>
            </div>
          )}

          <div style={{display:'flex',gap:'.75rem',marginTop:'1.5rem',flexWrap:'wrap',alignItems:'center'}}>
            <button onClick={isEdit?saveEdit:saveCreate} disabled={saving||!formValid}
              style={{background:'#e63e3e',border:'none',color:'#fff',fontWeight:900,fontSize:'.75rem',letterSpacing:'.15em',textTransform:'uppercase',padding:'.75rem 1.75rem',borderRadius:'.25rem',cursor:'pointer',fontFamily:'inherit',opacity:saving||!formValid?0.45:1,transition:'opacity .15s'}}>
              {saving?'Saving...':isEdit?'Save Changes':'Publish Now'}
            </button>
            <button onClick={cancelForm} style={{background:'none',border:'1px solid #1e1e1e',color:'#555',fontSize:'.7rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',padding:'.7rem 1.25rem',borderRadius:'.25rem',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
          </div>
        </div>
      )}

      {mode==='list' && (
        <>
          {actionError && <div style={{background:'#1a0808',border:'1px solid #4a1515',borderRadius:'.25rem',padding:'.75rem 1rem',marginBottom:'1.5rem',color:'#f87171',fontSize:'.8rem'}}>{actionError}</div>}
          <div style={{display:'flex',gap:'.5rem',marginBottom:'1.5rem',flexWrap:'wrap'}}>
            {(['pending','reviewed'] as FilterStatus[]).map(s=>(
              <button key={s} onClick={()=>setFilterStatus(s)} style={{background:filterStatus===s?'#141414':'transparent',border:`1px solid ${filterStatus===s?'#333':'#1a1a1a'}`,color:filterStatus===s?'#fff':'#333',borderRadius:'.2rem',padding:'.4rem .9rem',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',cursor:'pointer',fontFamily:'inherit',transition:'all .15s'}}>
                {s==='pending'?('Pending (' + items.filter(c=>c.status==='pending').length + ')'):'Reviewed'}
              </button>
            ))}
            <div style={{width:1,background:'#1a1a1a',flexShrink:0}}/>
            {(['all','blog','meet'] as FilterType[]).map(t=>(
              <button key={t} onClick={()=>setFilterType(t)} style={{background:filterType===t?'#141414':'transparent',border:`1px solid ${filterType===t?'#333':'#1a1a1a'}`,color:filterType===t?'#fff':'#333',borderRadius:'.2rem',padding:'.4rem .9rem',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',cursor:'pointer',fontFamily:'inherit',transition:'all .15s'}}>
                {t==='all'?'All':t==='blog'?'Blog':'Meets'}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{background:'#0a0a0a',border:'1px solid #111',borderRadius:'.25rem',padding:'3rem 2rem',textAlign:'center'}}><p style={{color:'#2a2a2a',fontSize:'.875rem'}}>Loading...</p></div>
          ) : filtered.length===0 ? (
            <div style={{background:'#0a0a0a',border:'1px solid #111',borderRadius:'.25rem',padding:'3rem 2rem',textAlign:'center'}}>
              <p style={{color:'#2a2a2a',fontSize:'.875rem'}}>{filterStatus==='pending'?'No pending submissions.':'No reviewed items.'}</p>
              <p style={{color:'#1a1a1a',fontSize:'.75rem',marginTop:'.5rem'}}>Use the buttons above to create new content directly.</p>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:'1px',background:'#111'}}>
              {filtered.map(item=>{
                const isExpanded = expandedId===item.id
                return (
                  <div key={item.id} style={{background:'#080808'}}>
                    <div style={{display:'flex',gap:'1rem',alignItems:'flex-start',padding:'1.25rem 1.5rem',cursor:'pointer',flexWrap:'wrap'}} onClick={()=>setExpandedId(isExpanded?null:item.id)}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:'flex',gap:'.5rem',alignItems:'center',marginBottom:'.35rem',flexWrap:'wrap'}}>
                          <span style={{color:'#444',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase'}}>{item.type==='blog'?'Blog':'Meet'}</span>
                          <span style={{background:STATUS_COLORS[item.status]+'18',border:`1px solid ${STATUS_COLORS[item.status]}`,color:STATUS_COLORS[item.status],fontSize:'.55rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.15rem .5rem',borderRadius:'.15rem'}}>{item.status}</span>
                          <span style={{color:'#222',fontSize:'.65rem',fontWeight:600}}>by {item.coachName}</span>
                        </div>
                        <p style={{color:'#fff',fontWeight:700,fontSize:'.925rem'}}>{item.type==='blog'?item.title:item.meetName}</p>
                        {item.type==='meet' && <p style={{color:'#444',fontSize:'.75rem',marginTop:'.2rem'}}>{item.meetDate}{item.meetLocation?' · '+item.meetLocation:''}{item.federation?' · '+item.federation:''} · {item.meetType}</p>}
                        {item.type==='blog' && item.summary && <p style={{color:'#333',fontSize:'.8rem',marginTop:'.35rem',lineHeight:1.5}}>{item.summary}</p>}
                        <p style={{color:'#1e1e1e',fontSize:'.65rem',marginTop:'.4rem'}}>
                          Submitted {new Date(item.submittedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                          {item.reviewedAt&&(' · Reviewed ' + new Date(item.reviewedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}
                        </p>
                        {item.status==='rejected'&&item.rejectionNote&&<p style={{color:'#e63e3e',fontSize:'.75rem',marginTop:'.4rem'}}>Rejection note: {item.rejectionNote}</p>}
                      </div>
                      <span style={{color:'#222',fontSize:'.7rem',flexShrink:0,paddingTop:'.2rem'}}>{isExpanded?'▲':'▼'}</span>
                    </div>

                    {isExpanded && (
                      <div style={{borderTop:'1px solid #111',padding:'1.5rem',display:'flex',flexDirection:'column',gap:'1.25rem'}}>
                        {item.type==='blog'&&item.content&&(
                          <div>
                            <p style={{...lbl,marginBottom:'.5rem'}}>Content Preview</p>
                            <div style={{background:'#050505',border:'1px solid #111',borderRadius:'.2rem',padding:'1.25rem',maxHeight:320,overflow:'auto'}}><BlogPreview content={item.content}/></div>
                            {item.tags&&<p style={{color:'#333',fontSize:'.7rem',marginTop:'.5rem'}}>Tags: {item.tags}</p>}
                          </div>
                        )}
                        {item.type==='meet'&&item.meetNote&&<div><p style={lbl}>Note</p><p style={{color:'#666',fontSize:'.8rem'}}>{item.meetNote}</p></div>}
                        <div style={{display:'flex',gap:'.6rem',flexWrap:'wrap',alignItems:'center'}}>
                          <button onClick={e=>{e.stopPropagation();openEdit(item)}}
                            style={{background:'transparent',border:'1px solid #2a2a2a',color:'#888',fontSize:'.65rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}
                            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#555';(e.currentTarget as HTMLButtonElement).style.color='#fff'}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#2a2a2a';(e.currentTarget as HTMLButtonElement).style.color='#888'}}>Edit</button>
                          {!rejectMode[item.id]&&(
                            <>
                              {item.status!=='approved'&&<button onClick={e=>{e.stopPropagation();approve(item.id)}} disabled={actionId===item.id}
                                style={{background:'#22c55e18',border:'1px solid #22c55e',color:'#22c55e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}>
                                {actionId===item.id?'...':'Approve'}</button>}
                              {item.status!=='rejected'&&<button onClick={e=>{e.stopPropagation();setRejectMode(p=>({...p,[item.id]:true}))}}
                                style={{background:'#e63e3e18',border:'1px solid #e63e3e',color:'#e63e3e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Reject</button>}
                              {item.status==='approved'&&<button onClick={e=>{e.stopPropagation();setRejectMode(p=>({...p,[item.id]:true}))}}
                                style={{background:'#e63e3e18',border:'1px solid #e63e3e',color:'#e63e3e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Unpublish / Reject</button>}
                              {item.status==='rejected'&&<button onClick={e=>{e.stopPropagation();approve(item.id)}} disabled={actionId===item.id}
                                style={{background:'#22c55e18',border:'1px solid #22c55e',color:'#22c55e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}>
                                {actionId===item.id?'...':'Re-Approve'}</button>}
                            </>
                          )}
                          {rejectMode[item.id]&&(
                            <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:'.6rem',width:'100%',maxWidth:440}}>
                              <div><label style={lbl}>Rejection Note (visible to coach)</label><input style={inp} maxLength={500} placeholder="Explain why..." value={rejectNotes[item.id]??''} onChange={e=>setRejectNotes(p=>({...p,[item.id]:e.target.value}))}/></div>
                              <div style={{display:'flex',gap:'.5rem'}}>
                                <button onClick={()=>confirmReject(item.id)} disabled={actionId===item.id} style={{background:'#e63e3e',border:'none',color:'#fff',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}>{actionId===item.id?'Saving...':'Confirm Reject'}</button>
                                <button onClick={()=>setRejectMode(p=>({...p,[item.id]:false}))} style={{background:'none',border:'1px solid #222',color:'#444',fontWeight:700,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
                              </div>
                            </div>
                          )}
                          <div style={{flex:1}}/>
                          <button onClick={e=>{e.stopPropagation();handleDelete(item.id)}} disabled={actionId===item.id}
                            style={{background:'none',border:'1px solid #1a1a1a',color:'#2a2a2a',fontWeight:700,fontSize:'.6rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.45rem .9rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}
                            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#e63e3e';(e.currentTarget as HTMLButtonElement).style.color='#e63e3e'}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#1a1a1a';(e.currentTarget as HTMLButtonElement).style.color='#2a2a2a'}}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
