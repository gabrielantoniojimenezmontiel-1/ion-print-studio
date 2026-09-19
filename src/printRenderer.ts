import Konva from 'konva'
import { A4_BASE_WIDTH, A4_BASE_HEIGHT } from './units'

export interface RenderableImage {
  id: string
  image: HTMLImageElement
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface RenderablePage {
  id: string
  images: RenderableImage[]
}

/**
 * Renders a single page to a high-resolution PNG data URL
 * using an offscreen Konva Stage at the logical A4 document dimensions.
 * pixelRatio: 3 yields ~1785 x 2525 px (~300 DPI on physical A4 print).
 */
export async function renderPageToDataUrl(
  page: RenderablePage,
  pixelRatio: number = 3
): Promise<string> {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.top = '-10000px'
  container.style.left = '-10000px'
  container.style.width = `${A4_BASE_WIDTH}px`
  container.style.height = `${A4_BASE_HEIGHT}px`
  container.style.visibility = 'hidden'
  container.style.pointerEvents = 'none'
  document.body.appendChild(container)

  let stage: Konva.Stage | null = null

  try {
    // Wait for all images on the page to be complete
    await Promise.all(
      page.images.map((item) => {
        if (item.image.complete && item.image.naturalWidth > 0) {
          return Promise.resolve()
        }
        return new Promise<void>((resolve, reject) => {
          item.image.onload = () => resolve()
          item.image.onerror = () =>
            reject(new Error(`Image "${item.id}" failed to load for printing`))
        })
      })
    )

    stage = new Konva.Stage({
      container,
      width: A4_BASE_WIDTH,
      height: A4_BASE_HEIGHT,
    })

    const layer = new Konva.Layer()
    stage.add(layer)

    // Pure white page background
    const background = new Konva.Rect({
      x: 0,
      y: 0,
      width: A4_BASE_WIDTH,
      height: A4_BASE_HEIGHT,
      fill: '#ffffff',
    })
    layer.add(background)

    // Add page images in exact layer order
    for (const item of page.images) {
      const konvaImage = new Konva.Image({
        image: item.image,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
        rotation: item.rotation,
      })
      layer.add(konvaImage)
    }

    layer.draw()

    const dataUrl = stage.toDataURL({
      pixelRatio,
      mimeType: 'image/png',
    })

    return dataUrl
  } finally {
    if (stage) {
      stage.destroy()
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }
}

/**
 * Renders all project pages in sequence, returning an array of high-res image data URLs.
 */
export async function renderAllPagesForPrint(
  pages: RenderablePage[],
  pixelRatio: number = 3
): Promise<string[]> {
  const results: string[] = []
  for (let i = 0; i < pages.length; i++) {
    const pageUrl = await renderPageToDataUrl(pages[i], pixelRatio)
    results.push(pageUrl)
  }
  return results
}
