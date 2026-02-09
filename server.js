const express = require('express')

const app = express()
const PORT = Number.parseInt(process.env.PORT || '3001', 10)

app.use(express.json({ limit: '5mb' }))

let lastPayload = null
let lastUpdated = null

app.get('/data', (_req, res) => {
  res.json({
    data: lastPayload,
    updatedAt: lastUpdated,
    success: true
  })
})

app.post('/data', (req, res) => {
  lastPayload = req.body
  lastUpdated = new Date().toISOString()
  res.json({
    success: true,
    items: Array.isArray(lastPayload) ? lastPayload.length : 0
  })
})

app.use((_req, res) => {
  res.status(404).json({
    data: null,
    message: 'La ruta solicitada no existe en esta API.',
    success: false,
    code: 404
  })
})

app.listen(PORT, () => {
  console.log(`API local escuchando en http://localhost:${PORT}`)
})
