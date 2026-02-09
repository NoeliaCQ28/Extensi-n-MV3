import { showResults, ITEMS_PER_PAGE } from '../utils/index'

const scrapeButtonElement = document.getElementById('scrapeButton') as HTMLButtonElement | null
const clearButtonElement = document.getElementById('clearButton') as HTMLButtonElement | null
const keywordInputElement = document.getElementById('keywordInput') as HTMLInputElement | null
const addKeywordButtonElement = document.getElementById('addKeywordBtn') as HTMLButtonElement | null
const keywordListElement = document.getElementById('keywordList') as HTMLDivElement | null

const KEYWORDS_STORAGE_KEY = 'keywords'
type KeywordStatus = 'Idle' | 'Running' | 'Done' | 'Error' | 'Cancelled'

interface KeywordData {
  term: string
  status: KeywordStatus
  count: number
}

let keywords: KeywordData[] = []
const activePorts = new Map<string, chrome.runtime.Port>()

let todosLosProductos: any[] = []
let paginaActual: number = 1
let scrapeEnProgreso = false
let scrapePausado = false
let currentScrapePort: chrome.runtime.Port | null = null
let currentScrapeKey: string | null = null

// Estado persistente del scraping
interface ScrapeState {
  isRunning: boolean
  isPaused: boolean
  keyword: string
  site: 'falabella' | 'mercadolibre'
  currentPage: number
  totalPages: number
  productsCount: number
  accumulatedProducts: any[]
  timestamp: number
}

type ScrapeStateMap = Record<string, ScrapeState>

const SCRAPE_STATES_KEY = 'scrape_states'

function buildScrapeKey(site: 'falabella' | 'mercadolibre', keyword: string) {
  return `${site}:${keyword.toLowerCase()}`
}

async function loadAllScrapeStates(): Promise<ScrapeStateMap> {
  const result = await chrome.storage.local.get(SCRAPE_STATES_KEY)
  return result[SCRAPE_STATES_KEY] || {}
}

// Guardar estado del scraping
async function saveScrapeState(key: string, state: Partial<ScrapeState>) {
  const allStates = await loadAllScrapeStates()
  const current = allStates[key] || null
  const updated = { ...current, ...state, timestamp: Date.now() }
  allStates[key] = updated
  await chrome.storage.local.set({ [SCRAPE_STATES_KEY]: allStates })
  renderScrapeSessions(allStates)
}

// Cargar estado del scraping
async function loadScrapeState(key: string): Promise<ScrapeState | null> {
  const allStates = await loadAllScrapeStates()
  return allStates[key] || null
}

// Limpiar estado del scraping
async function clearScrapeState(key: string) {
  const allStates = await loadAllScrapeStates()
  if (!allStates[key]) return
  delete allStates[key]
  await chrome.storage.local.set({ [SCRAPE_STATES_KEY]: allStates })
  renderScrapeSessions(allStates)
}

async function getLatestPausedState() {
  const allStates = await loadAllScrapeStates()
  let latestKey: string | null = null
  let latestState: ScrapeState | null = null
  for (const [key, state] of Object.entries(allStates)) {
    if (!state?.isPaused) continue
    if (!latestState || state.timestamp > latestState.timestamp) {
      latestKey = key
      latestState = state
    }
  }
  return latestKey && latestState ? { key: latestKey, state: latestState } : null
}

async function getLatestRunningState() {
  const allStates = await loadAllScrapeStates()
  let latestKey: string | null = null
  let latestState: ScrapeState | null = null
  for (const [key, state] of Object.entries(allStates)) {
    if (!state?.isRunning || state.isPaused) continue
    if (!latestState || state.timestamp > latestState.timestamp) {
      latestKey = key
      latestState = state
    }
  }
  return latestKey && latestState ? { key: latestKey, state: latestState } : null
}

// Elementos de la barra de progreso
const progressContainer = () => document.getElementById('sessionsContainer')
const progressText = () => document.getElementById('progressText')
const progressCount = () => document.getElementById('progressCount')
const progressBar = () => document.getElementById('progressBar')
const progressPage = () => document.getElementById('progressPage')
const progressTotal = () => document.getElementById('progressTotal')
const sessionsList = () => document.getElementById('sessionsList')
const pauseBtn = () => document.getElementById('pauseBtn')
const resumeBtn = () => document.getElementById('resumeBtn')
const cancelBtn = () => document.getElementById('cancelBtn')

function showProgress(show: boolean) {
  const container = progressContainer()
  if (container) {
    container.classList.toggle('hidden', !show)
  }
}

function renderScrapeSessions(states: ScrapeStateMap) {
  const listEl = sessionsList()
  if (!listEl) return

  const entries = Object.entries(states)
    .filter(([, state]) => state && (state.isRunning || state.isPaused))
    .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))

  if (entries.length === 0) {
    listEl.innerHTML = '<div class="text-xs text-gray-500">No hay scraping en curso.</div>'
    showProgress(false)
    return
  }

  showProgress(true)

  listEl.innerHTML = entries
    .map(([key, state]) => {
      const totalEstimated = state.totalPages ? state.totalPages * 48 : 0
      const pct = totalEstimated > 0 ? Math.min((state.productsCount / totalEstimated) * 100, 100) : 0
      const statusLabel = state.isPaused ? 'Pausado' : 'En progreso'
      const statusClass = state.isPaused ? 'text-yellow-600' : 'text-indigo-600'
      const siteLabel = state.site === 'falabella' ? 'Falabella' : 'MercadoLibre'
      const keywordLabel = escapeHtml(state.keyword || '')
      const totalText = totalEstimated > 0 ? `Total esperado: ~${totalEstimated}` : 'Total esperado: —'
      const buttons = state.isPaused
        ? `<button data-session-action="resume" data-session-key="${key}" class="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600">Reanudar</button>
           <button data-session-action="cancel" data-session-key="${key}" class="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600">Cancelar</button>`
        : `<button data-session-action="pause" data-session-key="${key}" class="px-2 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600">Pausar</button>
           <button data-session-action="cancel" data-session-key="${key}" class="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600">Cancelar</button>`

      return `
        <div class="border border-gray-100 rounded p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-900">${keywordLabel}</div>
              <div class="text-xs text-gray-500">${siteLabel} • ${totalText}</div>
            </div>
            <div class="text-xs font-medium ${statusClass}">${statusLabel}</div>
          </div>
          <div class="mt-2">
            <div class="flex items-center justify-between text-xs text-gray-500">
              <span>${state.productsCount} productos</span>
              <span>Página ${state.currentPage} de ${state.totalPages}</span>
            </div>
            <div class="mt-1 w-full bg-gray-200 rounded-full h-2">
              <div class="bg-indigo-600 h-2 rounded-full" style="width: ${pct}%"></div>
            </div>
          </div>
          <div class="mt-2 flex items-center gap-2">
            ${buttons}
          </div>
        </div>
      `
    })
    .join('')
}

