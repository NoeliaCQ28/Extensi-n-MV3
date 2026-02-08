let scrapeButtonElement = document.getElementById('scrapeButton');
let clearButtonElement = document.getElementById('clearButton');

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildFormHtml(products) {
    if (!products || products.length === 0) {
        return `<div class="p-4 bg-white rounded shadow text-gray-600">No se encontraron productos.</div>`;
    }

    return `
    <form id="productsForm" class="space-y-3">
      <div class="p-3 bg-white rounded shadow">
        <h2 class="text-lg font-medium text-gray-800">Productos encontrados</h2>
        <p class="text-sm text-gray-500">Selecciona los productos que deseas exportar o copiar.</p>
      </div>

      <div class="space-y-2 max-h-48 overflow-auto">
        ${products.map((p, i) => `
          <label class="flex items-start gap-3 p-3 bg-white rounded shadow-sm hover:bg-gray-50">
            <input type="checkbox" name="selected" value="${i}" class="mt-1 h-4 w-4 text-indigo-600 border-gray-300 rounded" />
            <div class="flex-1">
              <div class="font-semibold text-sm text-gray-800">${escapeHtml(p.nombreArticulo) || '—'}</div>
              <div class="text-xs text-gray-500">${escapeHtml(p.marca) || ''} • ${escapeHtml(p.precioArticulo) || ''}</div>
              ${p.descuento ? `<div class="text-xs text-green-600 font-medium">${escapeHtml(p.descuento)}</div>` : ''}
            </div>
          </label>`).join('')}
      </div>

      <div class="flex gap-2">
        <button type="button" id="exportBtn" class="flex-1 px-3 py-2 bg-indigo-600 text-white rounded">Exportar CSV</button>
        <button type="button" id="copyBtn" class="px-3 py-2 bg-gray-100 text-gray-700 rounded">Copiar JSON</button>
      </div>
    </form>
    `;
}

async function handleInjection() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        function: () => {
            console.log('Scraping Falabella products...');
            let datos = document.querySelectorAll("[data-testid=ssr-pod]")
            datos = [...datos]
            let productos = datos.map((producto) => {
                const [marca, nombreArticulo, quienComercializa, precioArticulo, descuento] = producto.innerText.split("\n")
                return { marca, nombreArticulo, quienComercializa, precioArticulo, descuento }
            })
            return productos;
        }
    }).then((injectionResults) => {
        for (const frameResult of injectionResults) {
            const products = frameResult.result || [];
            const resultEl = document.getElementById('result');
            resultEl.innerHTML = buildFormHtml(products);

            // Attach action handlers
            const exportBtn = document.getElementById('exportBtn');
            const copyBtn = document.getElementById('copyBtn');

            if (exportBtn) {
                exportBtn.addEventListener('click', () => {
                    const checked = Array.from(document.querySelectorAll('input[name=selected]:checked')).map(el => products[Number(el.value)]);
                    const rows = checked.length ? checked : products;
                    const csv = rows.map(r => [r.marca, r.nombreArticulo, r.quienComercializa, r.precioArticulo, r.descuento].map(v => '"' + String(v || '').replace(/"/g,'""') + '"').join(',')).join('\n');
                    const csvContent = 'Marca,Nombre,Comercializa,Precio,Descuento\n' + csv;
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'productos.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                });
            }

            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    const checked = Array.from(document.querySelectorAll('input[name=selected]:checked')).map(el => products[Number(el.value)]);
                    const toCopy = checked.length ? checked : products;
                    try {
                        await navigator.clipboard.writeText(JSON.stringify(toCopy, null, 2));
                        copyBtn.textContent = 'Copiado ✓';
                        setTimeout(() => copyBtn.textContent = 'Copiar JSON', 1500);
                    } catch (err) {
                        console.error('No se pudo copiar', err);
                    }
                });
            }
        }
    });
}

scrapeButtonElement.addEventListener('click', handleInjection);

clearButtonElement?.addEventListener('click', () => {
    const resultEl = document.getElementById('result');
    if (resultEl) resultEl.innerHTML = '';
});