export interface SerializedImageItem {
  id: string
  src: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface SerializedTextItem {
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

export interface SerializedPage {
  id: string
  images: SerializedImageItem[]
  texts?: SerializedTextItem[]
}

export interface SavedProject {
  version: number
  updatedAt: number
  activePageIndex?: number
  activePageId?: string
  pages: SerializedPage[]
  pagePreset?: 'A4' | 'Letter' | 'Tabloid'
  orientation?: 'portrait' | 'landscape'
  // Backward compatibility with older single-page storage format
  images?: SerializedImageItem[]
}

const DB_NAME = 'ion_print_studio_db'
const DB_VERSION = 1
const STORE_NAME = 'projects'
const CURRENT_PROJECT_KEY = 'current_project'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment'))
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveProject(project: SavedProject): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(project, CURRENT_PROJECT_KEY)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('Unable to persist project to IndexedDB:', error)
  }
}

export async function loadProject(): Promise<SavedProject | null> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(CURRENT_PROJECT_KEY)

      request.onsuccess = () => {
        const result = request.result as SavedProject | undefined
        if (!result) {
          resolve(null)
          return
        }

        // Migrate legacy single-page project to multi-page format
        if ((!result.pages || result.pages.length === 0) && result.images) {
          result.pages = [
            {
              id: 'page-default',
              images: result.images,
            },
          ]
          result.activePageIndex = 0
        }

        const pagesWithContent = (result.pages || []).filter(
          (page) => page.images.length > 0 || (page.texts?.length ?? 0) > 0
        )
        if (pagesWithContent.length > 0) {
          const activePageId =
            result.activePageId ||
            (typeof result.activePageIndex === 'number'
              ? result.pages?.[result.activePageIndex]?.id
              : undefined)
          result.pages = pagesWithContent
          result.activePageId = activePageId
          result.activePageIndex = Math.max(
            0,
            pagesWithContent.findIndex((page) => page.id === activePageId)
          )
          if (result.activePageIndex < 0) result.activePageIndex = 0
        } else {
          result.pages = [
            result.pages?.[0] || {
              id: 'page-default',
              images: [],
              texts: [],
            },
          ]
          result.activePageIndex = 0
          result.activePageId = result.pages[0].id
        }

        resolve(result)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('Unable to load project from IndexedDB:', error)
    return null
  }
}

export async function clearSavedProject(): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(CURRENT_PROJECT_KEY)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('Unable to clear project in IndexedDB:', error)
  }
}
