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

interface CanvasPage {
  id: string
  images: CanvasImageItem[]
}

interface TransformingInfo {
  widthCm: number
  heightCm: number
  x: number
  y: number
}

interface ClipboardItem {
  src: string
  width: number
  height: number
  scaleX: number
  scaleY: number
  rotation: number
  x: number
  y: number
  sourcePageId: string
}

export default function App() {
  const [scale, setScale] = useState(1)
  const [pages, setPages] = useState<CanvasPage[]>([
    { id: 'page-1', images: [] },
  ])
  const [activePageIndex, setActivePageIndex] = useState<number>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAspectLocked, setIsAspectLocked] = useState(true)
  const [hasClipboard, setHasClipboard] = useState(false)
  const [focusedField, setFocusedField] = useState<'width' | 'height' | null>(
    null
  )
  const [inputWidth, setInputWidth] = useState('')
  const [inputHeight, setInputHeight] = useState('')
  const [transformingInfo, setTransformingInfo] =
    useState<TransformingInfo | null>(null)

  const workspaceRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const clipboardRef = useRef<ClipboardItem | null>(null)
  const pasteCountRef = useRef<number>(0)

  // Ensure active page index stays strictly within bounds
  const safePageIndex = Math.min(
    Math.max(0, activePageIndex),
    Math.max(0, pages.length - 1)
  )
  const currentPage = pages[safePageIndex] || { id: 'default', images: [] }
  const currentImages = currentPage.images

  const selectedImage =
    currentImages.find((img) => img.id === selectedId) || null

  // Helper to update only the active page's images
  const updateCurrentPageImages = useCallback(
    (
      updater:
        | CanvasImageItem[]
        | ((prev: CanvasImageItem[]) => CanvasImageItem[])
    ) => {
      setPages((prevPages) =>
        prevPages.map((page, idx) => {
          if (idx !== safePageIndex) return page
          const nextImages =
            typeof updater === 'function' ? updater(page.images) : updater
          return { ...page, images: nextImages }
        })
      )
    },
    [safePageIndex]
  )

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

  // 1. Auto-restore project from IndexedDB on startup (supports all pages)
  useEffect(() => {
    let isMounted = true

    async function restoreProject() {
      try {
        const saved = await loadProject()
        if (saved && isMounted) {
          const pagesToLoad =
            saved.pages && saved.pages.length > 0
              ? saved.pages
              : saved.images
                ? [{ id: 'page-default', images: saved.images }]
                : []

          if (pagesToLoad.length > 0) {
            const loadedPages: CanvasPage[] = await Promise.all(
              pagesToLoad.map(async (p) => {
                const loadedImages = await Promise.all(
                  p.images.map((item: SerializedImageItem) => {
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

                return {
                  id: p.id,
                  images: loadedImages.filter(
                    (img): img is CanvasImageItem => img !== null
                  ),
                }
              })
            )

            if (isMounted) {
              setPages(loadedPages)
              if (typeof saved.activePageIndex === 'number') {
                const targetIndex = Math.min(
                  Math.max(0, saved.activePageIndex),
                  loadedPages.length - 1
                )
                setActivePageIndex(targetIndex)
              }
            }
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

  // 2. Auto-save project locally to IndexedDB whenever pages or active page change
  useEffect(() => {
    if (!isLoaded) return // Do not overwrite before initial load finishes

    const timer = setTimeout(() => {
      const serializedPages = pages.map((page) => ({
        id: page.id,
        images: page.images.map((item) => ({
          id: item.id,
          src: item.src,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
          scaleX: item.scaleX,
          scaleY: item.scaleY,
        })),
      }))

      saveProject({
        version: 2,
        updatedAt: Date.now(),
        activePageIndex: safePageIndex,
        pages: serializedPages,
      }).catch((err) => {
        console.error('Failed to auto-save project:', err)
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [pages, safePageIndex, isLoaded])

  // 3. Attach Transformer to the selected node on the active page
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
  }, [selectedId, currentImages, isAspectLocked])

  // 4. Delete selected image logic
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return
    updateCurrentPageImages((prev) =>
      prev.filter((img) => img.id !== selectedId)
    )
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }, [selectedId, updateCurrentPageImages])

  // 5. Copy, Cut, Paste logic
  const handleCopy = useCallback(() => {
    if (!selectedImage) return
    clipboardRef.current = {
      src: selectedImage.src,
      width: selectedImage.width,
      height: selectedImage.height,
      scaleX: selectedImage.scaleX,
      scaleY: selectedImage.scaleY,
      rotation: selectedImage.rotation,
      x: selectedImage.x,
      y: selectedImage.y,
      sourcePageId: currentPage.id,
    }
    pasteCountRef.current = 0
    setHasClipboard(true)
  }, [selectedImage, currentPage.id])

  const handleCut = useCallback(() => {
    if (!selectedImage) return
    clipboardRef.current = {
      src: selectedImage.src,
      width: selectedImage.width,
      height: selectedImage.height,
      scaleX: selectedImage.scaleX,
      scaleY: selectedImage.scaleY,
      rotation: selectedImage.rotation,
      x: selectedImage.x,
      y: selectedImage.y,
      sourcePageId: currentPage.id,
    }
    pasteCountRef.current = 0
    setHasClipboard(true)

    // Remove from current page
    updateCurrentPageImages((prev) =>
      prev.filter((img) => img.id !== selectedImage.id)
    )
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }, [selectedImage, currentPage.id, updateCurrentPageImages])

  const handlePaste = useCallback(() => {
    const clip = clipboardRef.current
    if (!clip) return

    pasteCountRef.current += 1
    const offset =
      currentPage.id === clip.sourcePageId
        ? (pasteCountRef.current % 10) * 20
        : ((pasteCountRef.current - 1) % 10) * 20

    let newX = clip.x + offset
    let newY = clip.y + offset

    const effectiveW = clip.width * Math.abs(clip.scaleX)
    const effectiveH = clip.height * Math.abs(clip.scaleY)
    newX = Math.min(Math.max(16, newX), A4_BASE_WIDTH - effectiveW - 16)
    newY = Math.min(Math.max(16, newY), A4_BASE_HEIGHT - effectiveH - 16)

    const newImg = new window.Image()
    newImg.src = clip.src

    const newId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const newItem: CanvasImageItem = {
      id: newId,
      src: clip.src,
      image: newImg,
      x: Math.round(newX),
      y: Math.round(newY),
      width: clip.width,
      height: clip.height,
      scaleX: clip.scaleX,
      scaleY: clip.scaleY,
      rotation: clip.rotation,
    }

    updateCurrentPageImages((prev) => [...prev, newItem])
    setSelectedId(newId)
    setTransformingInfo(null)
    setFocusedField(null)
  }, [currentPage.id, updateCurrentPageImages])

  // 6. Print project
  const handlePrint = () => {
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
    window.print()
  }

  // 7. Desktop & macOS keyboard listener for Shortcuts (Delete, Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+X)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toUpperCase()
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        return
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault()
          handleDeleteSelected()
        }
        return
      }

      // Ctrl+C / Cmd+C (Copy)
      if (isCtrlOrCmd && (e.key === 'c' || e.key === 'C')) {
        if (selectedId) {
          e.preventDefault()
          handleCopy()
        }
        return
      }

      // Ctrl+V / Cmd+V (Paste)
      if (isCtrlOrCmd && (e.key === 'v' || e.key === 'V')) {
        if (clipboardRef.current) {
          e.preventDefault()
          handlePaste()
        }
        return
      }

      // Ctrl+X / Cmd+X (Cut)
      if (isCtrlOrCmd && (e.key === 'x' || e.key === 'X')) {
        if (selectedId) {
          e.preventDefault()
          handleCut()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId, handleDeleteSelected, handleCopy, handlePaste, handleCut])

  // 8. Manual Reset ("New Project")
  const handleNewProject = async () => {
    const confirmed = window.confirm(
      'Start a new project? This will clear all pages and elements from your canvas.'
    )
    if (!confirmed) return

    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
    setPages([{ id: 'page-1', images: [] }])
    setActivePageIndex(0)
    clipboardRef.current = null
    setHasClipboard(false)
    await clearSavedProject()
  }

  // 9. Multi-page controls
  const handleAddPage = () => {
    const newPage: CanvasPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      images: [],
    }
    setPages((prev) => [...prev, newPage])
    setActivePageIndex(pages.length)
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }

  const handleDuplicatePage = () => {
    const current = pages[safePageIndex]
    if (!current) return

    // Deep-clone images with fresh unique IDs so both pages remain strictly independent
    const clonedImages: CanvasImageItem[] = current.images.map((img, i) => ({
      ...img,
      id: `img-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
    }))

    const newPage: CanvasPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      images: clonedImages,
    }

    const nextPages = [...pages]
    nextPages.splice(safePageIndex + 1, 0, newPage)
    setPages(nextPages)
    setActivePageIndex(safePageIndex + 1)
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }

  const handleDeletePage = () => {
    if (pages.length <= 1) {
      alert('The project must retain at least one page.')
      return
    }

    const confirmed = window.confirm(
      `Delete Page ${safePageIndex + 1}? This action cannot be undone.`
    )
    if (!confirmed) return

    const nextPages = pages.filter((_, idx) => idx !== safePageIndex)
    setPages(nextPages)
    setActivePageIndex((prev) =>
      Math.max(0, Math.min(prev, nextPages.length - 1))
    )
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }

  const handlePrevPage = () => {
    if (safePageIndex > 0) {
      setActivePageIndex(safePageIndex - 1)
      setSelectedId(null)
      setTransformingInfo(null)
      setFocusedField(null)
    }
  }

  const handleNextPage = () => {
    if (safePageIndex < pages.length - 1) {
      setActivePageIndex(safePageIndex + 1)
      setSelectedId(null)
      setTransformingInfo(null)
      setFocusedField(null)
    }
  }

  // 10. Responsive scale calculation to fit A4 page on screen
  useEffect(() => {
    const handleResize = () => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const paddingX = window.innerWidth <= 640 ? 16 : 36
      const paddingY = window.innerWidth <= 640 ? 16 : 36
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

  // 11. Add Image handler supporting multiple files with staggered offset
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
      const currentCount = currentImages.length

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

      updateCurrentPageImages((prev) => [...prev, ...newItems])
      // Select the last imported image
      if (newItems.length > 0) {
        setSelectedId(newItems[newItems.length - 1].id)
      }
    } catch (err) {
      console.error('Failed to import one or more images:', err)
    }

    e.target.value = ''
  }

  // 12. Manual width and height input handlers
  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputWidth(val)
    const num = parseFloat(val)

    if (!isNaN(num) && num > 0 && selectedId) {
      updateCurrentPageImages((prev) =>
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
      updateCurrentPageImages((prev) =>
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

  // 13. Deselection when clicking empty space
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
            title="Start a new blank project"
          >
            <svg
              width="14"
              height="14"
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
            <span className="btn-text">New Project</span>
          </button>

          {/* Print Project button */}
          <button
            type="button"
            className="btn btn-print"
            onClick={handlePrint}
            title="Print all project pages (AirPrint on iOS / system print dialog)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span className="btn-text">Print</span>
          </button>

          <div className="toolbar-divider" />

          {/* Add Image button (supports multiple files) */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAddImageClick}
            title="Import one or more images onto the active page"
          >
            <svg
              width="14"
              height="14"
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
            <span className="btn-text">Add Image</span>
          </button>

          {/* Cut button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCut}
            disabled={!selectedId}
            title={
              selectedId
                ? 'Cut selected image (Ctrl+X / Cmd+X)'
                : 'Select an image to cut'
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <line x1="20" y1="4" x2="8.12" y2="15.88" />
              <line x1="14.47" y1="14.48" x2="20" y2="20" />
              <line x1="8.12" y1="8.12" x2="12" y2="12" />
            </svg>
            <span className="btn-text">Cut</span>
          </button>

          {/* Copy button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCopy}
            disabled={!selectedId}
            title={
              selectedId
                ? 'Copy selected image (Ctrl+C / Cmd+C)'
                : 'Select an image to copy'
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span className="btn-text">Copy</span>
          </button>

          {/* Paste button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handlePaste}
            disabled={!hasClipboard}
            title={
              hasClipboard
                ? 'Paste copied image onto active page (Ctrl+V / Cmd+V)'
                : 'Clipboard is empty'
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            <span className="btn-text">Paste</span>
          </button>

          {/* Delete selected image button */}
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleDeleteSelected}
            disabled={!selectedId}
            title={
              selectedId
                ? 'Delete selected image (Delete / Backspace)'
                : 'Select an image to delete'
            }
          >
            <svg
              width="14"
              height="14"
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
            <span className="btn-text">Delete</span>
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
            <span className="hint-badge">
              Page {safePageIndex + 1} of {pages.length}
            </span>
            <span>A4 • 21.0 × 29.7 cm</span>
            <span className="hint-divider">•</span>
            <span className="hint-sub">
              Select an image to adjust physical dimensions or copy/cut
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

              {/* Imported canvas images for the active page */}
              {currentImages.map((item) => (
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
                    updateCurrentPageImages((prev) =>
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
                    updateCurrentPageImages((prev) =>
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

      {/* Bottom page navigation & management bar */}
      <footer className="page-navigation-bar" aria-label="Page navigation bar">
        {/* Page navigation group */}
        <div className="page-nav-group">
          <button
            type="button"
            className="btn btn-nav"
            onClick={handlePrevPage}
            disabled={safePageIndex === 0}
            title="Go to previous page"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="text-label">Previous</span>
          </button>

          <div className="page-indicator" aria-live="polite">
            Page {safePageIndex + 1} / {pages.length}
          </div>

          <button
            type="button"
            className="btn btn-nav"
            onClick={handleNextPage}
            disabled={safePageIndex >= pages.length - 1}
            title="Go to next page"
          >
            <span className="text-label">Next</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Page actions group */}
        <div className="page-actions-group">
          {/* Add Page */}
          <button
            type="button"
            className="btn btn-page-action add-page"
            onClick={handleAddPage}
            title="Add a new blank A4 page"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>+ Add Page</span>
          </button>

          {/* Duplicate Page */}
          <button
            type="button"
            className="btn btn-page-action duplicate-page"
            onClick={handleDuplicatePage}
            title="Duplicate current page with all its images"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span className="text-label">Duplicate Page</span>
          </button>

          {/* Delete Page */}
          <button
            type="button"
            className="btn btn-page-danger"
            onClick={handleDeletePage}
            disabled={pages.length <= 1}
            title={
              pages.length <= 1
                ? 'Project must retain at least one page'
                : 'Delete current page'
            }
          >
            <svg
              width="14"
              height="14"
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
            </svg>
            <span className="text-label">Delete Page</span>
          </button>
        </div>
      </footer>

      {/* Multi-page printable layout for window.print() / AirPrint */}
      <div className="print-container" aria-hidden="true">
        {pages.map((page, pIndex) => (
          <section key={page.id || pIndex} className="print-page">
            {page.images.map((img) => (
              <img
                key={img.id}
                src={img.src}
                alt=""
                className="print-image"
                style={{
                  left: `${(img.x / A4_BASE_WIDTH) * 210}mm`,
                  top: `${(img.y / A4_BASE_HEIGHT) * 297}mm`,
                  width: `${((img.width * img.scaleX) / A4_BASE_WIDTH) * 210}mm`,
                  height: `${((img.height * img.scaleY) / A4_BASE_HEIGHT) * 297}mm`,
                  transform: `rotate(${img.rotation}deg)`,
                  transformOrigin: '0 0',
                }}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
