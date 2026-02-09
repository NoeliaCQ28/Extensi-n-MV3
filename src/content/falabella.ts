// Content script for Falabella: scrape product items and respond to messages from the extension

const FALABELLA_INJECTED_FLAG = '__krowdy_falabella_injected__'

if ((globalThis as any)[FALABELLA_INJECTED_FLAG]) {
  console.debug('Falabella content script already injected')
} else {
  ;(globalThis as any)[FALABELLA_INJECTED_FLAG] = true

console.log('Falabella content script injected')

const parsePriceNumber = (value?: string) => {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.,]/g, '').replace(/,/g, '')
  const numeric = Number.parseFloat(cleaned)
  return Number.isFinite(numeric) ? numeric : null
}

const scrapearProductosFalabella = (keywordOverride?: string) => {
  const nodeList = document.querySelectorAll('[data-testid=ssr-pod], a[data-pod="catalyst-pod"]')
  
  if (nodeList.length === 0) {
    console.warn('Falabella: No se encontraron productos con los selectores [data-testid=ssr-pod] o a[data-pod="catalyst-pod"]')
    return []
  }
  
  console.log(`Falabella: Encontrados ${nodeList.length} productos`)
  
  const keyword = keywordOverride || document.querySelector('h1')?.textContent?.trim() || 'falabella'
  const timestamp = Date.now()
  const datos = Array.from(nodeList)
  const productos = datos.map((producto: Element, index: number) => {
    const text = (producto as HTMLElement).innerText || ''
    const [marca, nombreArticulo, quienComercializa, precioArticulo, descuento] = text.split('\n')
    const url = (producto as HTMLElement).querySelector('a')?.getAttribute('href') || window.location.href
    const precioNumerico = parsePriceNumber(precioArticulo)
    return {
      site: 'falabella',
      keyword,
      timestamp,
      posicion: index + 1,
      titulo: nombreArticulo || marca || 'Sin titulo',
      precioVisible: precioArticulo || null,
      precioNumerico,
      url,
      marca: marca || null,
      vendedor: quienComercializa || null
    }
  })
  
  console.log(`Falabella: Procesados ${productos.length} productos`)
  return productos
}

const clickSiguientePaginaFalabella = (): boolean => {
  try {
    // Buscar el botón de siguiente página en Falabella
    const btnSiguiente = document.querySelector('button[aria-label="Página siguiente"]') as HTMLButtonElement
    if (btnSiguiente && !btnSiguiente.disabled) {
      btnSiguiente.click()
      return true
    }
    
    // Alternativa: buscar por el ícono de siguiente
    const linkSiguiente = document.querySelector('a[aria-label*="siguiente"], a[aria-label*="Siguiente"]') as HTMLAnchorElement
    if (linkSiguiente) {
      linkSiguiente.click()
      return true
    }
    
    return false
  } catch (err) {
    console.error('Error al hacer clic en siguiente página:', err)
    return false
  }
}

chrome.runtime.onConnect.addListener((port) => {
  console.log('Falabella: Puerto conectado')
  port.postMessage({ type: 'connection_established' })

  port.onMessage.addListener((message) => {
    console.log('Falabella: Mensaje recibido', message)

    if (message?.type === 'scrape') {
      try {
        const productos = scrapearProductosFalabella(typeof message.keyword === 'string' ? message.keyword : undefined)
        console.log('Falabella: Enviando respuesta con', productos.length, 'productos')
        port.postMessage({ type: 'scrape_result', result: productos })

        try {
          chrome.runtime.sendMessage({ type: 'scrapedData', data: productos }, () => {
          })
        } catch (err) {
          console.warn('Could not send scraped data to background', err)
        }
      } catch (err) {
        console.error('Falabella scrape error', err)
        port.postMessage({ type: 'scrape_result', error: String(err) })
      }
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
