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
  type SerializedTextItem,
} from './storage'
import {
  pxToCm,
  cmToPx,
  formatCm,
  PAGE_PRESETS,
  pageDimensions,
  type PagePreset,
  type PageOrientation,
} from './units'
import { renderAllPagesForPrint } from './printRenderer'
import './App.css'

const APP_VERSION = '0.2.0'
const PRINT_STYLE_ID = 'ion-print-page-style'

interface CanvasImageItem {
  type: 'image'
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

interface CanvasTextItem {
  type: 'text'
  id: string
  text: string
  fontFamily: string
  fontSize: number
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
  texts: CanvasTextItem[]
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

interface HistorySnapshot {
  pages: CanvasPage[]
  activePageIndex: number
}

type SelectedItem = CanvasImageItem | CanvasTextItem

export default function App() {
  const [fitScale, setFitScale] = useState(1)
  const [zoomFactor, setZoomFactor] = useState(1)
  const [pages, setPages] = useState<CanvasPage[]>([
    { id: 'page-1', images: [], texts: [] },
  ])
  const [pagePreset, setPagePreset] = useState<PagePreset>('A4')
  const [orientation, setOrientation] = useState<PageOrientation>('portrait')
  const [activePageIndex, setActivePageIndex] = useState<number>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isAspectLocked, setIsAspectLocked] = useState(true)
  const [hasClipboard, setHasClipboard] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [printSheets, setPrintSheets] = useState<string[]>([])
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
  const pagesRef = useRef(pages)
  const activePageIndexRef = useRef(activePageIndex)
  const historyRef = useRef<{
    past: HistorySnapshot[]
    future: HistorySnapshot[]
  }>({ past: [], future: [] })
  const previousDimensionsRef = useRef<{ width: number; height: number } | null>(
    null
  )

  useEffect(() => {
    pagesRef.current = pages
    activePageIndexRef.current = activePageIndex
  }, [activePageIndex, pages])

  // Ensure active page index stays strictly within bounds
  const safePageIndex = Math.min(
    Math.max(0, activePageIndex),
    Math.max(0, pages.length - 1)
  )
  const currentPage = pages[safePageIndex] || { id: 'default', images: [], texts: [] }
  const currentImages = currentPage.images
  const currentTexts = currentPage.texts
  const dimensions = pageDimensions(pagePreset, orientation)

  const selectedImage =
    currentImages.find((img) => img.id === selectedId) || null
  const selectedText =
    currentTexts.find((item) => item.id === selectedId) || null
  const selectedItem: SelectedItem | null = selectedImage || selectedText

  // Helper to update only the active page's images
  const clonePages = useCallback((sourcePages: CanvasPage[]) => {
    return sourcePages.map((page) => ({
      ...page,
      images: page.images.map((image) => ({ ...image })),
      texts: page.texts.map((text) => ({ ...text })),
    }))
  }, [])

  const recordHistory = useCallback(() => {
    historyRef.current.past = [
      ...historyRef.current.past.slice(-49),
      {
        pages: clonePages(pagesRef.current),
        activePageIndex: activePageIndexRef.current,
      },
    ]
    historyRef.current.future = []
  }, [clonePages])

  useEffect(() => {
    const previous = previousDimensionsRef.current
    previousDimensionsRef.current = { width: dimensions.width, height: dimensions.height }
    if (
      !isLoaded ||
      !previous ||
      (previous.width === dimensions.width && previous.height === dimensions.height)
    ) return
    recordHistory()
    const scaleX = dimensions.width / previous.width
    const scaleY = dimensions.height / previous.height
    setPages((currentPages) =>
      currentPages.map((page) => ({
        ...page,
        images: page.images.map((item) => ({ ...item, x: item.x * scaleX, y: item.y * scaleY })),
        texts: page.texts.map((item) => ({
          ...item,
          x: item.x * scaleX,
          y: item.y * scaleY,
          width: item.width * scaleX,
          height: item.height * scaleY,
        })),
      }))
    )
  }, [dimensions.height, dimensions.width, isLoaded, recordHistory])

  const updateCurrentPageImages = useCallback(
    (
      updater:
        | CanvasImageItem[]
        | ((prev: CanvasImageItem[]) => CanvasImageItem[]),
      shouldRecordHistory = true
    ) => {
      if (shouldRecordHistory) recordHistory()
      setPages((prevPages) =>
        prevPages.map((page, idx) => {
          if (idx !== safePageIndex) return page
          const nextImages =
            typeof updater === 'function' ? updater(page.images) : updater
          return { ...page, images: nextImages }
        })
      )
    },
    [recordHistory, safePageIndex]
  )

