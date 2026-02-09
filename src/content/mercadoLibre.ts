// Content script for MercadoLibre: scraper and pagination handler

const MERCADOLIBRE_INJECTED_FLAG = '__krowdy_mercadolibre_injected__'

if ((globalThis as any)[MERCADOLIBRE_INJECTED_FLAG]) {
  console.debug('MercadoLibre content script already injected')
} else {
  ;(globalThis as any)[MERCADOLIBRE_INJECTED_FLAG] = true

console.log('MercadoLibre content script injected')

interface Producto {
  site: string
  keyword: string
  timestamp: number
  posicion: number
  titulo: string
  precioVisible?: string | null
  precioNumerico?: number | null
  url: string
  marca?: string | null
  vendedor?: string | null
}

const parsePriceNumber = (value?: string) => {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.,]/g, '').replace(/,/g, '')
  const numeric = Number.parseFloat(cleaned)
  return Number.isFinite(numeric) ? numeric : null
}

const scrapearProductosMercadoLibre = (keywordOverride?: string): Producto[] => {
  // Intentar diferentes selectores para mayor compatibilidad
  const selectors = [
    '.ui-search-result__wrapper',
    '.ui-search-result',
    '[class*="ui-search-result"]'
  ]
  
  let nodeList: NodeListOf<Element> | null = null
  
  for (const selector of selectors) {
    nodeList = document.querySelectorAll(selector)
    if (nodeList.length > 0) {
      console.log(`MercadoLibre: Encontrados ${nodeList.length} productos con selector: ${selector}`)
      break
    }
  }
  
  if (!nodeList || nodeList.length === 0) {
    console.warn('MercadoLibre: No se encontraron productos')
    return []
  }
  
  const keyword = keywordOverride || (document.querySelector('#cb1-edit') as HTMLInputElement | null)?.value?.trim() || 'mercadolibre'
  const timestamp = Date.now()
  const datos = Array.from(nodeList)
  const productos = datos.map((producto: Element, index: number) => {
    try {
      // Extraer título - intentar múltiples selectores
      const tituloSelectors = [
        '.ui-search-item__title',
        '.poly-component__title',
        'h2.poly-box',
        '[class*="title"]'
      ]
      
      let nombreArticulo = 'Sin título'
      for (const sel of tituloSelectors) {
        const el = producto.querySelector(sel)
        if (el?.textContent?.trim()) {
          nombreArticulo = el.textContent.trim()
          break
        }
      }

      // Extraer precio - intentar múltiples selectores
      const precioSelectors = [
        '.andes-money-amount__fraction',
        '.price-tag-fraction',
        '[class*="price-tag-fraction"]',
        '[class*="money-amount"]'
      ]
      
      let precioArticulo = 'Sin precio'
      for (const sel of precioSelectors) {
        const el = producto.querySelector(sel)
        if (el?.textContent?.trim()) {
          const simbolo = producto.querySelector('.andes-money-amount__currency-symbol')?.textContent?.trim() || 'S/'
          precioArticulo = `${simbolo} ${el.textContent.trim()}`
          break
        }
      }

      // Extraer descuento si existe
      const descuentoSelectors = [
        '.ui-search-price__discount',
        '[class*="discount"]'
      ]
      
      let descuento: string | undefined
      for (const sel of descuentoSelectors) {
        const el = producto.querySelector(sel)
        if (el?.textContent?.trim()) {
          descuento = el.textContent.trim()
          break
        }
      }

      // Extraer vendedor si existe
      const vendedorSelectors = [
        '.ui-search-official-store-label',
        '.ui-search-item__brand-discoverability',
        '[class*="official-store"]'
      ]
      
      let quienComercializa: string | undefined
      for (const sel of vendedorSelectors) {
        const el = producto.querySelector(sel)
        if (el?.textContent?.trim()) {
          quienComercializa = el.textContent.trim()
          break
        }
      }

      const url = (producto as HTMLElement).querySelector('a')?.getAttribute('href') || window.location.href
      const precioNumerico = parsePriceNumber(precioArticulo)

      return {
        site: 'mercadolibre',
        keyword,
        timestamp,
        posicion: index + 1,
        titulo: nombreArticulo,
        precioVisible: precioArticulo || null,
        precioNumerico,
        url,
        marca: null,
        vendedor: quienComercializa || null
      }
    } catch (err) {
      console.error('Error al procesar producto individual:', err)
      return {
        site: 'mercadolibre',
        keyword,
        timestamp,
        posicion: index + 1,
        titulo: 'Error al procesar',
        precioVisible: null,
        precioNumerico: null,
        url: window.location.href,
        marca: null,
        vendedor: null
      }
    }
  })
  
  console.log(`MercadoLibre: Procesados ${productos.length} productos`)
  return productos
}

const clickSiguientePaginaMercadoLibre = (): boolean => {
  try {
    // Buscar el botón de siguiente página
    const btnSiguiente = document.querySelector('.andes-pagination__button--next:not(.andes-pagination__button--disabled)')
    if (btnSiguiente && btnSiguiente instanceof HTMLElement) {
      btnSiguiente.click()
      return true
    }
    return false
  } catch (err) {
    console.error('Error al hacer clic en siguiente página:', err)
    return false
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function scrapeIterativoMercadoLibre(port: chrome.runtime.Port, keyword?: string) {
  const maxItems = 100 
  const maxPages = 15
  const all: any[] = []

  for (let page = 0; page < maxPages; page++) {
    const pageProducts = scrapearProductosMercadoLibre(keyword)
    const base = all.length
    const normalized = pageProducts.map((p: any, idx: number) => ({ ...p, posicion: base + idx + 1 }))
    all.push(...normalized)
    port.postMessage({ type: 'progress', count: all.length })

    if (all.length >= maxItems) break

    const hasNext = clickSiguientePaginaMercadoLibre()
    if (!hasNext) break

    await wait(1800)
  }

  return all
}

chrome.runtime.onConnect.addListener((port) => {
  console.log('MercadoLibre: Puerto conectado')
  port.postMessage({ type: 'connection_established' })

  port.onMessage.addListener(async (message) => {
    console.log('MercadoLibre: Mensaje recibido', message)

    if (message?.type === 'scrape') {
      try {
        const productos = await scrapeIterativoMercadoLibre(port, typeof message.keyword === 'string' ? message.keyword : undefined)
        console.log('MercadoLibre: Enviando respuesta con', productos.length, 'productos')
        port.postMessage({ type: 'scrape_result', result: productos })

        try {
          chrome.runtime.sendMessage({ type: 'scrapedData', data: productos }, () => {
          })
        } catch (err) {
          console.warn('No se pudo enviar datos al background', err)
        }
      } catch (err) {
        console.error('MercadoLibre scrape error', err)
        port.postMessage({ type: 'scrape_result', error: String(err) })
      }
    }

    if (message?.type === 'nextPage') {
      try {
        const success = clickSiguientePaginaMercadoLibre()
        port.postMessage({ type: 'nextPage_result', success })
      } catch (err) {
        console.error('Error en nextPage:', err)
        port.postMessage({ type: 'nextPage_result', success: false, error: String(err) })
      }
    }
  })
})
}
