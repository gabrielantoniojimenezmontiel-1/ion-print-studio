import React, { useState, useRef, useEffect, useCallback } from 'react'
import type Konva from 'konva'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer } from 'react-konva'
import {
  saveProject,
  loadProject,
  clearSavedProject,
  type SerializedImageItem,
} from './storage'
import './App.css'

// A4 standard points ratio (210mm x 297mm)
const A4_BASE_WIDTH = 595
const A4_BASE_HEIGHT = 842

interface CanvasImageItem {
  id: string
  src: string
  image: HTMLImageElement
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
}

export default function App() {
  const [scale, setScale] = useState(1)
  const [images, setImages] = useState<CanvasImageItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  // 1. Auto-restore project from IndexedDB on startup
  useEffect(() => {
    let isMounted = true

    async function restoreProject() {
      try {
        const saved = await loadProject()
        if (saved && saved.images && saved.images.length > 0 && isMounted) {
          const loadedImages = await Promise.all(
            saved.images.map((item: SerializedImageItem) => {
              return new Promise<CanvasImageItem | null>((resolve) => {
                const img = new window.Image()
                img.onload = () => {
                  resolve({
                    id: item.id,
                    src: item.src,
                    image: img,
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                    rotation: item.rotation ?? 0,
                    scaleX: item.scaleX ?? 1,
                    scaleY: item.scaleY ?? 1,
                  })
                }
                img.onerror = () => {
                  console.warn('Failed to load saved image:', item.id)
                  resolve(null)
                }
                img.src = item.src
              })
            })
          )

          if (isMounted) {
            const valid = loadedImages.filter(
              (img): img is CanvasImageItem => img !== null
            )
            setImages(valid)
          }
        }
      } catch (err) {
        console.error('Failed to restore project from IndexedDB:', err)
      } finally {
        if (isMounted) {
          setIsLoaded(true)
        }
      }
    }

    restoreProject()
    return () => {
      isMounted = false
    }
  }, [])

  // 2. Auto-save project locally to IndexedDB whenever images change
  useEffect(() => {
    if (!isLoaded) return // Do not overwrite before initial load finishes

    const timer = setTimeout(() => {
      const serialized: SerializedImageItem[] = images.map((item) => ({
        id: item.id,
        src: item.src,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
      }))

      saveProject({
        version: 1,
        updatedAt: Date.now(),
        images: serialized,
      }).catch((err) => {
        console.error('Failed to auto-save project:', err)
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [images, isLoaded])

  // 3. Attach Transformer to the selected node
  useEffect(() => {
    if (!transformerRef.current) return
    const stage = transformerRef.current.getStage()
    if (!stage) return

    if (selectedId) {
      const selectedNode = stage.findOne('#' + selectedId)
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode])
        transformerRef.current.getLayer()?.batchDraw()
        return
      }
    }

    transformerRef.current.nodes([])
    transformerRef.current.getLayer()?.batchDraw()
  }, [selectedId, images])

  // 4. Delete selected image logic
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return
    setImages((prev) => prev.filter((img) => img.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  // 5. Desktop keyboard listener for Delete / Backspace
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeTag = (document.activeElement?.tagName || '').toUpperCase()
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
          return
        }
        if (selectedId) {
          e.preventDefault()
          handleDeleteSelected()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId, handleDeleteSelected])

  // 6. Manual Reset ("New Project")
  const handleNewProject = async () => {
    const confirmed = window.confirm(
      'Start a new project? This will clear all elements from your canvas.'
    )
    if (!confirmed) return

    setSelectedId(null)
    setImages([])
    await clearSavedProject()
  }

  // 7. Responsive scale calculation to fit A4 page on screen
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
      const fittedScale = Math.min(scaleX, scaleY, 1.1)
      setScale(Math.max(fittedScale, 0.1))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 8. Add Image handler
  const handleAddImageClick = () => {
    fileInputRef.current?.click()
  }

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new window.Image()
      img.onload = () => {
        const maxInitialWidth = A4_BASE_WIDTH * 0.6
        const maxInitialHeight = A4_BASE_HEIGHT * 0.5
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height

        const fitRatio = Math.min(maxInitialWidth / w, maxInitialHeight / h, 1)
        w = Math.round(w * fitRatio)
        h = Math.round(h * fitRatio)

        const newId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

        setImages((prev) => [
          ...prev,
          {
            id: newId,
            src: dataUrl,
            image: img,
            x: Math.round((A4_BASE_WIDTH - w) / 2),
            y: Math.round((A4_BASE_HEIGHT - h) / 2),
            width: w,
            height: h,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          },
        ])
        // Automatically select the newly added image
        setSelectedId(newId)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // 9. Deselection when clicking empty space
  const handleCanvasDeselect = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const target = e.target
    const isStage = target === target.getStage()
    const isPageBackground = target.name() === 'page-background'
    if (isStage || isPageBackground) {
      setSelectedId(null)
    }
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
          {/* New Project button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleNewProject}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            New Project
          </button>

          {/* Add Image button */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAddImageClick}
          >
            <svg
              width="15"
              height="15"
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

          {/* Delete button */}
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDeleteSelected}
            disabled={!selectedId}
            title={selectedId ? 'Delete selected image' : 'Select an image to delete'}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Delete
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
      <main
        className="workspace"
        ref={workspaceRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedId(null)
          }
        }}
      >
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
            onMouseDown={handleCanvasDeselect}
            onTouchStart={handleCanvasDeselect}
          >
            <Layer>
              {/* White A4 printable page background */}
              <Rect
                name="page-background"
                x={0}
                y={0}
                width={A4_BASE_WIDTH}
                height={A4_BASE_HEIGHT}
                fill="#ffffff"
              />

              {/* Imported canvas images */}
              {images.map((item) => (
                <KonvaImage
                  id={item.id}
                  key={item.id}
                  image={item.image}
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  scaleX={item.scaleX}
                  scaleY={item.scaleY}
                  rotation={item.rotation}
                  draggable
                  onClick={(e) => {
                    e.cancelBubble = true
                    setSelectedId(item.id)
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true
                    setSelectedId(item.id)
                  }}
                  onDragStart={() => {
                    setSelectedId(item.id)
                  }}
                  onDragEnd={(e) => {
                    const node = e.target
                    setImages((prev) =>
                      prev.map((img) =>
                        img.id === item.id
                          ? {
                              ...img,
                              x: Math.round(node.x()),
                              y: Math.round(node.y()),
                            }
                          : img
                      )
                    )
                  }}
                  onTransformEnd={(e) => {
                    const node = e.target
                    setImages((prev) =>
                      prev.map((img) =>
                        img.id === item.id
                          ? {
                              ...img,
                              x: Math.round(node.x()),
                              y: Math.round(node.y()),
                              scaleX: node.scaleX(),
                              scaleY: node.scaleY(),
                              rotation: Math.round(node.rotation() * 10) / 10,
                            }
                          : img
                      )
                    )
                  }}
                />
              ))}

              {/* Selection transformer with resize & rotate handles */}
              <Transformer
                ref={transformerRef}
                borderStroke="#2563eb"
                borderStrokeWidth={1.5}
                anchorStroke="#2563eb"
                anchorFill="#ffffff"
                anchorSize={window.innerWidth <= 640 ? 12 : 9}
                anchorCornerRadius={2}
                rotateAnchorOffset={24}
                boundBoxFunc={(oldBox, newBox) => {
                  if (
                    Math.abs(newBox.width) < 10 ||
                    Math.abs(newBox.height) < 10
                  ) {
                    return oldBox
                  }
                  return newBox
                }}
              />
            </Layer>
          </Stage>
        </div>
      </main>
    </div>
  )
}
