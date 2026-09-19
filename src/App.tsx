import React, { useState, useRef, useEffect } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva'
import './App.css'

// A4 standard points ratio (210mm x 297mm)
const A4_BASE_WIDTH = 595
const A4_BASE_HEIGHT = 842

interface CanvasImageItem {
  id: string
  image: HTMLImageElement
  x: number
  y: number
  width: number
  height: number
}

export default function App() {
  const [scale, setScale] = useState(1)
  const [images, setImages] = useState<CanvasImageItem[]>([])
  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Dynamically compute scale to fit the A4 page within the workspace
  useEffect(() => {
    const handleResize = () => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const paddingX = window.innerWidth <= 640 ? 24 : 48
      const paddingY = window.innerWidth <= 640 ? 24 : 48
      const availWidth = Math.max(rect.width - paddingX, 100)
      const availHeight = Math.max(rect.height - paddingY, 100)

      const scaleX = availWidth / A4_BASE_WIDTH
      const scaleY = availHeight / A4_BASE_HEIGHT
      // Maintain A4 aspect ratio while fitting inside workspace comfortably
      const fittedScale = Math.min(scaleX, scaleY, 1.1)
      setScale(Math.max(fittedScale, 0.1))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleAddImageClick = () => {
    fileInputRef.current?.click()
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const objectUrl = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => {
      // Scale image initially so it fits neatly on the page
      const maxInitialWidth = A4_BASE_WIDTH * 0.6
      const maxInitialHeight = A4_BASE_HEIGHT * 0.5
      let w = img.naturalWidth || img.width
      let h = img.naturalHeight || img.height

      const fitRatio = Math.min(maxInitialWidth / w, maxInitialHeight / h, 1)
      w = Math.round(w * fitRatio)
      h = Math.round(h * fitRatio)

      setImages((prev) => [
        ...prev,
        {
          id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          image: img,
          x: Math.round((A4_BASE_WIDTH - w) / 2),
          y: Math.round((A4_BASE_HEIGHT - h) / 2),
          width: w,
          height: h,
        },
      ])
      URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl
    // Reset file input value so user can re-select the same image if desired
    e.target.value = ''
  }

  const pageWidth = Math.round(A4_BASE_WIDTH * scale)
  const pageHeight = Math.round(A4_BASE_HEIGHT * scale)

  return (
    <div className="app-container">
      {/* Top toolbar */}
      <header className="top-toolbar">
        <div className="toolbar-brand">
          <div className="brand-icon">ION</div>
          <h1 className="app-title">ION Print Studio</h1>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="add-image-btn"
            onClick={handleAddImageClick}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            Add Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageFileChange}
          />
        </div>
      </header>

      {/* Light gray workspace */}
      <main className="workspace" ref={workspaceRef}>
        {/* Centered white printable page */}
        <div
          className="page-container"
          style={{
            width: `${pageWidth}px`,
            height: `${pageHeight}px`,
          }}
        >
          <Stage
            width={pageWidth}
            height={pageHeight}
            scaleX={scale}
            scaleY={scale}
          >
            <Layer>
              {/* White page canvas background */}
              <Rect
                x={0}
                y={0}
                width={A4_BASE_WIDTH}
                height={A4_BASE_HEIGHT}
                fill="#ffffff"
              />

              {/* Added images on the canvas */}
              {images.map((item) => (
                <KonvaImage
                  key={item.id}
                  image={item.image}
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  draggable
                  onDragEnd={(e) => {
                    const { x, y } = e.target.position()
                    setImages((prev) =>
                      prev.map((img) =>
                        img.id === item.id ? { ...img, x, y } : img
                      )
                    )
                  }}
                />
              ))}
            </Layer>
          </Stage>
        </div>
      </main>
    </div>
  )
}
