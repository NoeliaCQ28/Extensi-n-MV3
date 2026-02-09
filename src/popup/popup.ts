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

const SCRAPE_STATE_KEY = 'scrape_state'

// Guardar estado del scraping
async function saveScrapeState(state: Partial<ScrapeState>) {
  const current = await loadScrapeState()
  const updated = { ...current, ...state, timestamp: Date.now() }
  await chrome.storage.local.set({ [SCRAPE_STATE_KEY]: updated })
}

// Cargar estado del scraping
async function loadScrapeState(): Promise<ScrapeState | null> {
  const result = await chrome.storage.local.get(SCRAPE_STATE_KEY)
  return result[SCRAPE_STATE_KEY] || null
}

// Limpiar estado del scraping
async function clearScrapeState() {
  await chrome.storage.local.remove(SCRAPE_STATE_KEY)
}

// Elementos de la barra de progreso
const progressContainer = () => document.getElementById('progressContainer')
const progressText = () => document.getElementById('progressText')
const progressCount = () => document.getElementById('progressCount')
const progressBar = () => document.getElementById('progressBar')
const progressPage = () => document.getElementById('progressPage')
const progressTotal = () => document.getElementById('progressTotal')
const pauseBtn = () => document.getElementById('pauseBtn')
const resumeBtn = () => document.getElementById('resumeBtn')
const cancelBtn = () => document.getElementById('cancelBtn')

