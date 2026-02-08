// Content script for Falabella: scrape product items and respond to messages from the extension

console.log('Falabella content script injected')

const parsePriceNumber = (value?: string) => {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.,]/g, '').replace(/,/g, '')
  const numeric = Number.parseFloat(cleaned)
  return Number.isFinite(numeric) ? numeric : null
}

const scrapearProductosFalabella = () => {
  const nodeList = document.querySelectorAll('[data-testid=ssr-pod]')
  
  if (nodeList.length === 0) {
    console.warn('Falabella: No se encontraron productos con el selector [data-testid=ssr-pod]')
    return []
  }
  
  console.log(`Falabella: Encontrados ${nodeList.length} productos`)
  
  const keyword = document.querySelector('h1')?.textContent?.trim() || 'falabella'
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Falabella: Mensaje recibido', message)
  
  if (message?.type === 'scrape') {
    try {
      const productos = scrapearProductosFalabella()
      console.log('Falabella: Enviando respuesta con', productos.length, 'productos')

      // Reply to the popup (synchronous response)
      sendResponse({ result: productos })

      // Also forward the scraped data to the background service worker for forwarding to external API
      try {
        chrome.runtime.sendMessage({ type: 'scrapedData', data: productos }, (resp) => {
          // optional ack handling
          // console.log('Background ack:', resp)
        })
      } catch (err) {
        console.warn('Could not send scraped data to background', err)
      }
    } catch (err) {
      console.error('Falabella scrape error', err)
      sendResponse({ error: String(err) })
    }
    return true
  }

  if (message?.type === 'nextPage') {
    try {
      const success = clickSiguientePaginaFalabella()
      sendResponse({ success })
    } catch (err) {
      console.error('Error en nextPage:', err)
      sendResponse({ success: false, error: String(err) })
    }
    return true
  }
})
