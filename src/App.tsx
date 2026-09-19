import React, { useState, useRef, useEffect, useCallback } from 'react'
import type Konva from 'konva'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Rect,
  Transformer,
  Group,
  Text,
} from 'react-konva'
import {
  saveProject,
  loadProject,
  clearSavedProject,
  type SerializedImageItem,
} from './storage'
import {
  A4_BASE_WIDTH,
  A4_BASE_HEIGHT,
  pxToCm,
  cmToPx,
  formatCm,
} from './units'
import './App.css'

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

interface TransformingInfo {
  widthCm: number
  heightCm: number
  x: number
  y: number
}

export default function App() {
  const [scale, setScale] = useState(1)
  const [images, setImages] = useState<CanvasImageItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAspectLocked, setIsAspectLocked] = useState(true)
  const [focusedField, setFocusedField] = useState<'width' | 'height' | null>(null)
  const [inputWidth, setInputWidth] = useState('')
  const [inputHeight, setInputHeight] = useState('')
  const [transformingInfo, setTransformingInfo] = useState<TransformingInfo | null>(null)

  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  const selectedImage = images.find((img) => img.id === selectedId) || null

  // Derived current physical measurements
  const currentPhysicalW = selectedImage
    ? pxToCm(Math.abs(selectedImage.width * selectedImage.scaleX))
    : 0
  const currentPhysicalH = selectedImage
    ? pxToCm(Math.abs(selectedImage.height * selectedImage.scaleY))
    : 0

  // Display values for numeric inputs (live during resize, editable during focus)
  const displayWidth =
    focusedField === 'width'
      ? inputWidth
      : transformingInfo
        ? formatCm(transformingInfo.widthCm)
        : selectedImage
          ? formatCm(currentPhysicalW)
          : ''

  const displayHeight =
    focusedField === 'height'
      ? inputHeight
      : transformingInfo
        ? formatCm(transformingInfo.heightCm)
        : selectedImage
          ? formatCm(currentPhysicalH)
          : ''

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
  }, [selectedId, images, isAspectLocked])

  // 4. Delete selected image logic
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return
    setImages((prev) => prev.filter((img) => img.id !== selectedId))
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
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
    setTransformingInfo(null)
    setFocusedField(null)
    await clearSavedProject()
  }

  // 7. Responsive scale calculation to fit A4 page on screen
  useEffect(() => {
    const handleResize = () => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const paddingX = window.innerWidth <= 640 ? 20 : 40
      const paddingY = window.innerWidth <= 640 ? 20 : 40
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

  // 8. Add Image handler supporting multiple files with staggered offset
  const handleAddImageClick = () => {
    fileInputRef.current?.click()
  }

  const handleImageFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    try {
      const loaded = await Promise.all(
        files.map((file) => {
          return new Promise<{ dataUrl: string; img: HTMLImageElement }>(
            (resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => {
                const dataUrl = reader.result as string
                const img = new window.Image()
                img.onload = () => resolve({ dataUrl, img })
                img.onerror = reject
                img.src = dataUrl
              }
              reader.onerror = reject
              reader.readAsDataURL(file)
            }
          )
        })
      )

      const OFFSET_STEP = 24
      const currentCount = images.length

      const newItems: CanvasImageItem[] = loaded.map(
        ({ dataUrl, img }, index) => {
          const maxInitialWidth = A4_BASE_WIDTH * 0.5
          const maxInitialHeight = A4_BASE_HEIGHT * 0.4
          let w = img.naturalWidth || img.width
          let h = img.naturalHeight || img.height

          const fitRatio = Math.min(maxInitialWidth / w, maxInitialHeight / h, 1)
          w = Math.round(w * fitRatio)
          h = Math.round(h * fitRatio)

          // Staggered offset so multiple images do not overlap exactly
          const offsetIndex = (currentCount + index) % 10
          const offsetX = offsetIndex * OFFSET_STEP
          const offsetY = offsetIndex * OFFSET_STEP

          const baseX = (A4_BASE_WIDTH - w) / 2
          const baseY = (A4_BASE_HEIGHT - h) / 2
          const x = Math.min(
            Math.max(16, baseX + offsetX),
            A4_BASE_WIDTH - w - 16
          )
          const y = Math.min(
            Math.max(16, baseY + offsetY),
            A4_BASE_HEIGHT - h - 16
          )

          return {
            id: `img-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
            src: dataUrl,
            image: img,
            x: Math.round(x),
            y: Math.round(y),
            width: w,
            height: h,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          }
        }
      )

      setImages((prev) => [...prev, ...newItems])
      // Select the last imported image
      if (newItems.length > 0) {
        setSelectedId(newItems[newItems.length - 1].id)
      }
    } catch (err) {
      console.error('Failed to import one or more images:', err)
    }

    e.target.value = ''
  }

  // 9. Manual width and height input handlers
  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputWidth(val)
    const num = parseFloat(val)

    if (!isNaN(num) && num > 0 && selectedId) {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id !== selectedId) return img
          const newLogicalW = cmToPx(num)
          const newScaleX = newLogicalW / img.width

          if (isAspectLocked) {
            const aspect =
              (img.width * img.scaleX) / (img.height * img.scaleY)
            const newLogicalH = newLogicalW / aspect
            const newScaleY = newLogicalH / img.height
            return { ...img, scaleX: newScaleX, scaleY: newScaleY }
          }
          return { ...img, scaleX: newScaleX }
        })
      )
    }
  }

  const handleWidthFocus = () => {
    setFocusedField('width')
    setInputWidth(formatCm(currentPhysicalW))
  }

  const handleWidthBlur = () => {
    setFocusedField(null)
  }

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputHeight(val)
    const num = parseFloat(val)

    if (!isNaN(num) && num > 0 && selectedId) {
      setImages((prev) =>
        prev.map((img) => {
          if (img.id !== selectedId) return img
          const newLogicalH = cmToPx(num)
          const newScaleY = newLogicalH / img.height

          if (isAspectLocked) {
            const aspect =
              (img.width * img.scaleX) / (img.height * img.scaleY)
            const newLogicalW = newLogicalH * aspect
            const newScaleX = newLogicalW / img.width
            return { ...img, scaleX: newScaleX, scaleY: newScaleY }
          }
          return { ...img, scaleY: newScaleY }
        })
      )
    }
  }

  const handleHeightFocus = () => {
    setFocusedField('height')
    setInputHeight(formatCm(currentPhysicalH))
  }

  const handleHeightBlur = () => {
    setFocusedField(null)
  }

  // 10. Deselection when clicking empty space
  const handleCanvasDeselect = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const target = e.target
    const isStage = target === target.getStage()
    const isPageBackground = target.name() === 'page-background'
    if (isStage || isPageBackground) {
      setSelectedId(null)
      setTransformingInfo(null)
      setFocusedField(null)
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

          {/* Add Image button (supports multiple files) */}
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
            title={
              selectedId ? 'Delete selected image' : 'Select an image to delete'
            }
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

          {/* Hidden multiple file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleImageFileChange}
          />
        </div>
      </header>

      {/* Properties sub-toolbar for physical measurements */}
      <nav className="properties-bar" aria-label="Physical measurements bar">
        {selectedImage ? (
          <div className="properties-content">
            <span className="properties-label">Size:</span>

            {/* Width input */}
            <div className="input-group">
              <label htmlFor="prop-width" className="input-prefix">
                W
              </label>
              <input
                id="prop-width"
                type="number"
                step="0.1"
                min="0.1"
                value={displayWidth}
                onChange={handleWidthChange}
                onFocus={handleWidthFocus}
                onBlur={handleWidthBlur}
                className="size-input"
                aria-label="Image width in centimeters"
              />
              <span className="input-suffix">cm</span>
            </div>

            {/* Aspect ratio lock toggle */}
            <button
              type="button"
              className={`btn-aspect-lock ${isAspectLocked ? 'locked' : 'unlocked'}`}
              onClick={() => setIsAspectLocked(!isAspectLocked)}
              title={
                isAspectLocked
                  ? 'Aspect ratio locked (click to unlock)'
                  : 'Aspect ratio unlocked (click to lock)'
              }
            >
              {isAspectLocked ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                </svg>
              )}
              <span className="aspect-lock-text">
                {isAspectLocked ? 'Locked' : 'Unlocked'}
              </span>
            </button>

            {/* Height input */}
            <div className="input-group">
              <label htmlFor="prop-height" className="input-prefix">
                H
              </label>
              <input
                id="prop-height"
                type="number"
                step="0.1"
                min="0.1"
                value={displayHeight}
                onChange={handleHeightChange}
                onFocus={handleHeightFocus}
                onBlur={handleHeightBlur}
                className="size-input"
                aria-label="Image height in centimeters"
              />
              <span className="input-suffix">cm</span>
            </div>
          </div>
        ) : (
          <div className="properties-hint">
            <span className="hint-badge">A4 Page</span>
            <span>21.0 × 29.7 cm</span>
            <span className="hint-divider">•</span>
            <span className="hint-sub">
              Select an image to adjust its physical dimensions
            </span>
          </div>
        )}
      </nav>

      {/* Light gray workspace */}
      <main
        className="workspace"
        ref={workspaceRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedId(null)
            setTransformingInfo(null)
            setFocusedField(null)
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
                  onTransform={(e) => {
                    const node = e.target
                    const scaleX = node.scaleX()
                    const scaleY = node.scaleY()
                    const curLogicalW = Math.abs(node.width() * scaleX)
                    const curLogicalH = Math.abs(node.height() * scaleY)
                    const wCm = pxToCm(curLogicalW)
                    const hCm = pxToCm(curLogicalH)

                    // Compute live badge position in logical coordinates
                    const clientRect = node.getClientRect({ skipShadow: true })
                    const logicalCenterX =
                      (clientRect.x + clientRect.width / 2) / scale
                    const logicalBottomY =
                      (clientRect.y + clientRect.height) / scale + 18
                    const badgeY =
                      logicalBottomY > A4_BASE_HEIGHT - 20
                        ? Math.max(16, clientRect.y / scale - 18)
                        : logicalBottomY

                    setTransformingInfo({
                      widthCm: wCm,
                      heightCm: hCm,
                      x: logicalCenterX,
                      y: badgeY,
                    })
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
                    setTransformingInfo(null)
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
                keepRatio={isAspectLocked}
                enabledAnchors={
                  isAspectLocked
                    ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
                    : [
                        'top-left',
                        'top-center',
                        'top-right',
                        'middle-right',
                        'bottom-right',
                        'bottom-center',
                        'bottom-left',
                        'middle-left',
                      ]
                }
                boundBoxFunc={(oldBox, newBox) => {
                  if (
                    Math.abs(newBox.width) < 8 ||
                    Math.abs(newBox.height) < 8
                  ) {
                    return oldBox
                  }
                  return newBox
                }}
              />

              {/* Unobtrusive live resize label badge */}
              {transformingInfo && (
                <Group
                  x={transformingInfo.x}
                  y={transformingInfo.y}
                  listening={false}
                >
                  <Rect
                    x={-52}
                    y={-12}
                    width={104}
                    height={24}
                    fill="rgba(15, 23, 42, 0.88)"
                    cornerRadius={5}
                    shadowColor="rgba(0, 0, 0, 0.3)"
                    shadowBlur={6}
                    shadowOffsetY={2}
                  />
                  <Text
                    x={-52}
                    y={-12}
                    width={104}
                    height={24}
                    text={`${formatCm(transformingInfo.widthCm)} × ${formatCm(transformingInfo.heightCm)} cm`}
                    fontSize={11}
                    fontFamily="system-ui, -apple-system, sans-serif"
                    fontStyle="bold"
                    fill="#ffffff"
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>
              )}
            </Layer>
          </Stage>
        </div>
      </main>
    </div>
  )
}
