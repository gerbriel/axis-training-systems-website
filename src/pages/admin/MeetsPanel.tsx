import { useState, useEffect, useCallback } from 'react'
import { fetchAllContent, reviewContent, removeContent, submitContent, updateContent } from '../../lib/contentApi'
import type { PendingContent, ContentStatus } from '../../data/pendingContent'
import { sanitize } from '../../utils/sanitize'

const STATUS_COLORS: Record<ContentStatus, string> = { pending: '#f5b935', approved: '#22c55e', rejected: '#c8102e' }
const lbl: React.CSSProperties = { color: '#c7c7c7', fontSize: '.6rem', fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', marginBottom: '.35rem', display: 'block' }
const inp: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #222222', borderRadius: '.2rem', color: '#fff', fontSize: '.875rem', fontWeight: 500, padding: '.65rem .875rem', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }

interface MeetForm { meetName:string; meetDate:string; meetLocation:string; federation:string; meetType:string; meetNote:string }
const emptyMeet = (): MeetForm => ({ meetName:'', meetDate:'', meetLocation:'', federation:'', meetType:'National', meetNote:'' })
const itemToMeet = (item: PendingContent): MeetForm => ({ meetName:item.meetName??'', meetDate:item.meetDate??'', meetLocation:item.meetLocation??'', federation:item.federation??'', meetType:item.meetType??'National', meetNote:item.meetNote??'' })

type FilterStatus = 'pending' | 'reviewed'
type Mode = 'list' | 'create' | 'edit'

export default function MeetsPanel({ isDemo = false }: { isDemo?: boolean }) {
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
  const [meet,         setMeet]         = useState<MeetForm>(emptyMeet())

  const refresh = useCallback(async () => {
    setLoading(true); setActionError(null)
    try { const all = await fetchAllContent(isDemo); setItems(all.filter(c => c.type === 'meet')) }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [isDemo])
  useEffect(() => { refresh() }, [refresh])

  const approve      = async (id: string) => { setActionId(id); try { await reviewContent(id,'approved',undefined,isDemo) } catch(e) { setActionError(e instanceof Error?e.message:'Failed') } setActionId(null); await refresh() }
  const confirmReject = async (id: string) => { setActionId(id); try { await reviewContent(id,'rejected',sanitize(rejectNotes[id]??'',500),isDemo) } catch(e) { setActionError(e instanceof Error?e.message:'Failed') } setRejectMode(p=>({...p,[id]:false})); setActionId(null); await refresh() }
  const handleDelete  = async (id: string) => { if (!confirm('Delete permanently?')) return; setActionId(id); try { await removeContent(id,isDemo) } catch(e) { setActionError(e instanceof Error?e.message:'Failed') } setActionId(null); await refresh() }

  const openCreate = () => { setEditItem(null); setMeet(emptyMeet()); setMode('create'); setActionError(null) }
  const openEdit   = (item: PendingContent) => { setEditItem(item); setMeet(itemToMeet(item)); setMode('edit'); setActionError(null); setExpandedId(null) }
  const cancelForm = () => { setMode('list'); setEditItem(null); setActionError(null) }

  const saveCreate = async () => {
    setSaving(true); setActionError(null)
    try {
      const item = await submitContent({ type:'meet', coachSlug:'admin', coachName:'Axis Admin', meetName:meet.meetName.trim(), meetDate:meet.meetDate.trim(), meetLocation:meet.meetLocation.trim(), federation:meet.federation.trim(), meetType:meet.meetType, meetNote:meet.meetNote.trim() }, isDemo)
      await updateContent(item.id, { status:'approved', reviewedAt:new Date().toISOString() }, isDemo)
      setMode('list'); setFilterStatus('reviewed'); await refresh()
    } catch(e) { setActionError(e instanceof Error?e.message:'Save failed') }
    finally { setSaving(false) }
  }

  const saveEdit = async () => {
    if (!editItem) return
    setSaving(true); setActionError(null)
    try { await updateContent(editItem.id, { meetName:meet.meetName.trim(), meetDate:meet.meetDate.trim(), meetLocation:meet.meetLocation.trim(), federation:meet.federation.trim(), meetType:meet.meetType, meetNote:meet.meetNote.trim() }, isDemo); setMode('list'); setEditItem(null); await refresh() }
    catch(e) { setActionError(e instanceof Error?e.message:'Save failed') }
    finally { setSaving(false) }
  }

  const filtered = items.filter(c => filterStatus==='pending' ? c.status==='pending' : c.status!=='pending').sort((a,b) => b.submittedAt.localeCompare(a.submittedAt))
  const pendingCount = items.filter(c=>c.status==='pending').length
  const meetValid = meet.meetName.trim() && meet.meetDate.trim()

  return (
    <div style={{ padding:'2rem', maxWidth:960 }}>
      {isDemo && mode==='list' && <div style={{background:'#2d2500',border:'1px solid #5c4800',borderRadius:'.25rem',padding:'.75rem 1rem',marginBottom:'1.5rem'}}><span style={{color:'#fff',fontSize:'.7rem',fontWeight:700}}>Demo Mode — </span><span style={{color:'#a08c30',fontSize:'.75rem'}}>Changes reset on reload.</span></div>}

      {mode==='list' && (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'1.75rem',flexWrap:'wrap',gap:'1rem'}}>
          <div>
            <h2 style={{color:'#fff',fontSize:'1.25rem',fontWeight:900,marginBottom:'.25rem'}}>
              Meet Listings {pendingCount>0 && <span style={{background:'#c8102e',color:'#fff',fontSize:'.6rem',fontWeight:900,borderRadius:'10rem',padding:'.15rem .55rem',marginLeft:'.5rem',verticalAlign:'middle'}}>{pendingCount}</span>}
            </h2>
            <p style={{color:'#3a3f47',fontSize:'.8rem'}}>Manage upcoming powerlifting meets and events.</p>
          </div>
          <div style={{display:'flex',gap:'.5rem'}}>
            <button onClick={refresh} style={{background:'none',border:'1px solid #222222',color:'#555',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',padding:'.45rem .9rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Refresh</button>
            <button onClick={openCreate} style={{background:'#0d5bae',border:'1px solid #0d5bae',color:'#fff',fontSize:'.65rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}
              onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.background='#0a4a91'}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.background='#0d5bae'}}>+ New Meet</button>
          </div>
        </div>
      )}

      {(mode==='create'||mode==='edit') && (
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'1rem',marginBottom:'1.75rem',flexWrap:'wrap'}}>
            <button onClick={cancelForm} style={{background:'none',border:'1px solid #222222',color:'#444',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',padding:'.4rem .75rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>← Back</button>
            <h2 style={{color:'#fff',fontWeight:900,fontSize:'1.1rem',textTransform:'uppercase'}}>{mode==='create'?'New Meet / Event':'Edit Meet'}</h2>
            {mode==='create' && <span style={{background:'#22c55e18',border:'1px solid #22c55e55',color:'#22c55e',fontSize:'.6rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.2rem .6rem',borderRadius:'.2rem'}}>Auto-Approved</span>}
          </div>
          {actionError && <div style={{background:'#1a0309',border:'1px solid #2d0810',borderRadius:'.25rem',padding:'.75rem 1rem',marginBottom:'1.25rem',color:'#f87171',fontSize:'.8rem'}}>{actionError}</div>}
          <div style={{background:'#000000',border:'1px solid #222222',borderRadius:'.25rem',padding:'2rem'}}>
            <div style={{display:'grid',gap:'1.25rem',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))'}}>
              <div style={{gridColumn:'1/-1'}}><label style={lbl}>Meet Name *</label><input style={inp} maxLength={200} placeholder="e.g. USAPL Raw Nationals 2026" value={meet.meetName} onChange={e=>setMeet(m=>({...m,meetName:e.target.value}))}/></div>
              <div><label style={lbl}>Date *</label><input style={inp} maxLength={100} placeholder="e.g. July 24-27, 2026" value={meet.meetDate} onChange={e=>setMeet(m=>({...m,meetDate:e.target.value}))}/></div>
              <div><label style={lbl}>Location</label><input style={inp} maxLength={200} placeholder="e.g. Reno, NV" value={meet.meetLocation} onChange={e=>setMeet(m=>({...m,meetLocation:e.target.value}))}/></div>
              <div><label style={lbl}>Federation</label><input style={inp} maxLength={50} placeholder="e.g. USAPL" value={meet.federation} onChange={e=>setMeet(m=>({...m,federation:e.target.value}))}/></div>
              <div><label style={lbl}>Type</label><select style={{...inp,appearance:'none',cursor:'pointer'}} value={meet.meetType} onChange={e=>setMeet(m=>({...m,meetType:e.target.value}))}><option>National</option><option>Regional</option><option>World</option><option>Local</option></select></div>
              <div style={{gridColumn:'1/-1'}}><label style={lbl}>Note</label><input style={inp} maxLength={300} placeholder="e.g. Axis coaches attending" value={meet.meetNote} onChange={e=>setMeet(m=>({...m,meetNote:e.target.value}))}/></div>
            </div>
          </div>
          <div style={{display:'flex',gap:'.75rem',marginTop:'1.5rem'}}>
            <button onClick={mode==='create'?saveCreate:saveEdit} disabled={saving||!meetValid} style={{background:'#0d5bae',border:'none',color:'#fff',fontWeight:900,fontSize:'.75rem',letterSpacing:'.15em',textTransform:'uppercase',padding:'.75rem 1.75rem',borderRadius:'.25rem',cursor:'pointer',fontFamily:'inherit',opacity:saving||!meetValid?0.45:1}}>
              {saving?'Saving...':mode==='create'?'Publish Now':'Save Changes'}
            </button>
            <button onClick={cancelForm} style={{background:'none',border:'1px solid #222222',color:'#555',fontSize:'.7rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',padding:'.7rem 1.25rem',borderRadius:'.25rem',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
          </div>
        </div>
      )}

      {mode==='list' && (
        <>
          {actionError && <div style={{background:'#1a0309',border:'1px solid #2d0810',borderRadius:'.25rem',padding:'.75rem 1rem',marginBottom:'1.5rem',color:'#f87171',fontSize:'.8rem'}}>{actionError}</div>}
          <div style={{display:'flex',gap:'.5rem',marginBottom:'1.5rem'}}>
            {(['pending','reviewed'] as FilterStatus[]).map(s=>(
              <button key={s} onClick={()=>setFilterStatus(s)} style={{background:filterStatus===s?'#0d0d0d':'transparent',border:`1px solid ${filterStatus===s?'#3a3f47':'#222222'}`,color:filterStatus===s?'#fff':'#3a3f47',borderRadius:'.2rem',padding:'.4rem .9rem',fontSize:'.6rem',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',cursor:'pointer',fontFamily:'inherit'}}>
                {s==='pending'?`Pending (${items.filter(c=>c.status==='pending').length})`:'Published / Reviewed'}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{padding:'3rem',textAlign:'center',color:'#222',fontSize:'.875rem'}}>Loading…</div>
          ) : filtered.length===0 ? (
            <div style={{background:'#000',border:'1px solid #0d0d0d',borderRadius:'.25rem',padding:'3rem 2rem',textAlign:'center'}}><p style={{color:'#222',fontSize:'.875rem'}}>{filterStatus==='pending'?'No pending meet submissions.':'No meets listed.'}</p></div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:'1px',background:'#0d0d0d'}}>
              {filtered.map(item=>{
                const isExpanded = expandedId===item.id
                return (
                  <div key={item.id} style={{background:'#000000'}}>
                    <div style={{display:'flex',gap:'1rem',alignItems:'flex-start',padding:'1.25rem 1.5rem',cursor:'pointer',flexWrap:'wrap'}} onClick={()=>setExpandedId(isExpanded?null:item.id)}>
                      <div style={{flex:1,minWidth:200}}>
                        <div style={{display:'flex',gap:'.5rem',alignItems:'center',marginBottom:'.35rem',flexWrap:'wrap'}}>
                          <span style={{background:STATUS_COLORS[item.status]+'18',border:`1px solid ${STATUS_COLORS[item.status]}`,color:STATUS_COLORS[item.status],fontSize:'.55rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.15rem .5rem',borderRadius:'.15rem'}}>{item.status}</span>
                          {item.meetType && <span style={{color:'#444',fontSize:'.65rem',fontWeight:600}}>{item.meetType}</span>}
                          {item.federation && <span style={{color:'#444',fontSize:'.65rem',fontWeight:600}}>{item.federation}</span>}
                        </div>
                        <p style={{color:'#fff',fontWeight:700,fontSize:'.925rem'}}>{item.meetName}</p>
                        <p style={{color:'#555',fontSize:'.8rem',marginTop:'.25rem'}}>{item.meetDate}{item.meetLocation?' · '+item.meetLocation:''}</p>
                        <p style={{color:'#333',fontSize:'.65rem',marginTop:'.4rem'}}>{new Date(item.submittedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{item.reviewedAt&&(' · Listed ' + new Date(item.reviewedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</p>
                        {item.status==='rejected'&&item.rejectionNote&&<p style={{color:'#c8102e',fontSize:'.75rem',marginTop:'.4rem'}}>Note: {item.rejectionNote}</p>}
                      </div>
                      <span style={{color:'#333',fontSize:'.7rem',flexShrink:0,paddingTop:'.2rem'}}>{isExpanded?'▲':'▼'}</span>
                    </div>

                    {isExpanded && (
                      <div style={{borderTop:'1px solid #0d0d0d',padding:'1.5rem',display:'flex',flexDirection:'column',gap:'1.25rem'}}>
                        {item.meetNote && <div><p style={lbl}>Note</p><p style={{color:'#888',fontSize:'.85rem',lineHeight:1.6}}>{item.meetNote}</p></div>}
                        <div style={{display:'flex',gap:'.6rem',flexWrap:'wrap',alignItems:'center'}}>
                          <button onClick={e=>{e.stopPropagation();openEdit(item)}} style={{background:'transparent',border:'1px solid #222222',color:'#888',fontSize:'.65rem',fontWeight:900,letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Edit</button>
                          {!rejectMode[item.id] && (<>
                            {item.status!=='approved'&&<button onClick={e=>{e.stopPropagation();approve(item.id)}} disabled={actionId===item.id} style={{background:'#22c55e18',border:'1px solid #22c55e',color:'#22c55e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}>{actionId===item.id?'…':'Approve'}</button>}
                            {item.status==='approved'&&<button onClick={e=>{e.stopPropagation();setRejectMode(p=>({...p,[item.id]:true}))}} style={{background:'#c8102e18',border:'1px solid #c8102e',color:'#c8102e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Unlist</button>}
                            {item.status!=='approved'&&item.status!=='rejected'&&<button onClick={e=>{e.stopPropagation();setRejectMode(p=>({...p,[item.id]:true}))}} style={{background:'#c8102e18',border:'1px solid #c8102e',color:'#c8102e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Reject</button>}
                            {item.status==='rejected'&&<button onClick={e=>{e.stopPropagation();approve(item.id)}} disabled={actionId===item.id} style={{background:'#22c55e18',border:'1px solid #22c55e',color:'#22c55e',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}>{actionId===item.id?'…':'Re-List'}</button>}
                          </>)}
                          {rejectMode[item.id] && (
                            <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:'.6rem',width:'100%',maxWidth:440}}>
                              <div><label style={lbl}>Rejection Note</label><input style={inp} maxLength={500} placeholder="Reason…" value={rejectNotes[item.id]??''} onChange={e=>setRejectNotes(p=>({...p,[item.id]:e.target.value}))}/></div>
                              <div style={{display:'flex',gap:'.5rem'}}>
                                <button onClick={()=>confirmReject(item.id)} disabled={actionId===item.id} style={{background:'#c8102e',border:'none',color:'#fff',fontWeight:900,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}>{actionId===item.id?'Saving…':'Confirm'}</button>
                                <button onClick={()=>setRejectMode(p=>({...p,[item.id]:false}))} style={{background:'none',border:'1px solid #222222',color:'#444',fontWeight:700,fontSize:'.65rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.5rem 1.1rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
                              </div>
                            </div>
                          )}
                          <div style={{flex:1}}/>
                          <button onClick={e=>{e.stopPropagation();handleDelete(item.id)}} disabled={actionId===item.id} style={{background:'none',border:'1px solid #222222',color:'#333',fontWeight:700,fontSize:'.6rem',letterSpacing:'.12em',textTransform:'uppercase',padding:'.45rem .9rem',borderRadius:'.2rem',cursor:'pointer',fontFamily:'inherit',opacity:actionId===item.id?0.5:1}}
                            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#c8102e';(e.currentTarget as HTMLButtonElement).style.color='#c8102e'}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor='#222222';(e.currentTarget as HTMLButtonElement).style.color='#333'}}>Delete</button>
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