function updateProgress(count: number, total?: number, pageNum?: number) {
  const countEl = progressCount()
  const barEl = progressBar()
  const pageEl = progressPage()
  const totalEl = progressTotal()
  
  if (countEl) countEl.textContent = count.toString()
  
  if (total && total > 0 && barEl) {
    const pct = Math.min((count / total) * 100, 100)
    barEl.style.width = `${pct}%`
  } else if (barEl) {
    // Sin total conocido, mostrar barra indeterminada
    barEl.style.width = '50%'
  }
  
  if (pageNum && pageEl) {
    pageEl.textContent = `Página ${pageNum}`
  }
  
  if (total && totalEl) {
    totalEl.textContent = `Total esperado: ~${total} productos`
  }
}

function togglePauseResumeButtons(paused: boolean) {
  const pause = pauseBtn()
  const resume = resumeBtn()
  
  if (paused) {
    pause?.classList.add('hidden')
    resume?.classList.remove('hidden')
  } else {
    pause?.classList.remove('hidden')
    resume?.classList.add('hidden')
  }
}

function setCurrentPort(port: chrome.runtime.Port | null) {
  currentScrapePort = port
}

function normalizeKeyword(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type SiteKey = 'falabella' | 'mercadolibre'

interface ProductoLite {
  site: SiteKey
  titulo?: string | null
  precioNumerico?: number | null
  marca?: string | null
  vendedor?: string | null
  url?: string | null
}

interface GroupBucket {
  id: number
  title: string
  tokens: Set<string>
  brandKey: string | null
  items: ProductoLite[]
}

interface PriceStats {
  count: number
  min: number | null
  max: number | null
  avg: number | null
  median: number | null
}

interface GroupStats {
  id: number
  title: string
  total: number
  bySite: Record<SiteKey, { count: number; prices: number[] }>
  priceStats: PriceStats
  comparison: {
    falabellaMin: number | null
    mercadolibreMin: number | null
    cheaperSite: SiteKey | null
    savings: number | null
  }
}

const SITE_LABELS: Record<SiteKey, string> = {
  falabella: 'Falabella',
  mercadolibre: 'MercadoLibre'
}

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con',
  'sin', 'para', 'por', 'en', 'del', 'al', 'pack', 'set', 'combo', 'kit', 'x',
  'nuevo', 'nueva', 'oferta', 'promocion', 'gratis'
])

const SIMILARITY_THRESHOLD = 0.58

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string) {
  if (!value) return []
  return normalizeText(value)
    .split(' ')
    .filter(token => token && token.length > 1 && !STOP_WORDS.has(token))
}

function buildTokenSet(item: ProductoLite) {
  const title = item.titulo || ''
  const brand = item.marca || item.vendedor || ''
  const tokens = tokenize(`${title} ${brand}`)
  return new Set(tokens)
}

function getBrandKey(item: ProductoLite) {
  const raw = item.marca || item.vendedor || ''
  const normalized = normalizeText(raw)
  return normalized || null
}

function computeSimilarity(a: Set<string>, b: Set<string>, brandMatch: boolean) {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  const jaccard = union > 0 ? intersection / union : 0
  const coverage = intersection / Math.min(a.size, b.size)
  let score = 0.6 * jaccard + 0.4 * coverage
  if (brandMatch) score += 0.08
  return Math.min(1, score)
}

function groupProducts(products: ProductoLite[]) {
  const groups: GroupBucket[] = []
  let nextId = 1
  let emptyGroup: GroupBucket | null = null

  for (const item of products) {
    const tokens = buildTokenSet(item)
    const brandKey = getBrandKey(item)

    if (tokens.size === 0) {
      if (!emptyGroup) {
        emptyGroup = {
          id: nextId++,
          title: 'Sin titulo',
          tokens: new Set(),
          brandKey: null,
          items: []
        }
        groups.push(emptyGroup)
      }
      emptyGroup.items.push(item)
      continue
    }

    let bestGroup: GroupBucket | null = null
    let bestScore = 0

    for (const group of groups) {
      if (group.tokens.size === 0) continue
      const brandMatch = Boolean(brandKey && group.brandKey && brandKey === group.brandKey)
      const score = computeSimilarity(tokens, group.tokens, brandMatch)
      if (score > bestScore) {
        bestScore = score
        bestGroup = group
      }
    }

    if (bestGroup && bestScore >= SIMILARITY_THRESHOLD) {
      bestGroup.items.push(item)
      if (tokens.size > bestGroup.tokens.size) {
        bestGroup.tokens = tokens
        if (item.titulo) bestGroup.title = item.titulo
      }
      if (!bestGroup.brandKey && brandKey) bestGroup.brandKey = brandKey
    } else {
      groups.push({
        id: nextId++,
        title: item.titulo || 'Sin titulo',
        tokens,
        brandKey,
        items: [item]
      })
    }
  }

  return groups
}

