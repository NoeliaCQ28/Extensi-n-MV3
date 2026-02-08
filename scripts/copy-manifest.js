const fs = require('fs')
const path = require('path')

const root = process.cwd()
const out = path.join(root, 'dist')
const manifestPath = path.join(root, 'manifest.json')

if (!fs.existsSync(manifestPath)) {
  console.error('manifest.json not found at project root')
  process.exit(1)
}

const userManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

// Default manifest values — these act as fallbacks and will NOT override user settings
const defaultManifest = {
  manifest_version: 3,
  name: 'Scraping de falabella',
  version: '1.0.0',
  description: 'Resumen de productos de falabella',
  permissions: ['scripting', 'activeTab'],
  host_permissions: ['<all_urls>'],
  action: {
    // Vite emits popup files under dist/src/popup/, so point default_popup there
    default_popup: 'src/popup/popup.html'
  },
  background: {
    service_worker: 'background.js'
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['content.js']
    }
  ]
}

function mergeDefaults(def, user) {
  // If user is not an object, prefer user
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    return user !== undefined ? user : def
  }

  const outObj = Array.isArray(def) ? [] : { ...def }

  // add keys from def that user did not provide
  for (const key of Object.keys(def || {})) {
    if (user[key] === undefined) {
      outObj[key] = def[key]
    }
  }

  // override/merge with user keys
  for (const key of Object.keys(user || {})) {
    const userVal = user[key]
    const defVal = def ? def[key] : undefined

    if (userVal === undefined) {
      // nothing
      continue
    }

    if (Array.isArray(userVal)) {
      // prefer user array entirely
      outObj[key] = userVal
    } else if (userVal && typeof userVal === 'object') {
      outObj[key] = mergeDefaults(defVal || {}, userVal)
    } else {
      outObj[key] = userVal
    }
  }

  return outObj
}

const finalManifest = mergeDefaults(defaultManifest, userManifest)

// Ensure output dir exists
if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true })

fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(finalManifest, null, 2))
console.log('Wrote dist/manifest.json (merged defaults + user manifest)')