  const updateCurrentPageTexts = useCallback(
    (
      updater:
        | CanvasTextItem[]
        | ((prev: CanvasTextItem[]) => CanvasTextItem[]),
      shouldRecordHistory = true
    ) => {
      if (shouldRecordHistory) recordHistory()
      setPages((prevPages) =>
        prevPages.map((page, idx) => {
          if (idx !== safePageIndex) return page
          const nextTexts =
            typeof updater === 'function' ? updater(page.texts) : updater
          return { ...page, texts: nextTexts }
        })
      )
    },
    [recordHistory, safePageIndex]
  )

  const restoreHistorySnapshot = useCallback((snapshot: HistorySnapshot) => {
    setPages(clonePages(snapshot.pages))
    setActivePageIndex(snapshot.activePageIndex)
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }, [clonePages])

  const handleUndo = useCallback(() => {
    const entry = historyRef.current.past.pop()
    if (!entry) return
    historyRef.current.future.push({
      pages: clonePages(pagesRef.current),
      activePageIndex: activePageIndexRef.current,
    })
    restoreHistorySnapshot(entry)
  }, [clonePages, restoreHistorySnapshot])

  const handleRedo = useCallback(() => {
    const entry = historyRef.current.future.pop()
    if (!entry) return
    historyRef.current.past.push({
      pages: clonePages(pagesRef.current),
      activePageIndex: activePageIndexRef.current,
    })
    restoreHistorySnapshot(entry)
  }, [clonePages, restoreHistorySnapshot])

  // Derived current physical measurements
  const currentPhysicalW = selectedItem
    ? pxToCm(Math.abs(selectedItem.width * selectedItem.scaleX))
    : 0
  const currentPhysicalH = selectedItem
    ? pxToCm(Math.abs(selectedItem.height * selectedItem.scaleY))
    : 0

  // Display values for numeric inputs (live during resize, editable during focus)
  const displayWidth =
    focusedField === 'width'
      ? inputWidth
      : transformingInfo
        ? formatCm(transformingInfo.widthCm)
        : selectedItem
          ? formatCm(currentPhysicalW)
          : ''

  const displayHeight =
    focusedField === 'height'
      ? inputHeight
      : transformingInfo
        ? formatCm(transformingInfo.heightCm)
        : selectedItem
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
                          type: 'image',
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
                const loadedTexts: CanvasTextItem[] = (p.texts || []).map(
                  (item: SerializedTextItem) => ({
                    type: 'text',
                    ...item,
                    rotation: item.rotation ?? 0,
                    scaleX: item.scaleX ?? 1,
                    scaleY: item.scaleY ?? 1,
                  })
                )

