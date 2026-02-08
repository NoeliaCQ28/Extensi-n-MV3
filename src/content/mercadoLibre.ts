// Content script for MercadoLibre: scraper and pagination handler

console.log('MercadoLibre content script injected')

interface Producto {
  marca?: string
  nombreArticulo: string
  precioArticulo: string
  descuento?: string
  quienComercializa?: string
}

const scrapearProductosMercadoLibre = (): Producto[] => {
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
  
  const datos = Array.from(nodeList)
  const productos = datos.map((producto: Element) => {
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

      return {
        nombreArticulo,
        precioArticulo,
        descuento,
        quienComercializa,
        marca: undefined
      }
    } catch (err) {
      console.error('Error al procesar producto individual:', err)
      return {
        nombreArticulo: 'Error al procesar',
        precioArticulo: 'N/A'
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('MercadoLibre: Mensaje recibido', message)
  
  if (message?.type === 'scrape') {
    try {
      const productos = scrapearProductosMercadoLibre()
      console.log('MercadoLibre: Enviando respuesta con', productos.length, 'productos')
      sendResponse({ result: productos })

      // Enviar datos al background
      try {
        chrome.runtime.sendMessage({ type: 'scrapedData', data: productos }, (resp) => {
          // opcional: manejar respuesta
        })
      } catch (err) {
        console.warn('No se pudo enviar datos al background', err)
      }
    } catch (err) {
      console.error('MercadoLibre scrape error', err)
      sendResponse({ error: String(err) })
    }
    return true
  }

  if (message?.type === 'nextPage') {
    try {
      const success = clickSiguientePaginaMercadoLibre()
      sendResponse({ success })
    } catch (err) {
      console.error('Error en nextPage:', err)
      sendResponse({ success: false, error: String(err) })
    }
    return true
  }
})
