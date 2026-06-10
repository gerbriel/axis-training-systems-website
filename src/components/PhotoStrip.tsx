const photos = [
  'https://static.wixstatic.com/media/e99af3_78afea37a86d42b59c9a5885e5909905~mv2.jpg',
  'https://static.wixstatic.com/media/c0cc37_796d8fc359f64ca8a68c705fc054c7d5~mv2.jpg',
  'https://static.wixstatic.com/media/e99af3_5f5b05c685074f279aca43a694ecc6a2~mv2.jpg',
  'https://static.wixstatic.com/media/c0cc37_22d0ada4e59a43e68d265f53b7ff6219~mv2.jpg',
  'https://static.wixstatic.com/media/e99af3_8188e795483040e68ca52efc20c469ca~mv2.jpg',
  'https://static.wixstatic.com/media/c0cc37_ebbb8dbdcac340db9f56eb1bea02abe7~mv2.jpg',
]

export default function PhotoStrip() {
  return (
    <section
      aria-hidden="true"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        height: 'clamp(160px, 22vw, 320px)',
        overflow: 'hidden',
      }}
    >
      {photos.map((src, i) => (
        <div
          key={i}
          style={{
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <img
            src={src}
            alt=""
            loading="lazy"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              filter: 'grayscale(60%) brightness(0.65)',
              transition: 'filter .4s ease, transform .6s ease',
            }}
            onMouseEnter={e => {
              const img = e.currentTarget
              img.style.filter = 'grayscale(0%) brightness(0.9)'
              img.style.transform = 'scale(1.04)'
            }}
            onMouseLeave={e => {
              const img = e.currentTarget
              img.style.filter = 'grayscale(60%) brightness(0.65)'
              img.style.transform = 'scale(1)'
            }}
          />
          {/* subtle red tint overlay on edges */}
          {i === 0 || i === photos.length - 1 ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: i === 0
                  ? 'linear-gradient(to right, rgba(8,8,8,0.6), transparent)'
                  : 'linear-gradient(to left, rgba(8,8,8,0.6), transparent)',
                pointerEvents: 'none',
              }}
            />
          ) : null}
        </div>
      ))}
    </section>
  )
}
