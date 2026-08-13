/**
 * The one demo-mode banner, shared by every dashboard panel. Each panel used
 * to hand-roll its own (or omit it — Analytics and Rotation had none), so demo
 * mode read as real data on some tabs and lied about persistence on others.
 * The copy promises exactly what demo mode does: local, resettable, sandboxed.
 */
export default function DemoBanner({ note }: { note?: string }) {
  return (
    <div className="dash-demo-banner">
      <strong>Demo Mode</strong>
      <span>
        Sample data — changes stay in this preview and are never saved.
        {note ? ` ${note}` : ''}
      </span>
    </div>
  )
}
