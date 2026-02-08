import { showResults, ITEMS_PER_PAGE } from '../utils/index'

const scrapeButtonElement = document.getElementById('scrapeButton') as HTMLButtonElement | null
const clearButtonElement = document.getElementById('clearButton') as HTMLButtonElement | null

let todosLosProductos: any[] = []
let paginaActual: number = 1

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