                return {
                  id: p.id,
                  images: loadedImages.filter(
                    (img): img is CanvasImageItem => img !== null
                  ),
                  texts: loadedTexts,
                }
              })
            )

            if (isMounted) {
              setPages(loadedPages)
              if (saved.pagePreset) setPagePreset(saved.pagePreset)
              if (saved.orientation) setOrientation(saved.orientation)
              historyRef.current = { past: [], future: [] }
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
        texts: page.texts.map((item) => ({
          id: item.id,
          text: item.text,
          fontFamily: item.fontFamily,
          fontSize: item.fontSize,
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
        pagePreset,
        orientation,
        pages: serializedPages,
      }).catch((err) => {
        console.error('Failed to auto-save project:', err)
      })
    }, 300)

    return () => clearTimeout(timer)
  }, [pages, safePageIndex, isLoaded, pagePreset, orientation])

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
  }, [selectedId, currentImages, currentTexts, isAspectLocked])

  // 4. Delete selected image logic
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return
    if (selectedImage) {
      updateCurrentPageImages((prev) =>
        prev.filter((img) => img.id !== selectedId)
      )
    } else if (selectedText) {
      updateCurrentPageTexts((prev) =>
        prev.filter((text) => text.id !== selectedId)
      )
    }
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }, [selectedId, selectedImage, selectedText, updateCurrentPageImages, updateCurrentPageTexts])

  const handleAddText = useCallback(() => {
    const width = Math.min(260, dimensions.width - 32)
    const text: CanvasTextItem = {
      type: 'text',
      id: `text-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      text: 'Title',
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: 32,
      x: Math.max(16, (dimensions.width - width) / 2),
      y: Math.max(16, (dimensions.height - 48) / 2),
      width,
      height: 48,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    }
    updateCurrentPageTexts((prev) => [...prev, text])
    setSelectedId(text.id)
  }, [dimensions.height, dimensions.width, updateCurrentPageTexts])

  const handleDuplicateSelected = useCallback(() => {
    if (!selectedImage) return
    const duplicate: CanvasImageItem = {
      ...selectedImage,
      id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      x: Math.min(selectedImage.x + 20, dimensions.width - selectedImage.width * Math.abs(selectedImage.scaleX) - 16),
      y: Math.min(selectedImage.y + 20, dimensions.height - selectedImage.height * Math.abs(selectedImage.scaleY) - 16),
    }
    updateCurrentPageImages((prev) => {
      const index = prev.findIndex((image) => image.id === selectedImage.id)
      return [...prev.slice(0, index + 1), duplicate, ...prev.slice(index + 1)]
    })
    setSelectedId(duplicate.id)
  }, [selectedImage, updateCurrentPageImages, dimensions.width, dimensions.height])

  const handleBringForward = useCallback(() => {
    if (!selectedId) return
    updateCurrentPageImages((prev) => {
      const index = prev.findIndex((image) => image.id === selectedId)
      if (index < 0 || index === prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }, [selectedId, updateCurrentPageImages])

  const handleSendBackward = useCallback(() => {
    if (!selectedId) return
    updateCurrentPageImages((prev) => {
      const index = prev.findIndex((image) => image.id === selectedId)
      if (index <= 0) return prev
      const next = [...prev]
      ;[next[index], next[index - 1]] = [next[index - 1], next[index]]
      return next
    })
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
    newX = Math.min(Math.max(16, newX), dimensions.width - effectiveW - 16)
    newY = Math.min(Math.max(16, newY), dimensions.height - effectiveH - 16)

    const newImg = new window.Image()
    newImg.src = clip.src

    const newId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const newItem: CanvasImageItem = {
        type: 'image',
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
  }, [currentPage.id, updateCurrentPageImages, dimensions.width, dimensions.height])

  // 6. High-resolution print handler
  const handlePrint = async () => {
    if (isPrinting) return
    setIsPrinting(true)
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)

    try {
      // Render every page offscreen at pixelRatio: 3 (~300 DPI)
      const renderedSheets = await renderAllPagesForPrint(
        pages.map((page) => ({
          ...page,
          width: dimensions.width,
          height: dimensions.height,
        })),
        3
      )
      setPrintSheets(renderedSheets)

      const printStyle =
        document.getElementById(PRINT_STYLE_ID) ||
        document.head.appendChild(document.createElement('style'))
      printStyle.id = PRINT_STYLE_ID
      printStyle.textContent = `
        @page {
          size: ${dimensions.widthCm}cm ${dimensions.heightCm}cm;
          margin: 0;
        }
      `

      // Pre-decode all sheet images to ensure iOS Safari / WebKit has them in memory
      await Promise.all(
        renderedSheets.map((src) => {
          const preImg = new window.Image()
          preImg.src = src
          return preImg.decode ? preImg.decode().catch(() => {}) : Promise.resolve()
        })
      )

      // Brief animation frame pause for print DOM layout pass
      await new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 80))
      )

      window.print()
    } catch (err) {
      console.error('Print generation failed:', err)
      alert(
        'Failed to prepare pages for printing: ' +
          (err instanceof Error ? err.message : 'Unknown error')
      )
    } finally {
      setIsPrinting(false)
    }
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

      if (isCtrlOrCmd && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        handleUndo()
        return
      }

      if (
        isCtrlOrCmd &&
        e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedId,
    handleDeleteSelected,
    handleCopy,
    handlePaste,
    handleCut,
    handleUndo,
    handleRedo,
  ])

  // 8. Manual Reset ("New Project")
  const handleNewProject = async () => {
    const confirmed = window.confirm(
      'Clear all pages and images? This permanently resets the project to one blank A4 page.'
    )
    if (!confirmed) return

    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
    setPages([{ id: 'page-1', images: [], texts: [] }])
    setActivePageIndex(0)
    setPagePreset('A4')
    setOrientation('portrait')
    setPrintSheets([])
    clipboardRef.current = null
    setHasClipboard(false)
    await clearSavedProject()
  }

  const handleClearPage = () => {
    if (currentImages.length === 0 && currentTexts.length === 0) return
    const confirmed = window.confirm(
      `Clear all objects from Page ${safePageIndex + 1}? Other pages will be preserved.`
    )
    if (!confirmed) return
    updateCurrentPageImages([])
    updateCurrentPageTexts([])
    setSelectedId(null)
    setTransformingInfo(null)
    setFocusedField(null)
  }

  // 9. Multi-page controls
  const handleAddPage = () => {
    recordHistory()
    const newPage: CanvasPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      images: [],
      texts: [],
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
    recordHistory()

    // Deep-clone images with fresh unique IDs so both pages remain strictly independent
    const clonedImages: CanvasImageItem[] = current.images.map((img, i) => ({
      ...img,
      id: `img-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
    }))
    const clonedTexts: CanvasTextItem[] = current.texts.map((text, i) => ({
      ...text,
      id: `text-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
    }))

    const newPage: CanvasPage = {
      id: `page-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      images: clonedImages,
      texts: clonedTexts,
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

    recordHistory()
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

      const scaleX = availWidth / dimensions.width
      const scaleY = availHeight / dimensions.height
      const fittedScale = Math.min(scaleX, scaleY, 1.1)
      setFitScale(Math.max(fittedScale, 0.1))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [dimensions.width, dimensions.height])

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
          const maxInitialWidth = dimensions.width * 0.5
          const maxInitialHeight = dimensions.height * 0.4
          let w = img.naturalWidth || img.width
          let h = img.naturalHeight || img.height

          const fitRatio = Math.min(maxInitialWidth / w, maxInitialHeight / h, 1)
          w = Math.round(w * fitRatio)
          h = Math.round(h * fitRatio)

          // Staggered offset so multiple images do not overlap exactly
          const offsetIndex = (currentCount + index) % 10
          const offsetX = offsetIndex * OFFSET_STEP
          const offsetY = offsetIndex * OFFSET_STEP

          const baseX = (dimensions.width - w) / 2
          const baseY = (dimensions.height - h) / 2
          const x = Math.min(
            Math.max(16, baseX + offsetX),
            dimensions.width - w - 16
          )
          const y = Math.min(
            Math.max(16, baseY + offsetY),
            dimensions.height - h - 16
          )

          return {
            type: 'image',
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

  const visualScale = fitScale * zoomFactor
  const pageWidth = Math.round(dimensions.width * visualScale)
  const pageHeight = Math.round(dimensions.height * visualScale)
  const handleZoomOut = () =>
    setZoomFactor((value) => Math.max(0.25, Math.round((value / 1.25) * 100) / 100))
  const handleZoomIn = () =>
    setZoomFactor((value) => Math.min(4, Math.round((value * 1.25) * 100) / 100))
  const handleFit = () => setZoomFactor(1)

  return (
    <div className="app-container">
      {/* Top toolbar */}
      <header className="top-toolbar">
        <div className="toolbar-brand">
          <div className="brand-icon">ION</div>
          <h1 className="app-title">ION Print Studio</h1>
          <span className="app-version">v{APP_VERSION}</span>
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

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClearPage}
            disabled={currentImages.length === 0 && currentTexts.length === 0}
            title="Clear every object from the current page"
          >
            <span className="btn-text">Clear Page</span>
          </button>

          <div className="toolbar-divider" />
          <button
            type="button"
            className="btn btn-secondary history-button history-undo"
            onClick={handleUndo}
            title="Undo (Ctrl/Cmd+Z)"
          >
            <span aria-hidden="true">↶</span>
            <span className="btn-text">Undo</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary history-button history-redo"
            onClick={handleRedo}
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            <span aria-hidden="true">↷</span>
            <span className="btn-text">Redo</span>
          </button>

          {/* Print Project button */}
          <button
            type="button"
            className="btn btn-print"
            onClick={handlePrint}
            disabled={isPrinting}
            title="Print all project pages in high resolution (AirPrint on iOS)"
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
            <span className="btn-text">
              {isPrinting ? 'Preparing...' : 'Print'}
            </span>
          </button>

          <div className="toolbar-divider" />
          <div className="page-size-controls" aria-label="Project page size">
            <select value={pagePreset} onChange={(e) => setPagePreset(e.target.value as PagePreset)} aria-label="Page size">
              {Object.keys(PAGE_PRESETS).map((preset) => (
                <option key={preset} value={preset}>{preset}</option>
              ))}
            </select>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as PageOrientation)} aria-label="Orientation">
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>

          {/* Add Image button (supports multiple files) */}
          <button
            type="button"
            className="btn btn-primary btn-add-image"
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
          <button
            type="button"
            className="btn btn-primary btn-add-text"
            onClick={handleAddText}
            title="Add a text box to the active page"
          >
            <span aria-hidden="true">T</span>
            <span className="btn-text">Add Text</span>
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
        {selectedText ? (
          <div className="properties-content text-properties">
            <label htmlFor="text-content">Text</label>
            <input
              id="text-content"
              className="text-property-input"
              value={selectedText.text}
              onChange={(e) =>
                updateCurrentPageTexts((prev) =>
                  prev.map((item) =>
                    item.id === selectedText.id
                      ? { ...item, text: e.target.value }
                      : item
                  )
                )
              }
            />
            <label htmlFor="text-font">Font</label>
            <select
              id="text-font"
              value={selectedText.fontFamily}
              onChange={(e) =>
                updateCurrentPageTexts((prev) =>
                  prev.map((item) =>
                    item.id === selectedText.id
                      ? { ...item, fontFamily: e.target.value }
                      : item
                  )
                )
              }
            >
              <option value="Arial, Helvetica, sans-serif">Arial</option>
              <option value='"Arial Black", Arial, Helvetica, sans-serif'>
                Arial Black
              </option>
            </select>
            <label htmlFor="text-size">Size</label>
            <input
              id="text-size"
              className="text-size-input"
              type="number"
              min="8"
              max="300"
              value={selectedText.fontSize}
              onChange={(e) => {
                const fontSize = Math.max(8, Number(e.target.value) || 8)
                updateCurrentPageTexts((prev) =>
                  prev.map((item) =>
                    item.id === selectedText.id ? { ...item, fontSize } : item
                  )
                )
              }}
            />
            <span className="input-suffix">px</span>
            <button type="button" className="btn btn-compact-action btn-danger" onClick={handleDeleteSelected}>
              Delete
            </button>
          </div>
        ) : selectedImage ? (
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

            <div className="selection-actions" aria-label="Selected image actions">
              <button type="button" className="btn btn-compact-action" onClick={handleDuplicateSelected}>
                Duplicate
              </button>
              <button type="button" className="btn btn-compact-action" onClick={handleBringForward}>
                Forward
              </button>
              <button type="button" className="btn btn-compact-action" onClick={handleSendBackward}>
                Back
              </button>
              <button type="button" className="btn btn-compact-action btn-danger" onClick={handleDeleteSelected}>
                Delete
              </button>
            </div>
          </div>
        ) : (
          <div className="properties-hint">
            <span className="hint-badge">
              Page {safePageIndex + 1} of {pages.length}
            </span>
            <label htmlFor="page-preset">Page</label>
            <select id="page-preset" value={pagePreset} onChange={(e) => setPagePreset(e.target.value as PagePreset)}>
              {Object.keys(PAGE_PRESETS).map((preset) => <option key={preset} value={preset}>{preset}</option>)}
            </select>
            <select value={orientation} onChange={(e) => setOrientation(e.target.value as PageOrientation)} aria-label="Page orientation">
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
            <span>{pagePreset} • {formatCm(dimensions.widthCm)} × {formatCm(dimensions.heightCm)} cm</span>
            <span className="hint-divider">•</span>
            <span className="hint-sub">
              Select an object to adjust dimensions or copy/cut
            </span>
          </div>
        )}
      </nav>

      <div className="mobile-edit-controls" aria-label="Mobile page controls">
        <label>
          <span>Page</span>
          <select
            value={pagePreset}
            onChange={(e) => setPagePreset(e.target.value as PagePreset)}
            aria-label="Page size"
          >
            {Object.keys(PAGE_PRESETS).map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Orientation</span>
          <select
            value={orientation}
            onChange={(e) =>
              setOrientation(e.target.value as PageOrientation)
            }
            aria-label="Page orientation"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
      </div>

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
        <div className="zoom-controls" aria-label="Visual editor zoom">
          <button type="button" className="zoom-button" onClick={handleZoomOut} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="zoom-value" onClick={handleFit} title="Fit page to workspace">
            {Math.round(zoomFactor * 100)}%
          </button>
          <button type="button" className="zoom-button" onClick={handleZoomIn} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="zoom-fit" onClick={handleFit}>
            Fit
          </button>
        </div>
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
            scaleX={visualScale}
            scaleY={visualScale}
            onMouseDown={handleCanvasDeselect}
            onTouchStart={handleCanvasDeselect}
          >
            <Layer>
              {/* White A4 printable page background */}
              <Rect
                name="page-background"
                x={0}
                y={0}
                width={dimensions.width}
                height={dimensions.height}
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
                    recordHistory()
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
                      ),
                      false
                    )
                  }}
                  onTransformStart={() => {
                    recordHistory()
                    setSelectedId(item.id)
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
                      (clientRect.x + clientRect.width / 2) / visualScale
                    const logicalBottomY =
                      (clientRect.y + clientRect.height) / visualScale + 18
                    const badgeY =
                      logicalBottomY > dimensions.height - 20
                        ? Math.max(16, clientRect.y / visualScale - 18)
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
                      ),
                      false
                    )
                    setTransformingInfo(null)
                  }}
                />
              ))}
              {currentTexts.map((item) => (
                <Text
                  id={item.id}
                  key={item.id}
                  text={item.text}
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  scaleX={item.scaleX}
                  scaleY={item.scaleY}
                  rotation={item.rotation}
                  fontFamily={item.fontFamily}
                  fontSize={item.fontSize}
                  fill="#0f172a"
                  verticalAlign="middle"
                  draggable
                  onClick={(e) => { e.cancelBubble = true; setSelectedId(item.id) }}
                  onTap={(e) => { e.cancelBubble = true; setSelectedId(item.id) }}
                  onDragStart={() => { recordHistory(); setSelectedId(item.id) }}
                  onDragEnd={(e) => {
                    const node = e.target
                    updateCurrentPageTexts((prev) =>
                      prev.map((text) => text.id === item.id ? { ...text, x: Math.round(node.x()), y: Math.round(node.y()) } : text),
                      false
                    )
                  }}
                  onTransformStart={() => { recordHistory(); setSelectedId(item.id) }}
                  onTransform={(e) => {
                    const node = e.target
                    const clientRect = node.getClientRect({ skipShadow: true })
                    setTransformingInfo({
                      widthCm: pxToCm(Math.abs(node.width() * node.scaleX())),
                      heightCm: pxToCm(Math.abs(node.height() * node.scaleY())),
                      x: (clientRect.x + clientRect.width / 2) / visualScale,
                      y: Math.min(dimensions.height - 20, (clientRect.y + clientRect.height) / visualScale + 18),
                    })
                  }}
                  onTransformEnd={(e) => {
                    const node = e.target
                    updateCurrentPageTexts((prev) =>
                      prev.map((text) => text.id === item.id ? {
                        ...text,
                        x: Math.round(node.x()),
                        y: Math.round(node.y()),
                        scaleX: node.scaleX(),
                        scaleY: node.scaleY(),
                        rotation: Math.round(node.rotation() * 10) / 10,
                      } : text),
                      false
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

      {/* Mobile contextual clipboard actions */}
      {(selectedImage || hasClipboard) && (
        <div className="mobile-contextual-toolbar" aria-label="Mobile image actions">
          {selectedImage && (
            <button
              type="button"
              className="btn btn-mobile-action"
              onClick={handleCopy}
              title="Copy selected image"
            >
              Copy
            </button>
          )}
          {hasClipboard && (
            <button
              type="button"
              className="btn btn-mobile-action btn-mobile-paste"
              onClick={handlePaste}
              title="Paste copied image onto the active page"
            >
              Paste
            </button>
          )}
        </div>
      )}

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

      {/* Preparing print temporary state overlay */}
      {isPrinting && (
        <div
          className="print-loading-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="print-loading-card">
            <div className="print-spinner" />
            <span>Preparing print...</span>
          </div>
        </div>
      )}

      {/* High-resolution multi-page printable document for window.print() */}
      <div
        className="print-document"
        aria-hidden="true"
        style={{
          width: `${dimensions.widthCm}cm`,
          maxWidth: `${dimensions.widthCm}cm`,
        }}
      >
        {printSheets.map((sheetUrl, index) => (
          <div
            key={index}
            className="print-sheet"
            style={{
              width: `${dimensions.widthCm}cm`,
              height: `${dimensions.heightCm}cm`,
            }}
          >
            <img
              src={sheetUrl}
              alt=""
              className="print-sheet-img"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
