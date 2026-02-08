console.log('Extension background service worker running')

// Example: listen to installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed')
})

// Listen for scraped data from content scripts and forward to external API
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'scrapedData') {
    const url = 'http://localhost:3000/data'
    const payload = message.data
    console.log('Background received scraped data from', sender?.tab?.id || 'unknown', 'items:', Array.isArray(payload) ? payload.length : 0)

    const body = JSON.stringify(payload)
    console.log('Initiating fetch to', url, '| Payload size:', body.length, 'bytes')
    
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    })
      .then(async (res) => {
        let text = null
        try { text = await res.text() } catch (e) { console.warn('Could not read response text:', e) }
        console.log('✓ Posted scraped data successfully | Status:', res.status, '| URL:', url)
        if (text) console.log('  Response body:', text.substring(0, 200))
        sendResponse({ ok: res.ok, status: res.status, body: text })
      })
      .catch((err) => {
        console.error('✗ Error posting scraped data to', url)
        console.error('  Error name:', err?.name)
        console.error('  Error message:', err?.message)
        console.error('  Error stack:', err?.stack)
        // Check if it's a network error
        if (err?.name === 'TypeError' && err?.message === 'Failed to fetch') {
          console.error('  → Network error: Check if server is running, CORS, or firewall blocking')
          console.error('  → URL being requested:', url)
        }
        sendResponse({ ok: false, error: String(err), message: err?.message, name: err?.name })
      })

    // Keep the message channel open for async response
    return true
  }
})