function computePriceStats(prices: number[]): PriceStats {
  if (!prices || prices.length === 0) {
    return { count: 0, min: null, max: null, avg: null, median: null }
  }

  const sorted = [...prices].sort((a, b) => a - b)
  const count = sorted.length
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const avg = sorted.reduce((sum, value) => sum + value, 0) / count
  const mid = Math.floor(count / 2)
  const median = count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return { count, min, max, avg, median }
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function buildGroupStats(groups: GroupBucket[]): GroupStats[] {
  return groups.map(group => {
    const bySite: Record<SiteKey, { count: number; prices: number[] }> = {
      falabella: { count: 0, prices: [] },
      mercadolibre: { count: 0, prices: [] }
    }

    for (const item of group.items) {
      const site = item.site
      bySite[site].count += 1
      if (Number.isFinite(item.precioNumerico)) {
        bySite[site].prices.push(item.precioNumerico as number)
      }
    }

    const allPrices = [...bySite.falabella.prices, ...bySite.mercadolibre.prices]
    const priceStats = computePriceStats(allPrices)

    const falMin = bySite.falabella.prices.length > 0 ? Math.min(...bySite.falabella.prices) : null
    const merMin = bySite.mercadolibre.prices.length > 0 ? Math.min(...bySite.mercadolibre.prices) : null
    let cheaperSite: SiteKey | null = null
    let savings: number | null = null

    if (falMin !== null && merMin !== null) {
      if (falMin <= merMin) {
        cheaperSite = 'falabella'
        savings = merMin - falMin
      } else {
        cheaperSite = 'mercadolibre'
        savings = falMin - merMin
      }
    }

    return {
      id: group.id,
      title: group.title,
      total: group.items.length,
      bySite,
      priceStats,
      comparison: {
        falabellaMin: falMin,
        mercadolibreMin: merMin,
        cheaperSite,
        savings
      }
    }
  })
}

function buildStatsHtml(keyword: string, groupStats: GroupStats[]) {
  const totalProducts = groupStats.reduce((sum, g) => sum + g.total, 0)
  const groupsWithBothSites = groupStats.filter(g => g.bySite.falabella.count > 0 && g.bySite.mercadolibre.count > 0)
  const ranking = [...groupsWithBothSites]
    .filter(g => (g.comparison.savings || 0) > 0)
    .sort((a, b) => (b.comparison.savings || 0) - (a.comparison.savings || 0))
    .slice(0, 8)

  const rankingHtml = ranking.length
    ? ranking.map((g, index) => {
      const cheaper = g.comparison.cheaperSite ? SITE_LABELS[g.comparison.cheaperSite] : '—'
      return `
        <div class="flex items-center justify-between text-sm">
          <div class="truncate">${index + 1}. ${escapeHtml(g.title || 'Sin titulo')}</div>
          <div class="ml-2 whitespace-nowrap text-green-700">Ahorro: ${formatPrice(g.comparison.savings)} (${cheaper})</div>
        </div>
      `
    }).join('')
    : '<div class="text-xs text-gray-500">No hay grupos con precios en ambos sitios.</div>'

  const groupsHtml = groupStats
    .map(g => {
      const priceStats = g.priceStats
      const cheaperSite = g.comparison.cheaperSite ? SITE_LABELS[g.comparison.cheaperSite] : '—'
      const comparisonText = (g.comparison.falabellaMin !== null && g.comparison.mercadolibreMin !== null)
        ? `Falabella: ${formatPrice(g.comparison.falabellaMin)} | MercadoLibre: ${formatPrice(g.comparison.mercadolibreMin)} | Mejor: ${cheaperSite}`
        : 'Comparacion no disponible (precio faltante)'

      const savingsText = g.comparison.savings ? `Ahorro estimado: ${formatPrice(g.comparison.savings)}` : 'Ahorro estimado: —'

      return `
        <div class="border border-gray-100 rounded p-3">
          <div class="text-sm font-semibold text-gray-900 truncate">${escapeHtml(g.title || 'Sin titulo')}</div>
          <div class="mt-1 text-xs text-gray-500">Total: ${g.total} | ${SITE_LABELS.falabella}: ${g.bySite.falabella.count} | ${SITE_LABELS.mercadolibre}: ${g.bySite.mercadolibre.count}</div>
          <div class="mt-2 text-xs text-gray-600">Precio min: ${formatPrice(priceStats.min)} | max: ${formatPrice(priceStats.max)} | promedio: ${formatPrice(priceStats.avg)} | mediana: ${formatPrice(priceStats.median)}</div>
          <div class="mt-1 text-xs text-gray-600">${comparisonText}</div>
          <div class="mt-1 text-xs text-green-700">${savingsText}</div>
        </div>
      `
    })
    .join('')

  return `
    <div class="space-y-3">
      <div class="bg-white rounded shadow p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-gray-900">Estadisticas para: ${escapeHtml(keyword)}</div>
            <div class="text-xs text-gray-500">Productos: ${totalProducts} | Grupos: ${groupStats.length} | Con ambos sitios: ${groupsWithBothSites.length}</div>
          </div>
          <button id="backToListBtn" class="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Volver</button>
        </div>
      </div>

      <div class="bg-white rounded shadow p-3">
        <div class="text-xs font-semibold text-gray-900 mb-2">Ranking de ahorro</div>
        <div class="space-y-1">${rankingHtml}</div>
      </div>

      <div class="bg-white rounded shadow p-3">
        <div class="text-xs font-semibold text-gray-900 mb-2">Grupos similares</div>
        <div class="space-y-2 max-h-72 overflow-auto">${groupsHtml}</div>
      </div>
    </div>
  `
}

async function showStatsForKeyword(keyword: string) {
  const resultEl = document.getElementById('result')
  if (!resultEl) return
  const resultKey = buildResultsKey(keyword)
  const stored = await chrome.storage.local.get(resultKey)
  const products = Array.isArray(stored?.[resultKey]) ? stored[resultKey] : []

  if (!products || products.length === 0) {
    resultEl.innerHTML = `<div class="p-4 bg-white rounded shadow text-gray-600">No hay productos guardados para ${escapeHtml(keyword)}.</div>`
    return
  }

  todosLosProductos = products
  paginaActual = 1

  const groups = groupProducts(products as ProductoLite[])
  const stats = buildGroupStats(groups)
  resultEl.innerHTML = buildStatsHtml(keyword, stats)

  const backBtn = document.getElementById('backToListBtn')
  backBtn?.addEventListener('click', () => {
    actualizarVista()
  })
}

async function loadKeywords() {
  const result = await chrome.storage.local.get(KEYWORDS_STORAGE_KEY)
  const stored = result?.[KEYWORDS_STORAGE_KEY]
  if (Array.isArray(stored)) {
    if (stored.length > 0 && typeof stored[0] === 'string') {
      keywords = (stored as string[]).map(term => ({ term, status: 'Idle', count: 0 }))
    } else {
      keywords = (stored as KeywordData[])
        .filter(item => item && typeof item.term === 'string')
        .map(item => ({
          term: item.term,
          status: item.status || 'Idle',
          count: typeof item.count === 'number' ? item.count : 0
        }))
    }
  } else {
    keywords = []
  }
  await hydrateKeywordCounts()
  renderKeywords()
}

async function saveKeywords() {
  await chrome.storage.local.set({ [KEYWORDS_STORAGE_KEY]: keywords })
}

function buildResultsKey(term: string) {
  return `results_${term.toUpperCase().replace(/\s+/g, '_')}`
}

async function hydrateKeywordCounts() {
  if (keywords.length === 0) return
  const keys = keywords.map(item => buildResultsKey(item.term))
  const result = await chrome.storage.local.get(keys)
  keywords = keywords.map((item, index) => {
    const stored = result?.[keys[index]]
    if (Array.isArray(stored)) {
      return { ...item, count: stored.length }
    }
    return item
  })
}

async function updateKeywordStatus(term: string, status: KeywordStatus) {
  keywords = keywords.map(item => (item.term.toLowerCase() === term.toLowerCase() ? { ...item, status } : item))
  renderKeywords()
  await saveKeywords()
}

function getKeywordStatus(term: string) {
  return keywords.find(item => item.term.toLowerCase() === term.toLowerCase())?.status
}

async function updateKeywordData(term: string, status: KeywordStatus, count?: number) {
  keywords = keywords.map(item => {
    if (item.term.toLowerCase() !== term.toLowerCase()) return item
    return {
      ...item,
      status,
      count: typeof count === 'number' ? count : item.count
    }
  })
  renderKeywords()
  await saveKeywords()
}

function renderKeywords() {
  if (!keywordListElement) return

  if (keywords.length === 0) {
    keywordListElement.innerHTML = '<div class="text-xs text-gray-500">No hay keywords guardadas.</div>'
    return
  }

  keywordListElement.innerHTML = keywords
    .map((keyword) => {
      const safe = escapeHtml(keyword.term)
      const statusLabel = `${keyword.status.toUpperCase()} (${keyword.count})`
      return `
        <div class="flex items-center justify-between gap-2 p-2 border border-gray-100 rounded">
          <div class="min-w-0">
            <div class="text-sm text-gray-800 truncate">${safe}</div>
            <div class="text-xs text-gray-500">${statusLabel}</div>
          </div>
          <div class="flex items-center gap-1">
            <button data-action="falabella" data-keyword="${safe}" class="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Falabella</button>
            <button data-action="mercadolibre" data-keyword="${safe}" class="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">MercadoLibre</button>
            <button data-action="stats" data-keyword="${safe}" class="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Estadísticas</button>
            <button data-action="delete" data-keyword="${safe}" class="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100">Eliminar</button>
          </div>
        </div>
      `
    })
    .join('')
}

function buildFalabellaUrl(keyword: string) {
  return `https://www.falabella.com.pe/falabella-pe/search?Ntt=${encodeURIComponent(keyword)}`
}

function buildMercadoLibreUrl(keyword: string) {
  return `https://listado.mercadolibre.com.pe/${encodeURIComponent(keyword)}`
}

function waitForTabLoad(tabId: number) {
  return new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function openAndConnect(site: 'falabella' | 'mercadolibre', keyword: string) {
  const url = site === 'falabella' ? buildFalabellaUrl(keyword) : buildMercadoLibreUrl(keyword)
  const created = await chrome.tabs.create({ url, active: true })
  if (!created.id) return null
  await waitForTabLoad(created.id)
  await tryInjectContentScript(created.id, url)
  return chrome.tabs.connect(created.id, { name: 'popup-connection' })
}

async function connectToActiveTab(expectedSite?: 'falabella' | 'mercadolibre') {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const activeTab = tabs && tabs[0]

  if (!activeTab || typeof activeTab.id !== 'number') {
    alert('Error: No se pudo identificar la pestaña activa')
    return null
  }

  const url = activeTab.url || ''
  if (expectedSite === 'falabella' && !url.includes('falabella.com')) {
    alert('Abre una pestaña de Falabella antes de conectar.')
    return null
  }

  if (expectedSite === 'mercadolibre' && !url.includes('mercadolibre.com')) {
    alert('Abre una pestaña de MercadoLibre antes de conectar.')
    return null
  }

  await tryInjectContentScript(activeTab.id, url)
  return chrome.tabs.connect(activeTab.id, { name: 'popup-connection' })
}

async function conectarConScript(site: 'falabella' | 'mercadolibre', term: string) {
  const portKey = `${site}:${term.toLowerCase()}`
  const existing = activePorts.get(portKey)
  if (existing) return existing

  const port = await connectToActiveTab(site)
  if (!port) {
    await updateKeywordStatus(term, 'Error')
    return null
  }

  let connected = false

  port.onMessage.addListener((message) => {
    console.log('Mensaje recibido por puerto:', message)
    if (message?.type === 'connection_established') {
      connected = true
    }
  })

  port.onDisconnect.addListener(async () => {
    const lastError = chrome.runtime.lastError
    const currentStatus = getKeywordStatus(term)
    const shouldReset = currentStatus === 'Running'
    const nextStatus = !connected || lastError ? 'Error' : (shouldReset ? 'Idle' : currentStatus || 'Idle')
    activePorts.delete(portKey)
    await updateKeywordStatus(term, nextStatus)
  })

  activePorts.set(portKey, port)
  return port
}

function actualizarVista() {
  const resultEl = document.getElementById('result')
  showResults(resultEl, todosLosProductos, paginaActual)
}

function refreshResultsPreview(products: any[]) {
  if (!products || products.length === 0) return
  todosLosProductos = products
  const totalPages = Math.max(1, Math.ceil(todosLosProductos.length / ITEMS_PER_PAGE))
  if (paginaActual > totalPages) paginaActual = totalPages
  actualizarVista()
}

async function tryInjectContentScript(tabId: number, url: string) {
  try {
    // Determinar qué script inyectar según la URL
    let scriptFile = ''
    if (url.includes('falabella.com')) {
      scriptFile = 'content/falabella.js'
    } else if (url.includes('mercadolibre.com')) {
      scriptFile = 'content/mercadoLibre.js'
    } else {
      return false
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile]
    })
    
    console.log('Content script inyectado manualmente:', scriptFile)
    // Esperar un momento para que el script se inicialice
    await new Promise(resolve => setTimeout(resolve, 500))
    return true
  } catch (err) {
    console.error('Error al inyectar content script:', err)
    return false
  }
}

