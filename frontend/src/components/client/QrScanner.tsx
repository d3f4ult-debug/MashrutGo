import { useEffect, useRef, useState } from 'react'

interface Props {
  onResult: (text: string) => void
  paused?: boolean
}

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/**
 * Camera QR scanner: native BarcodeDetector when available (Chrome/Android), jsQR otherwise (iOS Safari).
 * The camera stream is always stopped on unmount.
 */
export default function QrScanner({ onResult, paused = false }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const resultRef = useRef(onResult)
  resultRef.current = onResult
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)

  useEffect(() => {
    let stream: MediaStream | null = null
    let frame = 0
    let stopped = false
    let detector: Detector | null = null
    let jsQR: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Bu brauzerda kamera mavjud emas. Raqamni qo‘lda kiriting.')
        setStarting(false)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        setError('Kameraga ruxsat berilmadi. Brauzer sozlamalarida ruxsat bering yoki raqamni qo‘lda kiriting.')
        setStarting(false)
        return
      }
      if (stopped || !videoRef.current) return
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
      if (BD) {
        try {
          detector = new BD({ formats: ['qr_code'] })
        } catch {
          detector = null
        }
      }
      if (!detector) jsQR = (await import('jsqr')).default
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => undefined)
      setStarting(false)
      tick()
    }

    const tick = async () => {
      if (stopped) return
      const video = videoRef.current
      if (video && video.readyState >= 2 && !pausedRef.current) {
        try {
          let text: string | null = null
          if (detector) {
            const codes = await detector.detect(video)
            text = codes[0]?.rawValue ?? null
          } else if (jsQR && canvasRef.current) {
            const canvas = canvasRef.current
            const w = (canvas.width = video.videoWidth)
            const h = (canvas.height = video.videoHeight)
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            if (ctx && w && h) {
              ctx.drawImage(video, 0, 0, w, h)
              text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null
            }
          }
          if (text) resultRef.current(text)
        } catch {
          // keep scanning
        }
      }
      frame = window.setTimeout(tick, 250)
    }

    void start()
    return () => {
      stopped = true
      window.clearTimeout(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-xs mx-auto aspect-square rounded-2xl overflow-hidden bg-neutral-900">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-6 border-2 border-white/70 rounded-xl pointer-events-none" />
        {starting && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/80">Kamera ishga tushmoqda…</div>
        )}
      </div>
      {error ? (
        <p className="text-xs text-red-600 text-center">{error}</p>
      ) : (
        <p className="text-xs text-neutral-500 text-center">Marshrutka ichidagi QR kodga kamerani qarating</p>
      )}
    </div>
  )
}
