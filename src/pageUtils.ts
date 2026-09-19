export interface PageWithContent {
  images: unknown[]
  texts?: unknown[]
}

export function isPageEmpty(page: PageWithContent): boolean {
  return page.images.length === 0 && (page.texts?.length ?? 0) === 0
}