async function resumeScrapeFromState(state: ScrapeState, key: string) {
  scrapePausado = false
  scrapeEnProgreso = true
  currentScrapeKey = key
  togglePauseResumeButtons(false)
  showProgress(true)
  updateProgress(state.productsCount, state.totalPages * 48, state.currentPage)
  refreshResultsPreview(state.accumulatedProducts || [])
  const textEl = progressText()
  if (textEl) textEl.textContent = 'Extrayendo productos...'

  const port = await connectToActiveTab(state.site)
  if (!port) {
    alert('No se pudo conectar con la página. Asegúrate de estar en la página correcta de ' + state.site)
    scrapeEnProgreso = false
    return
  }

  setCurrentPort(port)

  let allScrapedProducts = state.accumulatedProducts || []
  let progressStreaming = false
  let currentPageNum = state.currentPage

  const handleMessage = async (response: any) => {
    if (response?.type === 'progress') {
      const items = Array.isArray(response.items) ? response.items : null
      if (items && items.length > 0) {
        allScrapedProducts.push(...items)
        progressStreaming = true
        refreshResultsPreview(allScrapedProducts)
      }
      const count = Number(response.count) || 0
      const total = response.total || undefined
      const page = response.page || undefined
      const nextCount = items ? allScrapedProducts.length : allScrapedProducts.length + count
      updateProgress(nextCount, total, page)
      await saveScrapeState(key, {
        isRunning: true,
        isPaused: scrapePausado,
        keyword: state.keyword,
        site: state.site,
        currentPage: currentPageNum,
        totalPages: state.totalPages,
        productsCount: nextCount,
        accumulatedProducts: allScrapedProducts
      })
      return
    }

    if (response?.type === 'scrape_cancelled') {
      port.onMessage.removeListener(handleMessage)
      showProgress(false)
      scrapeEnProgreso = false
      scrapePausado = false
      await clearScrapeState(key)
      if (state.keyword && state.keyword !== 'scrape_manual') {
        await updateKeywordStatus(state.keyword, 'Cancelled')
      }
      setCurrentPort(null)
      currentScrapeKey = null
      return
    }

    if (!response || response.type !== 'scrape_result') return

    if (response.error) {
      port.onMessage.removeListener(handleMessage)
      showProgress(false)
      scrapeEnProgreso = false
      scrapePausado = false
      await clearScrapeState(key)
      alert('Error al scrapear: ' + response.error)
      setCurrentPort(null)
      currentScrapeKey = null
      return
    }

    const pageProducts = response.result || []
    if (!progressStreaming || allScrapedProducts.length === 0) {
      allScrapedProducts.push(...pageProducts)
    }
    console.log(`Página ${currentPageNum}: ${pageProducts.length} productos. Total acumulado: ${allScrapedProducts.length}`)

    const total = response.total || undefined
    updateProgress(allScrapedProducts.length, total, currentPageNum)
    refreshResultsPreview(allScrapedProducts)

    await saveScrapeState(key, {
      isRunning: true,
      isPaused: false,
      keyword: state.keyword,
      site: state.site,
      currentPage: currentPageNum,
      totalPages: response.totalPages || state.totalPages,
      productsCount: allScrapedProducts.length,
      accumulatedProducts: allScrapedProducts
    })

    if (scrapePausado) {
      console.log('Scraping pausado por el usuario')
      port.onMessage.removeListener(handleMessage)
      return
    }

    if (response.hasNextPage && state.site === 'falabella') {
      currentPageNum++
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const activeTab = tabs?.[0]

      if (activeTab?.id) {
        try {
          const currentUrl = activeTab.url || ''
          const url = new URL(currentUrl)
          url.searchParams.set('page', currentPageNum.toString())
          await chrome.tabs.update(activeTab.id, { url: url.toString() })

          await new Promise<void>((resolve) => {
            const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
              if (tabId === activeTab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener)
                setTimeout(() => resolve(), 2000)
              }
            }
            chrome.tabs.onUpdated.addListener(listener)
          })

          const newPort = chrome.tabs.connect(activeTab.id, { name: 'popup-connection' })
          newPort.onMessage.addListener(handleMessage)
          setCurrentPort(newPort)

          await new Promise<void>((resolve) => {
            const connListener = (msg: any) => {
              if (msg?.type === 'connection_established') {
                newPort.onMessage.removeListener(connListener)
                resolve()
              }
            }
            newPort.onMessage.addListener(connListener)
          })

          newPort.postMessage({ type: 'scrape' })
        } catch (err) {
          console.error('Error navegando:', err)
          port.onMessage.removeListener(handleMessage)
          showProgress(false)
          scrapeEnProgreso = false
          await clearScrapeState(key)
          alert('Error al navegar a la siguiente página')
          setCurrentPort(null)
          currentScrapeKey = null
        }
      }
    } else {
      port.onMessage.removeListener(handleMessage)
      showProgress(false)
      scrapeEnProgreso = false
      scrapePausado = false
      await clearScrapeState(key)
      todosLosProductos = allScrapedProducts
      paginaActual = 1
      actualizarVista()
      console.log(`✓ Scraping completo: ${allScrapedProducts.length} productos en total`)
      setCurrentPort(null)
      currentScrapeKey = null
    }
  }

  port.onMessage.addListener(handleMessage)
  port.postMessage({ type: 'scrape' })
}

