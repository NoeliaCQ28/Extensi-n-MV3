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

async function init() {
  await loadKeywords()

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
      return
    }

    const site = action === 'falabella' ? 'falabella' : 'mercadolibre'
    await updateKeywordStatus(keyword, 'Running')
    const port = await openAndConnect(site, keyword)
    if (!port) return

    const handleResult = async (message: any) => {
      if (message?.type === 'progress') {
        await updateKeywordData(keyword, 'Running', Number(message.count) || 0)
        return
      }
      if (message?.type !== 'scrape_result') return
      port.onMessage.removeListener(handleResult)

      if (message.error) {
        await updateKeywordStatus(keyword, 'Error')
        return
      }

      const result = Array.isArray(message.result) ? message.result : []
      const resultKey = buildResultsKey(keyword)
      await chrome.storage.local.set({ [resultKey]: result })
      await updateKeywordData(keyword, 'Done', result.length)
    }

    port.onMessage.addListener(handleResult)
    port.postMessage({ type: 'scrape', keyword })
  })

  // Wire up click handlers
  scrapeButtonElement?.addEventListener('click', async () =>  {
    const port = await connectToActiveTab()
    if (!port) return

    const handleMessage = (response: any) => {
      if (!response || response.type !== 'scrape_result') return
      port.onMessage.removeListener(handleMessage)

      if (response.error) {
        console.error('Error en content script:', response.error)
        alert('Error al scrapear.\n\nPor favor recarga la página (F5) y vuelve a intentar.')
        return
      }

      const products = response.result || []

      if (products.length === 0) {
        alert('No se encontraron productos en esta página.\n\nAsegúrate de estar en una página de resultados de búsqueda.')
        return
      }

      // Agregar productos a la lista acumulada
      todosLosProductos = [...todosLosProductos, ...products]

      // Resetear a la primera página cuando se scrapean nuevos productos
      paginaActual = 1

      actualizarVista()

      // Mostrar mensaje de éxito
      console.log(`Scrapeados ${products.length} productos (${todosLosProductos.length} en total)`)
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
