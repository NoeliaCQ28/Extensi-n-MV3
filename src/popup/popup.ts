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
  renderKeywords()
}

async function saveKeywords() {
  await chrome.storage.local.set({ [KEYWORDS_STORAGE_KEY]: keywords })
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

    const url = action === 'falabella' ? buildFalabellaUrl(keyword) : buildMercadoLibreUrl(keyword)
    chrome.tabs.create({ url })
  })

  // Wire up click handlers
  scrapeButtonElement?.addEventListener('click', async () =>  {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const activeTab = tabs && tabs[0]

    if (!activeTab || typeof activeTab.id !== 'number') {
        console.error('No active tab with numeric id found. Aborting script injection.')
        alert('Error: No se pudo identificar la pestaña activa')
        return
    }

    console.log('Enviando mensaje de scrape a tab:', activeTab.id)

    // Request content script to scrape current page. Content script must listen for {type: 'scrape'}
    let response: any = await new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTab.id!, { type: 'scrape' }, (res) => {
          if (chrome.runtime.lastError) {
            console.error('Error al enviar mensaje:', chrome.runtime.lastError)
            resolve({ error: chrome.runtime.lastError.message, needsInjection: true })
            return
          }
          resolve(res)
        })
    })

    // Si el content script no está cargado, intentar inyectarlo manualmente
    if (response?.needsInjection && activeTab.url) {
      console.log('Intentando inyectar content script manualmente...')
      const injected = await tryInjectContentScript(activeTab.id, activeTab.url)
      
      if (injected) {
        // Reintentar enviar el mensaje
        response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(activeTab.id!, { type: 'scrape' }, (res) => {
            if (chrome.runtime.lastError) {
              console.error('Error después de inyección:', chrome.runtime.lastError)
              resolve({ error: chrome.runtime.lastError.message })
              return
            }
            resolve(res)
          })
        })
      } else {
        alert('Esta extensión solo funciona en Falabella.com.pe y MercadoLibre.com.pe\n\nPor favor, recarga la página (F5) después de instalar/actualizar la extensión.')
        return
      }
    }

    console.log('Respuesta recibida:', response)

    if (!response) {
        console.warn('No response from content script on active tab')
        alert('No se recibió respuesta.\n\nPor favor:\n1. Recarga la página (F5)\n2. Vuelve a intentar')
        return
    }

    if (response.error) {
        console.error('Error en content script:', response.error)
        alert(`Error al scrapear.\n\nPor favor recarga la página (F5) y vuelve a intentar.`)
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