async function init() {
  await loadKeywords()
  const allStates = await loadAllScrapeStates()
  renderScrapeSessions(allStates)
  
  // Verificar si hay scraping en progreso
  const running = await getLatestRunningState()
  if (running) {
    // Hay un scraping en progreso, preguntar si quiere continuar
    const continuar = confirm(
      `Se detectó un scraping en progreso:\n\n` +
      `Keyword: ${running.state.keyword}\n` +
      `Página: ${running.state.currentPage} de ${running.state.totalPages}\n` +
      `Productos: ${running.state.productsCount}\n\n` +
      `¿Quieres continuar donde lo dejaste?`
    )
    
    if (continuar) {
      await resumeScrapeFromState(running.state, running.key)
    } else {
      // No quiere continuar, limpiar estado
      await clearScrapeState(running.key)
    }
  } else {
    const paused = await getLatestPausedState()
    if (paused) {
      showProgress(true)
      scrapePausado = true
      currentScrapeKey = paused.key
      togglePauseResumeButtons(true)
      updateProgress(paused.state.productsCount, paused.state.totalPages * 48, paused.state.currentPage)
      const textEl = progressText()
      if (textEl) textEl.textContent = '⏸ Pausado - Haz clic en Reanudar para continuar'
    }
  }

  // Event listeners para controles de scraping
  pauseBtn()?.addEventListener('click', async () => {
    if (!currentScrapeKey) return
    scrapePausado = true
    scrapeEnProgreso = false  // Liberar el flag para permitir operaciones futuras
    togglePauseResumeButtons(true)
    await saveScrapeState(currentScrapeKey, { isPaused: true, isRunning: false })
    const textEl = progressText()
    if (textEl) textEl.textContent = '⏸ Pausado - Haz clic en Reanudar para continuar'
    console.log('Scraping pausado')
  })

  resumeBtn()?.addEventListener('click', async () => {
    let key = currentScrapeKey
    let state = key ? await loadScrapeState(key) : null
    if (!state) {
      const paused = await getLatestPausedState()
      if (!paused) {
        alert('No hay un scraping pausado para reanudar')
        return
      }
      key = paused.key
      state = paused.state
    }
    if (!key) {
      alert('No hay un scraping pausado para reanudar')
      return
    }
    await resumeScrapeFromState(state, key)
  })

  cancelBtn()?.addEventListener('click', async () => {
    // Obtener estado ANTES de limpiarlo
    const key = currentScrapeKey
    const state = key ? await loadScrapeState(key) : null
    
    const confirmar = confirm('¿Seguro que quieres cancelar el scraping? Se perderán los productos recolectados.')
    if (confirmar) {
      if (currentScrapePort) {
        try {
          currentScrapePort.postMessage({ type: 'cancel' })
        } catch {
          // ignore
        }
      }
      for (const port of activePorts.values()) {
        try {
          port.postMessage({ type: 'cancel' })
        } catch {
          // ignore
        }
      }
      scrapeEnProgreso = false
      scrapePausado = false
      showProgress(false)
      togglePauseResumeButtons(false)
      if (key) await clearScrapeState(key)
      console.log('Scraping cancelado')
      
      // Actualizar keyword a estado Idle si corresponde
      if (state && state.keyword && state.keyword !== 'scrape_manual') {
        await updateKeywordStatus(state.keyword, 'Cancelled')
      }

      setCurrentPort(null)
      currentScrapeKey = null
    }
  })

  sessionsList()?.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    const button = target.closest('button[data-session-action]') as HTMLButtonElement | null
    if (!button) return
    const action = button.dataset.sessionAction
    const key = button.dataset.sessionKey
    if (!action || !key) return

    const state = await loadScrapeState(key)
    if (!state) {
      await clearScrapeState(key)
      return
    }

    if (action === 'pause') {
      if (currentScrapeKey && currentScrapeKey !== key) {
        alert('Solo puedes pausar la sesión activa.')
        return
      }
      if (!state.isRunning || state.isPaused) return
      scrapePausado = true
      scrapeEnProgreso = false
      currentScrapeKey = key
      await saveScrapeState(key, { isPaused: true, isRunning: false })
      return
    }

    if (action === 'resume') {
      if (scrapeEnProgreso && currentScrapeKey !== key) {
        alert('Ya hay un scraping en progreso. Espera a que termine o cancélalo.')
        return
      }
      if (state.keyword && state.keyword !== 'scrape_manual') {
        await updateKeywordStatus(state.keyword, 'Running')
      }
      await resumeScrapeFromState(state, key)
      return
    }

    if (action === 'cancel') {
      if (currentScrapeKey === key && currentScrapePort) {
        try {
          currentScrapePort.postMessage({ type: 'cancel' })
        } catch {
          // ignore
        }
      } else {
        await clearScrapeState(key)
        if (state.keyword && state.keyword !== 'scrape_manual') {
          await updateKeywordStatus(state.keyword, 'Cancelled')
        }
      }
      if (currentScrapeKey === key) {
        scrapeEnProgreso = false
        scrapePausado = false
        setCurrentPort(null)
        currentScrapeKey = null
      }
    }
  })

  addKeywordButtonElement?.addEventListener('click', async () => {
    const value = normalizeKeyword(keywordInputElement?.value || '')
    if (!value) return
    const exists = keywords.some(k => k.term.toLowerCase() === value.toLowerCase())
    if (exists) return
    keywords = [{ term: value, status: 'Idle', count: 0 }, ...keywords]
    if (keywordInputElement) keywordInputElement.value = ''
    renderKeywords()
    await saveKeywords()
  })

  keywordInputElement?.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    addKeywordButtonElement?.click()
  })

  keywordListElement?.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    const button = target.closest('button[data-action]') as HTMLButtonElement | null
    if (!button) return
    const action = button.dataset.action
    const keyword = button.dataset.keyword ? normalizeKeyword(button.dataset.keyword) : ''
    if (!action || !keyword) return

    if (action === 'delete') {
      keywords = keywords.filter(k => k.term.toLowerCase() !== keyword.toLowerCase())
      renderKeywords()
      await saveKeywords()
      return
    }

    if (action === 'stats') {
      await showStatsForKeyword(keyword)
      return
    }

    const site = action === 'falabella' ? 'falabella' : 'mercadolibre'
    const scrapeKey = buildScrapeKey(site, keyword)
    const existingState = await loadScrapeState(scrapeKey)

    if (existingState?.isPaused) {
      if (scrapeEnProgreso) {
        alert('Ya hay un scraping en progreso. Espera a que termine o cancélalo.')
        return
      }
      const continuar = confirm(
        `Se detectó un scraping pausado:\n\n` +
        `Keyword: ${existingState.keyword}\n` +
        `Página: ${existingState.currentPage} de ${existingState.totalPages}\n` +
        `Productos: ${existingState.productsCount}\n\n` +
        `¿Quieres reanudarlo?`
      )
      if (continuar) {
        await resumeScrapeFromState(existingState, scrapeKey)
        return
      }
      await clearScrapeState(scrapeKey)
    }

    if (existingState?.isRunning && !existingState.isPaused) {
      alert('Ya hay un scraping en progreso para esta keyword.')
      return
    }

    if (scrapeEnProgreso) {
      alert('Ya hay un scraping en progreso. Espera a que termine o cancélalo.')
      return
    }
    await updateKeywordStatus(keyword, 'Running')
    const port = await openAndConnect(site, keyword)
    if (!port) return

    setCurrentPort(port)
    currentScrapeKey = scrapeKey

    // Mostrar barra de progreso
    showProgress(true)
    updateProgress(0)
    scrapeEnProgreso = true
    scrapePausado = false
    togglePauseResumeButtons(false)
    
    let allScrapedProducts: any[] = []
    let progressStreaming = false
    let currentPageNum = 1
    
    const handleResult = async (message: any) => {
      if (message?.type === 'progress') {
        const items = Array.isArray(message.items) ? message.items : null
        if (items && items.length > 0) {
          allScrapedProducts.push(...items)
          progressStreaming = true
          refreshResultsPreview(allScrapedProducts)
        }
        const count = Number(message.count) || 0
        const total = message.total || undefined
        const page = message.page || undefined
        const nextCount = items ? allScrapedProducts.length : allScrapedProducts.length + count
        await updateKeywordData(keyword, 'Running', nextCount)
        updateProgress(nextCount, total, page)
        await saveScrapeState(scrapeKey, {
          isRunning: true,
          isPaused: scrapePausado,
          keyword,
          site,
          currentPage: currentPageNum,
          totalPages: message.totalPages || 150,
          productsCount: nextCount,
          accumulatedProducts: allScrapedProducts
        })
        return
      }
      if (message?.type === 'scrape_cancelled') {
        port.onMessage.removeListener(handleResult)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState(scrapeKey)
        await updateKeywordStatus(keyword, 'Cancelled')
        setCurrentPort(null)
        currentScrapeKey = null
        return
      }

      if (message?.type !== 'scrape_result') return

      console.log('Popup: Recibido scrape_result:', message)
      console.log('hasNextPage:', message.hasNextPage, 'currentPage:', message.currentPage, 'totalPages:', message.totalPages)

      if (message.error) {
        port.onMessage.removeListener(handleResult)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState(scrapeKey)
        await updateKeywordStatus(keyword, 'Error')
        alert(`Error al scrapear: ${message.error}`)
        setCurrentPort(null)
        currentScrapeKey = null
        return
      }

      const pageProducts = Array.isArray(message.result) ? message.result : []
      if (!progressStreaming || allScrapedProducts.length === 0) {
        allScrapedProducts.push(...pageProducts)
      }
      
      console.log(`Página ${currentPageNum}: ${pageProducts.length} productos. Total acumulado: ${allScrapedProducts.length}`)
      
      // Actualizar progress con el total acumulado
      const total = message.total || undefined
      await updateKeywordData(keyword, 'Running', allScrapedProducts.length)
      updateProgress(allScrapedProducts.length, total, currentPageNum)
      refreshResultsPreview(allScrapedProducts)
      
      // Guardar estado del scraping
      await saveScrapeState(scrapeKey, {
        isRunning: true,
        isPaused: scrapePausado,
        keyword,
        site,
        currentPage: currentPageNum,
        totalPages: message.totalPages || 150,
        productsCount: allScrapedProducts.length,
        accumulatedProducts: allScrapedProducts
      })
      
      // Verificar si está pausado
      if (scrapePausado) {
        console.log('Scraping pausado por el usuario')
        port.onMessage.removeListener(handleResult)
        return
      }
      
      // Verificar si hay más páginas
      console.log('Verificando navegación:', { 
        hasNextPage: message.hasNextPage, 
        site, 
        currentPageNum, 
        shouldNavigate: message.hasNextPage && site === 'falabella' 
      })
      
      if (message.hasNextPage && site === 'falabella') {
        currentPageNum++
        console.log(`Navegando a página ${currentPageNum}...`)
        
        // Obtener la tab actual para navegar
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const activeTab = tabs?.[0]
        
        if (activeTab?.id) {
          try {
            // Construir URL para la siguiente página
            const currentUrl = activeTab.url || ''
            const url = new URL(currentUrl)
            url.searchParams.set('page', currentPageNum.toString())
            const nextPageUrl = url.toString()
            
            // Navegar a la siguiente página
            await chrome.tabs.update(activeTab.id, { url: nextPageUrl })
            
            // Esperar a que cargue la nueva página
            await new Promise<void>((resolve) => {
              const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
                if (tabId === activeTab.id && info.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener)
                  setTimeout(() => resolve(), 2000) // Esperar 2s extra después del complete
                }
              }
              chrome.tabs.onUpdated.addListener(listener)
            })
            
            // Reconectar al nuevo content script
            const newPort = chrome.tabs.connect(activeTab.id, { name: 'popup-connection' })
            newPort.onMessage.addListener(handleResult)
            setCurrentPort(newPort)
            
            // Esperar mensaje de conexión
            await new Promise<void>((resolve) => {
              const connListener = (msg: any) => {
                if (msg?.type === 'connection_established') {
                  newPort.onMessage.removeListener(connListener)
                  resolve()
                }
              }
              newPort.onMessage.addListener(connListener)
            })
            
            // Iniciar scraping de la nueva página
            newPort.postMessage({ type: 'scrape', keyword })
          } catch (err) {
            console.error('Error navegando a siguiente página:', err)
            port.onMessage.removeListener(handleResult)
            showProgress(false)
            scrapeEnProgreso = false
            scrapePausado = false
            await clearScrapeState(scrapeKey)
            await updateKeywordStatus(keyword, 'Error')
            alert('Error al navegar a la siguiente página')
            setCurrentPort(null)
            currentScrapeKey = null
          }
        }
      } else {
        // No hay más páginas o no es Falabella, terminar
        console.log('Finalizando scraping. Razón:', !message.hasNextPage ? 'No hay más páginas' : 'No es Falabella')
        port.onMessage.removeListener(handleResult)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        
        const resultKey = buildResultsKey(keyword)
        await chrome.storage.local.set({ [resultKey]: allScrapedProducts })
        await updateKeywordData(keyword, 'Done', allScrapedProducts.length)
        
        // Limpiar estado del scraping
        await clearScrapeState(scrapeKey)
        
        // Mostrar resultados en el cuadro
        todosLosProductos = allScrapedProducts
        paginaActual = 1
        actualizarVista()
        setCurrentPort(null)
        currentScrapeKey = null
      }
    }

    port.onMessage.addListener(handleResult)
    port.postMessage({ type: 'scrape', keyword })
  })

  // Wire up click handlers
  scrapeButtonElement?.addEventListener('click', async () =>  {
    if (scrapeEnProgreso) {
      alert('Ya hay un scraping en progreso. Espera a que termine.')
      return
    }
    
    const port = await connectToActiveTab()
    if (!port) return

    setCurrentPort(port)
    
    // Detectar el sitio desde la URL activa
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const activeTab = tabs?.[0]
    const currentUrl = activeTab?.url || ''
    let site: 'falabella' | 'mercadolibre' | 'unknown' = 'unknown'
    
    if (currentUrl.includes('falabella.com')) {
      site = 'falabella'
    } else if (currentUrl.includes('mercadolibre.com')) {
      site = 'mercadolibre'
    }

    if (site === 'unknown') {
      alert('Abre una página de resultados de Falabella o MercadoLibre antes de empezar.')
      return
    }

    const manualKey = buildScrapeKey(site, 'scrape_manual')

    // Mostrar barra de progreso
    showProgress(true)
    updateProgress(0)
    scrapeEnProgreso = true
    scrapePausado = false
    togglePauseResumeButtons(false)
    currentScrapeKey = manualKey
    
    let allScrapedProducts: any[] = []
    let currentPageNum = 1
    let progressStreaming = false

    const handleMessage = async (response: any) => {
      // Manejar progreso en tiempo real
      if (response?.type === 'progress') {
        const items = Array.isArray(response.items) ? response.items : null
        if (items && items.length > 0) {
          allScrapedProducts.push(...items)
          progressStreaming = true
          refreshResultsPreview(allScrapedProducts)
        }
        const count = Number(response.count) || 0
        const total = response.total || undefined
        const page = response.page || undefined
        const nextCount = items ? allScrapedProducts.length : allScrapedProducts.length + count
        updateProgress(nextCount, total, page)
        await saveScrapeState(manualKey, {
          isRunning: true,
          isPaused: scrapePausado,
          keyword: 'scrape_manual',
          site,
          currentPage: currentPageNum,
          totalPages: response.totalPages || 150,
          productsCount: nextCount,
          accumulatedProducts: allScrapedProducts
        })
        return
      }

      if (response?.type === 'scrape_cancelled') {
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState(manualKey)
        setCurrentPort(null)
        currentScrapeKey = null
        return
      }
      
      if (!response || response.type !== 'scrape_result') return
      
      console.log('Popup: Recibido scrape_result:', response)
      console.log('hasNextPage:', response.hasNextPage, 'currentPage:', response.currentPage, 'totalPages:', response.totalPages)

      if (response.error) {
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState(manualKey)
        console.error('Error en content script:', response.error)
        alert('Error al scrapear.\n\nPor favor recarga la página (F5) y vuelve a intentar.')
        setCurrentPort(null)
        currentScrapeKey = null
        return
      }

      const pageProducts = response.result || []
      
      if (pageProducts.length === 0 && currentPageNum === 1) {
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState(manualKey)
        alert('No se encontraron productos en esta página.\n\nAsegúrate de estar en una página de resultados de búsqueda.')
        setCurrentPort(null)
        currentScrapeKey = null
        return
      }

      // Acumular productos
      if (!progressStreaming || allScrapedProducts.length === 0) {
        allScrapedProducts.push(...pageProducts)
      }
      console.log(`Página ${currentPageNum}: ${pageProducts.length} productos. Total acumulado: ${allScrapedProducts.length}`)
      
      // Actualizar progress con el total acumulado
      const total = response.total || undefined
      updateProgress(allScrapedProducts.length, total, currentPageNum)
      refreshResultsPreview(allScrapedProducts)
      
      // Guardar estado del scraping
      await saveScrapeState(manualKey, {
        isRunning: true,
        isPaused: scrapePausado,
        keyword: 'scrape_manual', // Identificador para scraping manual
        site,
        currentPage: currentPageNum,
        totalPages: response.totalPages || 150,
        productsCount: allScrapedProducts.length,
        accumulatedProducts: allScrapedProducts
      })
      
      // Verificar si está pausado
      if (scrapePausado) {
        console.log('Scraping pausado por el usuario')
        port.onMessage.removeListener(handleMessage)
        return
      }
      
      // Verificar si hay más páginas y es Falabella
      console.log('Verificando navegación:', { 
        hasNextPage: response.hasNextPage, 
        site, 
        currentPageNum, 
        shouldNavigate: response.hasNextPage && site === 'falabella' 
      })
      
      if (response.hasNextPage && site === 'falabella') {
        currentPageNum++
        console.log(`Navegando a página ${currentPageNum}...`)
        
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const activeTab = tabs?.[0]
        
        if (activeTab?.id) {
          try {
            // Construir URL para la siguiente página
            const currentUrl = activeTab.url || ''
            const url = new URL(currentUrl)
            url.searchParams.set('page', currentPageNum.toString())
            const nextPageUrl = url.toString()
            
            console.log(`Actualizando tab a: ${nextPageUrl}`)
            
            // Navegar a la siguiente página
            await chrome.tabs.update(activeTab.id, { url: nextPageUrl })
            
            // Esperar a que cargue la nueva página
            console.log('Esperando que la página cargue...')
            await new Promise<void>((resolve) => {
              const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
                if (tabId === activeTab.id && info.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener)
                  console.log('Página cargada, esperando 2s extra...')
                  setTimeout(() => resolve(), 2000)
                }
              }
              chrome.tabs.onUpdated.addListener(listener)
            })
            
            console.log('Conectando al nuevo content script...')
            // Reconectar al nuevo content script
            const newPort = chrome.tabs.connect(activeTab.id, { name: 'popup-connection' })
            newPort.onMessage.addListener(handleMessage)
            setCurrentPort(newPort)
            
            // Esperar mensaje de conexión
            console.log('Esperando confirmación de conexión...')
            await new Promise<void>((resolve) => {
              const connListener = (msg: any) => {
                if (msg?.type === 'connection_established') {
                  newPort.onMessage.removeListener(connListener)
                  console.log('Conexión establecida ✓')
                  resolve()
                }
              }
              newPort.onMessage.addListener(connListener)
            })
            
            // Iniciar scraping de la nueva página
            console.log('Iniciando scraping de la nueva página...')
            newPort.postMessage({ type: 'scrape' })
          } catch (err) {
            console.error('Error navegando a siguiente página:', err)
            port.onMessage.removeListener(handleMessage)
            showProgress(false)
            scrapeEnProgreso = false
            scrapePausado = false
            await clearScrapeState(manualKey)
            alert('Error al navegar a la siguiente página')
            setCurrentPort(null)
            currentScrapeKey = null
          }
        }
      } else {
        // No hay más páginas, terminar
        console.log('Finalizando scraping. Razón:', !response.hasNextPage ? 'No hay más páginas' : 'No es Falabella')
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        
        // Limpiar estado del scraping
        await clearScrapeState(manualKey)
        
        // Guardar todos los productos extraídos
        todosLosProductos = allScrapedProducts

        // Resetear a la primera página cuando se scrapean nuevos productos
        paginaActual = 1

        actualizarVista()

        // Mostrar mensaje de éxito
        console.log(`✓ Scraping completo: ${allScrapedProducts.length} productos en total`)
        setCurrentPort(null)
        currentScrapeKey = null
      }
    }

    port.onMessage.addListener(handleMessage)
    port.postMessage({ type: 'scrape' })
  })
  
  clearButtonElement?.addEventListener('click', () => {
    todosLosProductos = []
    paginaActual = 1
    const resultEl = document.getElementById('result')
    if (resultEl) resultEl.innerHTML = ''
  })

  // Delegar eventos para los botones de paginación interna
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    
    if (target.id === 'prevPageBtn') {
      if (paginaActual > 1) {
        paginaActual--
        actualizarVista()
      }
    }
    
    if (target.id === 'nextPageBtn') {
      const totalPaginas = Math.ceil(todosLosProductos.length / ITEMS_PER_PAGE)
      if (paginaActual < totalPaginas) {
        paginaActual++
        actualizarVista()
      }
    }
  })
}



init()
