// Content script for Falabella: scrape product items and respond to messages from the extension

const FALABELLA_INJECTED_FLAG = '__krowdy_falabella_injected__'

if ((globalThis as any)[FALABELLA_INJECTED_FLAG]) {
  console.debug('Falabella content script already injected')
} else {
  ;(globalThis as any)[FALABELLA_INJECTED_FLAG] = true

console.log('Falabella content script injected')

let cancelRequested = false

const checkCancelled = () => {
  if (cancelRequested) {
    const err = new Error('Cancelled')
    ;(err as any).cancelled = true
    throw err
  }
}

const parsePriceNumber = (value?: string) => {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.,]/g, '').replace(/,/g, '')
  const numeric = Number.parseFloat(cleaned)
  return Number.isFinite(numeric) ? numeric : null
}

const scrapearProductosFalabella = async (keywordOverride?: string) => {
  if (cancelRequested) return []
  // Intentar múltiples selectores para máxima compatibilidad
  let nodeList = document.querySelectorAll('a[data-pod="catalyst-pod"]')
  
  // Fallback a otros selectores si el primero no funciona
  if (nodeList.length === 0) {
    nodeList = document.querySelectorAll('[data-testid=ssr-pod]')
  }
  
  if (nodeList.length === 0) {
    console.warn('Falabella: No se encontraron productos con ningún selector')
    return []
  }
  
  console.log(`Falabella: Encontrados ${nodeList.length} productos`)
  
  const keyword = keywordOverride || document.querySelector('h1')?.textContent?.trim() || 'falabella'
  const timestamp = Date.now()
  const datos = Array.from(nodeList)
  const productos: any[] = []

  for (let index = 0; index < datos.length; index++) {
    checkCancelled()
    if (index % 25 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const producto = datos[index]
    const text = (producto as HTMLElement).innerText || ''
    const lines = text.split('\n').filter(line => line.trim())

    // Extraer datos de las líneas
    const marca = lines[0] || null
    const titulo = lines[1] || marca || 'Sin titulo'
    const vendedor = lines.find(l => l.includes('Por ')) || null

    // Buscar precio (puede estar en diferentes formatos)
    let precioVisible: string | null = null
    let precioNumerico: number | null = null

    for (const line of lines) {
      if (line.includes('S/')) {
        precioVisible = line
        precioNumerico = parsePriceNumber(line)
        break
      }
    }

    const url = (producto as HTMLAnchorElement).href || window.location.href

    productos.push({
      site: 'falabella',
      keyword,
      timestamp,
      posicion: index + 1,
      titulo,
      precioVisible,
      precioNumerico,
      url,
      marca,
      vendedor
    })
  }
  
  console.log(`Falabella: Procesados ${productos.length} productos`)
  return productos
}

const clickSiguientePaginaFalabella = (): boolean => {
  try {
    checkCancelled()
    console.log('Buscando botón con selector: #testId-pagination-bottom-arrow-right')
    // Selector exacto del botón de flecha derecha en la paginación de Falabella
    const btnSiguiente = document.querySelector('#testId-pagination-bottom-arrow-right') as HTMLButtonElement
    console.log('Botón encontrado:', btnSiguiente)
    console.log('Botón deshabilitado:', btnSiguiente?.disabled)
    
    if (btnSiguiente && !btnSiguiente.disabled) {
      console.log('✓ Haciendo clic en botón siguiente página')
      btnSiguiente.click()
      return true
    }
    
    // Alternativa: buscar por otros selectores
    console.log('Probando selector alternativo: button.pagination-arrow:last-of-type:not([disabled])')
    const btnAlt = document.querySelector('button.pagination-arrow:last-of-type:not([disabled])') as HTMLButtonElement
    console.log('Botón alternativo encontrado:', btnAlt)
    
    if (btnAlt) {
      console.log('✓ Usando selector alternativo para siguiente página')
      btnAlt.click()
      return true
    }
    
    // Tercer intento: buscar por ID del contenedor y luego la flecha derecha
    console.log('Probando selector por contenedor de paginación')
    const paginationContainer = document.querySelector('[data-pagination-container="true"]')
    console.log('Contenedor de paginación:', paginationContainer)
    
    if (paginationContainer) {
      const arrowRight = paginationContainer.querySelector('button[id*="arrow-right"]:not([disabled])') as HTMLButtonElement
      console.log('Flecha derecha en contenedor:', arrowRight)
      
      if (arrowRight) {
        console.log('✓ Usando botón de flecha derecha del contenedor')
        arrowRight.click()
        return true
      }
    }
    
    console.log('✗ No se encontró botón de siguiente página habilitado')
    return false
  } catch (err) {
    console.error('Error al hacer clic en siguiente página:', err)
    return false
  }
}

const wait = async (ms: number) => {
  const endTime = Date.now() + ms
  while (Date.now() < endTime) {
    checkCancelled()
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

// Esperar a que cambie la URL (indicador de que navegó a otra página)
const waitForPageChange = async (currentUrl: string, timeout: number = 15000): Promise<boolean> => {
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeout) {
    checkCancelled()
    if (window.location.href !== currentUrl) {
      console.log(`✓ URL cambió de: ${currentUrl}`)
      console.log(`✓ Nueva URL: ${window.location.href}`)
      return true
    }
    await wait(200)
  }
  
  console.warn('Timeout esperando cambio de URL')
  return false
}

// Esperar a que la página cargue los productos (Falabella usa paginación, no scroll infinito)
const waitForProductsToLoad = async () => {
  const maxWait = 15000 // 15 segundos máximo
  const checkInterval = 500
  let waited = 0
  
  console.log('Esperando productos...')
  
  while (waited < maxWait) {
    checkCancelled()
    const count = document.querySelectorAll('a[data-pod="catalyst-pod"], [data-testid=ssr-pod]').length
    if (count > 0) {
      console.log(`✓ ${count} productos detectados después de ${waited}ms`)
      // Esperar un poco más para asegurar que todo cargó
      await wait(2000)
      return count
    }
    await wait(checkInterval)
    waited += checkInterval
  }
  
  console.warn('Timeout esperando productos')
  return 0
}

// Obtener info de paginación actual
const getPaginationInfo = () => {
  const resultsSpan = document.querySelector('#search_numResults')
  if (resultsSpan) {
    const text = resultsSpan.textContent || ''
    const match = text.match(/(\d+)\s*-\s*(\d+)\s+de\s+([\d,]+)/)
    if (match) {
      return {
        from: parseInt(match[1]),
        to: parseInt(match[2]),
        total: parseInt(match[3].replace(/,/g, ''))
      }
    }
  }
  return null
}

// Construir clave única basada en URL (más confiable)
const buildItemKey = (item: any) => {
  // Usar URL limpia como clave principal
  if (item?.url) {
    try {
      const url = new URL(item.url, window.location.origin)
      return url.pathname // Solo el path, sin parámetros
    } catch {
      return item.url
    }
  }
  return `${item?.titulo || ''}|${item?.precioVisible || ''}`
}

// Construir URL para una página específica
const buildPageUrl = (baseUrl: string, pageNumber: number): string => {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('page', pageNumber.toString())
    return url.toString()
  } catch {
    // Fallback si hay error parseando URL
    if (baseUrl.includes('?')) {
      return baseUrl.replace(/([?&])page=\d+/, `$1page=${pageNumber}`)
    }
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${pageNumber}`
  }
}

// Navegar a una página específica usando window.location
const navigateToPage = async (pageNumber: number, currentUrl: string): Promise<void> => {
  checkCancelled()
  const newUrl = buildPageUrl(currentUrl, pageNumber)
  console.log(`Navegando a: ${newUrl}`)
  window.location.href = newUrl
  // Esta promesa nunca se resuelve porque la página se recarga
  await new Promise(() => {})
}

async function scrapeIterativoFalabella(port: chrome.runtime.Port, keyword?: string) {
  checkCancelled()
  const allProducts = new Map<string, any>()
  const startTime = Date.now()
  
  console.log('FALABELLA - INICIANDO SCRAPING ITERATIVO')
  console.log('URL inicial:', window.location.href)
  console.log('Keyword:', keyword || 'auto-detectado')
  
  // Detectar la página actual desde la URL
  const currentUrl = window.location.href
  const urlObj = new URL(currentUrl)
  const currentPage = parseInt(urlObj.searchParams.get('page') || '1')
  console.log(`Página actual detectada: ${currentPage}`)
  
  // Obtener info de paginación para saber cuántas páginas hay
  const initialInfo = getPaginationInfo()
  let totalPages = 150 // Default
  
  if (initialInfo) {
    totalPages = Math.ceil(initialInfo.total / 48) // 48 productos por página
    console.log(`Total disponible: ${initialInfo.total} productos`)
    console.log(`Total de páginas estimado: ${totalPages}`)
    port.postMessage({ 
      type: 'progress', 
      count: 0, 
      total: initialInfo.total,
      page: currentPage
    })
  }

  // IMPORTANTE: Solo scrapear la página actual
  // El popup manejará la navegación entre páginas
  console.log(`\n========== Scrapeando SOLO página ${currentPage} ==========`)
  
  // Esperar a que carguen los productos
  await waitForProductsToLoad()
  checkCancelled()
  
  // Scrapear productos de esta página
  const pageProducts = await scrapearProductosFalabella(keyword)
  console.log(`✓ ${pageProducts.length} productos encontrados`)
  
  // Agregar productos (sin deduplicación entre páginas)
  for (const product of pageProducts) {
    checkCancelled()
    const key = buildItemKey(product)
    allProducts.set(key, product)
  }
  
  const result = Array.from(allProducts.values()).map((p, idx) => ({
    ...p,
    posicion: idx + 1
  }))

  const endTime = Date.now()
  const durationSeconds = ((endTime - startTime) / 1000).toFixed(2)
  
  console.log('FALABELLA - SCRAPING DE PÁGINA COMPLETADO')
  console.log(`Productos en esta página: ${result.length}`)
  console.log(`Tiempo: ${durationSeconds} segundos`)
  console.log(`Página actual: ${currentPage} de ~${totalPages}`)
  
  // Retornar con metadata de paginación
  return {
    products: result,
    currentPage,
    totalPages,
    hasNextPage: currentPage < totalPages
  }
}

chrome.runtime.onConnect.addListener((port) => {
  console.log('Falabella: Puerto conectado')
  port.postMessage({ type: 'connection_established' })

  port.onMessage.addListener(async (message) => {
    console.log('Falabella: Mensaje recibido', message)

    if (message?.type === 'scrape') {
      cancelRequested = false
      let timeoutId: number | null = null
      
      try {
        // Timeout de seguridad: 2 minutos para una sola página
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error('Timeout: El scraping de la página excedió los 2 minutos'))
          }, 120000)
        })
        
        // Ejecutar scraping con timeout
        const scrapingPromise = scrapeIterativoFalabella(
          port, 
          typeof message.keyword === 'string' ? message.keyword : undefined
        )
        
        const resultado = await Promise.race([scrapingPromise, timeoutPromise]) as any
        
        if (timeoutId) clearTimeout(timeoutId)
        
        console.log('✓ Falabella: Scraping de página completado -', resultado.products?.length || 0, 'productos')
        console.log('Enviando mensaje con:', {
          hasNextPage: resultado.hasNextPage,
          currentPage: resultado.currentPage,
          totalPages: resultado.totalPages
        })
        
        port.postMessage({ 
          type: 'scrape_result', 
          result: resultado.products || [],
          currentPage: resultado.currentPage,
          totalPages: resultado.totalPages,
          hasNextPage: resultado.hasNextPage
        })

        try {
          chrome.runtime.sendMessage({ 
            type: 'scrapedData', 
            data: resultado.products || [],
            pageInfo: {
              currentPage: resultado.currentPage,
              totalPages: resultado.totalPages,
              hasNextPage: resultado.hasNextPage
            }
          }, () => {})
        } catch (err) {
          console.warn('Could not send scraped data to background', err)
        }
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId)
        console.error('✗ Falabella scrape error:', err)
        if ((err as any)?.cancelled) {
          port.postMessage({ type: 'scrape_cancelled' })
        } else {
          port.postMessage({ type: 'scrape_result', error: String(err) })
        }
      }
    }

    if (message?.type === 'cancel') {
      cancelRequested = true
      port.postMessage({ type: 'scrape_cancelled' })
      return
    }

    if (message?.type === 'nextPage') {
      try {
        const success = clickSiguientePaginaFalabella()
        port.postMessage({ type: 'nextPage_result', success })
      } catch (err) {
        console.error('Error en nextPage:', err)
        port.postMessage({ type: 'nextPage_result', success: false, error: String(err) })
      }
    }
  })
})
}