function showProgress(show: boolean) {
  const container = progressContainer()
  if (container) {
    container.classList.toggle('hidden', !show)
  }
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
  
  // Verificar si hay scraping en progreso
  const savedState = await loadScrapeState()
  if (savedState && savedState.isRunning && !savedState.isPaused) {
    // Hay un scraping en progreso, preguntar si quiere continuar
    const continuar = confirm(
      `Se detectó un scraping en progreso:\n\n` +
      `Keyword: ${savedState.keyword}\n` +
      `Página: ${savedState.currentPage} de ${savedState.totalPages}\n` +
      `Productos: ${savedState.productsCount}\n\n` +
      `¿Quieres continuar donde lo dejaste?`
    )
    
    if (continuar) {
      // Restaurar estado y continuar
      scrapeEnProgreso = true
      showProgress(true)
      updateProgress(savedState.productsCount, savedState.totalPages * 48, savedState.currentPage)
      
      // Nota: El usuario deberá estar en la página correcta de Falabella
      // El popup detectará automáticamente y continuará
      console.log('Estado de scraping restaurado:', savedState)
    } else {
      // No quiere continuar, limpiar estado
      await clearScrapeState()
    }
  } else if (savedState && savedState.isPaused) {
    // Hay un scraping pausado
    showProgress(true)
    scrapePausado = true
    togglePauseResumeButtons(true)
    updateProgress(savedState.productsCount, savedState.totalPages * 48, savedState.currentPage)
    const textEl = progressText()
    if (textEl) textEl.textContent = '⏸ Pausado - Haz clic en Reanudar para continuar'
  }

  // Event listeners para controles de scraping
  pauseBtn()?.addEventListener('click', async () => {
    scrapePausado = true
    scrapeEnProgreso = false  // Liberar el flag para permitir operaciones futuras
    togglePauseResumeButtons(true)
    await saveScrapeState({ isPaused: true, isRunning: false })
    const textEl = progressText()
    if (textEl) textEl.textContent = '⏸ Pausado - Haz clic en Reanudar para continuar'
    console.log('Scraping pausado')
  })

  resumeBtn()?.addEventListener('click', async () => {
    const state = await loadScrapeState()
    if (!state) {
      alert('No hay un scraping pausado para reanudar')
      return
    }
    
    scrapePausado = false
    scrapeEnProgreso = true
    togglePauseResumeButtons(false)
    const textEl = progressText()
    if (textEl) textEl.textContent = 'Extrayendo productos...'
    console.log('Scraping reanudado desde página', state.currentPage)
    
    // Continuar el scraping automáticamente
    const port = await connectToActiveTab()
    if (!port) {
      alert('No se pudo conectar con la página. Asegúrate de estar en la página correcta de ' + state.site)
      scrapeEnProgreso = false
      return
    }

    setCurrentPort(port)
    
    // Restaurar variables
    let allScrapedProducts = state.accumulatedProducts || []
    let progressStreaming = false
    let currentPageNum = state.currentPage
    
    // Continuar con el scraping desde donde se quedó
    const handleMessage = async (response: any) => {
      if (response?.type === 'progress') {
        const items = Array.isArray(response.items) ? response.items : null
        if (items && items.length > 0) {
          allScrapedProducts.push(...items)
          progressStreaming = true
        }
        const count = Number(response.count) || 0
        const total = response.total || undefined
        const page = response.page || undefined
        const nextCount = items ? allScrapedProducts.length : allScrapedProducts.length + count
        updateProgress(nextCount, total, page)
        await saveScrapeState({
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
        await clearScrapeState()
        if (state.keyword && state.keyword !== 'scrape_manual') {
          await updateKeywordStatus(state.keyword, 'Cancelled')
        }
        setCurrentPort(null)
        return
      }
      
      if (!response || response.type !== 'scrape_result') return
      
      if (response.error) {
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState()
        alert('Error al scrapear: ' + response.error)
        setCurrentPort(null)
        return
      }

      const pageProducts = response.result || []
      if (!progressStreaming || allScrapedProducts.length === 0) {
        allScrapedProducts.push(...pageProducts)
      }
      console.log(`Página ${currentPageNum}: ${pageProducts.length} productos. Total acumulado: ${allScrapedProducts.length}`)
      
      const total = response.total || undefined
      updateProgress(allScrapedProducts.length, total, currentPageNum)
      
      await saveScrapeState({
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
            await clearScrapeState()
            alert('Error al navegar a la siguiente página')
            setCurrentPort(null)
          }
        }
      } else {
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState()
        todosLosProductos = allScrapedProducts
        paginaActual = 1
        actualizarVista()
        console.log(`✓ Scraping completo: ${allScrapedProducts.length} productos en total`)
        setCurrentPort(null)
      }
    }

    port.onMessage.addListener(handleMessage)
    port.postMessage({ type: 'scrape' })
  })

  cancelBtn()?.addEventListener('click', async () => {
    // Obtener estado ANTES de limpiarlo
    const state = await loadScrapeState()
    
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
      await clearScrapeState()
      console.log('Scraping cancelado')
      
      // Actualizar keyword a estado Idle si corresponde
      if (state && state.keyword && state.keyword !== 'scrape_manual') {
        await updateKeywordStatus(state.keyword, 'Cancelled')
      }

      setCurrentPort(null)
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
      return
    }

    const site = action === 'falabella' ? 'falabella' : 'mercadolibre'
    await updateKeywordStatus(keyword, 'Running')
    const port = await openAndConnect(site, keyword)
    if (!port) return

    setCurrentPort(port)

    // Mostrar barra de progreso
    showProgress(true)
    updateProgress(0)
    scrapeEnProgreso = true
    
    let allScrapedProducts: any[] = []
    let progressStreaming = false
    let currentPageNum = 1
    
    const handleResult = async (message: any) => {
      if (message?.type === 'progress') {
        const count = Number(message.count) || 0
        const total = message.total || undefined
        const page = message.page || undefined
        await updateKeywordData(keyword, 'Running', allScrapedProducts.length + count)
        updateProgress(allScrapedProducts.length + count, total, page)
        return
      }
      if (message?.type === 'scrape_cancelled') {
        port.onMessage.removeListener(handleResult)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState()
        await updateKeywordStatus(keyword, 'Cancelled')
        setCurrentPort(null)
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
        await clearScrapeState()
        await updateKeywordStatus(keyword, 'Error')
        alert(`Error al scrapear: ${message.error}`)
        setCurrentPort(null)
        return
      }

      const pageProducts = Array.isArray(message.result) ? message.result : []
      allScrapedProducts.push(...pageProducts)
      
      console.log(`Página ${currentPageNum}: ${pageProducts.length} productos. Total acumulado: ${allScrapedProducts.length}`)
      
      // Actualizar progress con el total acumulado
      const total = message.total || undefined
      await updateKeywordData(keyword, 'Running', allScrapedProducts.length)
      updateProgress(allScrapedProducts.length, total, currentPageNum)
      
      // Guardar estado del scraping
      await saveScrapeState({
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
            await clearScrapeState()
            await updateKeywordStatus(keyword, 'Error')
            alert('Error al navegar a la siguiente página')
            setCurrentPort(null)
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
        await clearScrapeState()
        
        // Mostrar resultados en el cuadro
        todosLosProductos = allScrapedProducts
        paginaActual = 1
        actualizarVista()
        setCurrentPort(null)
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

    // Mostrar barra de progreso
    showProgress(true)
    updateProgress(0)
    scrapeEnProgreso = true
    
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
        }
        const count = Number(response.count) || 0
        const total = response.total || undefined
        const page = response.page || undefined
        const nextCount = items ? allScrapedProducts.length : allScrapedProducts.length + count
        updateProgress(nextCount, total, page)
        await saveScrapeState({
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
        await clearScrapeState()
        setCurrentPort(null)
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
        await clearScrapeState()
        console.error('Error en content script:', response.error)
        alert('Error al scrapear.\n\nPor favor recarga la página (F5) y vuelve a intentar.')
        setCurrentPort(null)
        return
      }

      const pageProducts = response.result || []
      
      if (pageProducts.length === 0 && currentPageNum === 1) {
        port.onMessage.removeListener(handleMessage)
        showProgress(false)
        scrapeEnProgreso = false
        scrapePausado = false
        await clearScrapeState()
        alert('No se encontraron productos en esta página.\n\nAsegúrate de estar en una página de resultados de búsqueda.')
        setCurrentPort(null)
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
      
      // Guardar estado del scraping
      await saveScrapeState({
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
            await clearScrapeState()
            alert('Error al navegar a la siguiente página')
            setCurrentPort(null)
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
        await clearScrapeState()
        
        // Guardar todos los productos extraídos
        todosLosProductos = allScrapedProducts

        // Resetear a la primera página cuando se scrapean nuevos productos
        paginaActual = 1

        actualizarVista()

        // Mostrar mensaje de éxito
        console.log(`✓ Scraping completo: ${allScrapedProducts.length} productos en total`)
        setCurrentPort(null)
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
