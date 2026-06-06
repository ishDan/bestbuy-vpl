import { useState, useMemo, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts'
import { toBlob } from 'html-to-image'

const BB_BLUE = '#0046BE'

const CHART_COLORS = [
  '#e63946', '#2196f3', '#2a9d8f', '#f4a261', '#7209b7',
  '#ff9f1c', '#06d6a0', '#ef476f', '#3a86ff', '#fb8500',
  '#8338ec', '#52b788', '#e9c46a', '#457b9d', '#d62828',
]

// Days the user is off (no demand is logged): Tuesday(2) & Wednesday(3).
// Excluded from day-level charts so empty days off don't read as zero demand.
const OFF_DAYS = new Set([2, 3])
function isOffDay(ts) {
  return OFF_DAYS.has(new Date(ts).getDay())
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getWeekStart(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function formatLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getBucketKey(loggedAt, range) {
  const d = new Date(loggedAt)
  if (range === 'daily') return formatLocalDate(d)
  if (range === 'weekly') return formatLocalDate(getWeekStart(d))
  if (range === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return String(d.getFullYear())
}

function formatBucketLabel(bucketKey, range) {
  if (range === 'yearly') return bucketKey
  const d = new Date(bucketKey + (range === 'monthly' ? '-01T00:00:00' : 'T00:00:00'))
  if (range === 'daily') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (range === 'weekly') {
    const end = new Date(d)
    end.setDate(d.getDate() + 6)
    const startStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const endStr = d.getMonth() === end.getMonth()
      ? end.getDate()
      : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${startStr}–${endStr}`
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function filterLogsByRange(logs, range) {
  const cutoff = new Date()
  if (range === 'daily') cutoff.setDate(cutoff.getDate() - 30)
  else if (range === 'weekly') cutoff.setDate(cutoff.getDate() - 84)
  else if (range === 'monthly') cutoff.setMonth(cutoff.getMonth() - 12)
  else cutoff.setFullYear(cutoff.getFullYear() - 5)
  return logs.filter(l => new Date(l.logged_at) >= cutoff)
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function buildProductNameMap(variants) {
  const map = {}
  for (const v of variants) {
    const key = `${v.product.brand} ${v.product.model}`.toLowerCase()
    if (!map[key]) map[key] = v
  }
  return map
}

// Resolve a log to a variant whenever possible — even if it was originally
// logged as a custom_product, prefer a now-known matching variant.
function resolveVariant(log, variantMap, productByName) {
  if (log.variant_id) {
    const v = variantMap[log.variant_id]
    if (v) return v
  }
  if (log.custom_product) {
    return productByName[log.custom_product.toLowerCase()] ?? null
  }
  return null
}

function getGroupKey(log, variantMap, productByName, drilldown) {
  const v = resolveVariant(log, variantMap, productByName)
  if (!v) {
    if (drilldown === 'brand' && log.custom_product) {
      return log.custom_product.split(' ')[0]
    }
    return log.custom_product || 'Unknown'
  }
  if (drilldown === 'brand') return v.product.brand
  if (drilldown === 'product') return `${v.product.brand} ${v.product.model}`
  if (drilldown === 'variant') {
    const color = log.variant_id ? v.color : null
    return [v.product.brand, v.product.model, color].filter(Boolean).join(' · ')
  }
  const size = log.variant_id ? v.size : null
  return size || `${v.product.brand} ${v.product.model}`
}

function buildChartData(logs, variantMap, variants, range, drilldown) {
  const productByName = buildProductNameMap(variants)
  const filtered = filterLogsByRange(logs, range)
  const bucketMap = {}
  const groupKeys = new Set()

  for (const log of filtered) {
    if (range === 'daily' && isOffDay(log.logged_at)) continue
    const bk = getBucketKey(log.logged_at, range)
    const gk = getGroupKey(log, variantMap, productByName, drilldown)
    groupKeys.add(gk)
    if (!bucketMap[bk]) bucketMap[bk] = { date: formatBucketLabel(bk, range) }
    bucketMap[bk][gk] = (bucketMap[bk][gk] || 0) + 1
  }

  const data = Object.keys(bucketMap).sort().map(bk => bucketMap[bk])
  return { data, groups: [...groupKeys].sort() }
}

function getTopThisWeek(logs, variantMap, variants, n) {
  const productByName = buildProductNameMap(variants)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const counts = {}
  for (const log of logs) {
    if (new Date(log.logged_at) < cutoff) continue
    const v = resolveVariant(log, variantMap, productByName)
    if (v) {
      const key = `${v.product.brand}||${v.product.model}`
      if (!counts[key]) counts[key] = { count: 0, variant: v }
      counts[key].count++
    } else if (log.custom_product) {
      const key = `custom:${log.custom_product}`
      if (!counts[key]) counts[key] = { count: 0, customProduct: log.custom_product }
      counts[key].count++
    }
  }
  return Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

function getRecentlyLogged(logs, variantMap, variants, n) {
  const productByName = buildProductNameMap(variants)
  const seen = new Set()
  const result = []
  const sorted = [...logs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))
  for (const log of sorted) {
    const v = resolveVariant(log, variantMap, productByName)
    if (v) {
      const key = `${v.product.brand}||${v.product.model}||${log.variant_id ? (v.variant || '') : ''}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ variant: v, variant_id: v.id })
    } else if (log.custom_product) {
      const key = `custom:${log.custom_product}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ customProduct: log.custom_product })
    }
    if (result.length >= n) break
  }
  return result
}

function chipLabel(v) {
  const parts = [v.product.brand, v.product.model]
  if (v.color) parts.push(v.color)
  return parts.join(' · ')
}

// ─── TrackerLogSheet ──────────────────────────────────────────────────────────

function TrackerLogSheet({ variants, products, logs, onClose, onSubmit, onAddRestockItem, onAddVariant, preselect }) {
  const [mode, setMode] = useState(preselect?.mode ?? 'log')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState(preselect?.brand ?? '')
  const [model, setModel] = useState(preselect?.model ?? '')
  const [variantText, setVariantText] = useState(preselect?.variant ?? '')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)
  const [successLabel, setSuccessLabel] = useState('')
  const [customMode, setCustomMode] = useState(preselect?.customMode ?? false)
  const [customProduct, setCustomProduct] = useState(preselect?.customProduct ?? '')
  const [addingVariant, setAddingVariant] = useState(false)
  const [newColor, setNewColor] = useState('')
  const [newSize, setNewSize] = useState('')

  const variantMap = useMemo(() => Object.fromEntries(variants.map(v => [v.id, v])), [variants])

  // Include brands from variants AND from every product (any category) so that
  // products added without a category, or saved with a different category than
  // 'Wearables', still appear in the tracker dropdown. Brand match is
  // case-insensitive so different capitalisations group under one entry.
  const brands = useMemo(() => {
    const byLower = new Map()
    for (const v of variants) byLower.set(v.product.brand.toLowerCase(), v.product.brand)
    for (const p of products ?? []) {
      if (!p.brand) continue
      const key = p.brand.toLowerCase()
      if (!byLower.has(key)) byLower.set(key, p.brand)
    }
    return [...byLower.values()].sort()
  }, [variants, products])

  const models = useMemo(() => {
    if (!brand) return []
    const bLower = brand.toLowerCase()
    const s = new Set()
    for (const v of variants) {
      if (v.product.brand.toLowerCase() === bLower) s.add(v.product.model)
    }
    for (const p of products ?? []) {
      if (!p.brand || !p.model) continue
      if (p.brand.toLowerCase() === bLower) s.add(p.model)
    }
    return [...s].sort()
  }, [variants, products, brand])

  const variantTexts = useMemo(() => {
    if (!model) return []
    return [...new Set(
      variants.filter(v => v.product.brand === brand && v.product.model === model).map(v => v.variant).filter(Boolean)
    )].sort()
  }, [variants, brand, model])

  const colors = useMemo(() => {
    if (!model) return []
    return [...new Set(
      variants
        .filter(v =>
          v.product.brand === brand &&
          v.product.model === model &&
          (variantTexts.length === 0 || v.variant === variantText)
        )
        .map(v => v.color)
        .filter(Boolean)
    )].sort()
  }, [variants, brand, model, variantText, variantTexts])

  const sizes = useMemo(() => {
    if (!color) return []
    return [...new Set(
      variants
        .filter(v =>
          v.product.brand === brand &&
          v.product.model === model &&
          (variantTexts.length === 0 || v.variant === variantText) &&
          v.color === color
        )
        .map(v => v.size)
        .filter(Boolean)
    )].sort((a, b) => {
      const na = parseFloat(String(a).match(/[\d.]+/)?.[0] ?? '')
      const nb = parseFloat(String(b).match(/[\d.]+/)?.[0] ?? '')
      return (!isNaN(na) && !isNaN(nb)) ? na - nb : String(a).localeCompare(String(b))
    })
  }, [variants, brand, model, variantText, color, variantTexts])

  const needsSize = sizes.length > 0

  const matched = useMemo(() => {
    if (!color) return null
    if (needsSize && !size) return null
    return variants.find(v =>
      v.product.brand === brand &&
      v.product.model === model &&
      (variantTexts.length === 0 || v.variant === variantText) &&
      v.color === color &&
      (!needsSize || v.size === size)
    ) ?? null
  }, [variants, brand, model, variantText, color, size, needsSize, variantTexts])

  // Valid when model is selected but no color — allows submitting without a specific color
  const partialMatch = useMemo(() => {
    if (!model) return null
    if (variantTexts.length > 0 && !variantText) return null
    return { brand, model, variant: variantText }
  }, [brand, model, variantText, variantTexts])

  const productId = useMemo(() => {
    if (!brand || !model) return null
    const bL = brand.toLowerCase(), mL = model.toLowerCase()
    const fromVariant = variants.find(v =>
      v.product.brand.toLowerCase() === bL && v.product.model.toLowerCase() === mL
    )?.product_id
    if (fromVariant) return fromVariant
    return (products ?? []).find(p =>
      (p.brand || '').toLowerCase() === bL && (p.model || '').toLowerCase() === mL
    )?.id ?? null
  }, [variants, products, brand, model])

  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    const seen = new Set()
    return variants.filter(v => {
      const key = `${v.product.brand}|${v.product.model}|${v.variant}|${v.color}`
      if (seen.has(key)) return false
      seen.add(key)
      return (
        v.product.brand.toLowerCase().includes(q) ||
        v.product.model.toLowerCase().includes(q) ||
        (v.variant || '').toLowerCase().includes(q) ||
        (v.color || '').toLowerCase().includes(q)
      )
    }).slice(0, 8)
  }, [variants, search])

  const topThisWeek = useMemo(() => getTopThisWeek(logs, variantMap, variants, 5), [logs, variantMap, variants])
  const recentlyLogged = useMemo(() => getRecentlyLogged(logs, variantMap, variants, 5), [logs, variantMap, variants])

  function preselectVariant(v) {
    setSearch('')
    setBrand(v.product.brand)
    setModel(v.product.model)
    setVariantText(v.variant || '')
    setColor(v.color || '')
    setSize('')
    setCustomMode(false)
  }

  function preselectCustom(productName) {
    setCustomMode(true)
    setCustomProduct(productName)
    reset()
  }

  function reset() {
    setBrand(''); setModel(''); setVariantText(''); setColor(''); setSize(''); setNotes(''); setSearch('')
    setAddingVariant(false); setNewColor(''); setNewSize('')
  }

  async function handleSubmit() {
    if (customMode ? !customProduct.trim() : addingVariant ? (!newColor.trim() || !productId) : (!matched && !partialMatch)) return
    setSubmitting(true)
    setSubmitError('')
    try {
      let variantId = null
      let customStr = null
      let label = ''
      if (customMode) {
        customStr = customProduct.trim()
        label = customStr
      } else if (addingVariant && newColor.trim() && productId) {
        const inserted = await onAddVariant({ productId, color: newColor.trim(), variantText: variantText || null, size: newSize.trim() || null })
        variantId = inserted.id
        label = [brand, model, newColor.trim(), newSize.trim()].filter(Boolean).join(' · ')
      } else if (matched) {
        variantId = matched.id
        label = [matched.product.brand, matched.product.model, matched.color, matched.size].filter(Boolean).join(' · ')
      } else {
        customStr = [partialMatch.brand, partialMatch.model, partialMatch.variant].filter(Boolean).join(' ')
        label = customStr
      }
      if (mode === 'restock') {
        await onAddRestockItem(variantId, notes.trim() || null, customStr)
      } else {
        await onSubmit(variantId, notes.trim() || null, customStr)
      }
      setSuccessLabel(label)
      setSuccess(true)
      setTimeout(onClose, 1400)
    } catch (err) {
      console.error(err)
      setSubmitError(err?.message || String(err))
      setSubmitting(false)
    }
  }

  const sel = `border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none w-full rounded-xl`

  if (success) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center">
        <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl px-6 py-10 flex flex-col items-center gap-3">
          <span className="text-5xl" style={{ color: BB_BLUE }}>✓</span>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{mode === 'restock' ? 'Added to Restock' : 'Logged'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{successLabel}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl flex flex-col max-h-[88dvh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-center px-5 pt-5 pb-3 shrink-0">
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            <button
              onClick={() => setMode('log')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${mode === 'log' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}
            >
              Log Demand
            </button>
            <button
              onClick={() => setMode('restock')}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${mode === 'restock' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}
            >
              Restock
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-8 flex flex-col gap-4">

          {/* Search */}
          {!customMode && <div className="relative">
            <input
              type="text"
              placeholder="Search product, brand, color…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">×</button>
            )}
          </div>}

          {/* Search results */}
          {!customMode && search && searchResults.length > 0 && (
            <div className="flex flex-col gap-1 -mt-2">
              {searchResults.map(v => (
                <button
                  key={v.id}
                  onClick={() => preselectVariant(v)}
                  className="text-left px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
                >
                  <span className="font-medium">{v.product.brand} {v.product.model}</span>
                  {v.variant && <span className="text-gray-500"> · {v.variant}</span>}
                  {v.color && <span className="text-gray-500"> · {v.color}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Quick shortcuts */}
          {!customMode && !search && (
            <>
              {topThisWeek.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Most requested this week</p>
                  <div className="flex flex-wrap gap-2">
                    {topThisWeek.map(({ variant: v, count, customProduct: cp }) => (
                      <button
                        key={cp || v.id}
                        onClick={() => cp ? preselectCustom(cp) : preselectVariant(v)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                      >
                        {cp || chipLabel(v)}
                        <span className="ml-1 text-gray-400">×{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {recentlyLogged.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Recently logged</p>
                  <div className="flex flex-wrap gap-2">
                    {recentlyLogged.map(({ variant: v, variant_id, customProduct: cp }) => (
                      <button
                        key={cp || variant_id}
                        onClick={() => cp ? preselectCustom(cp) : preselectVariant(v)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                      >
                        {cp || chipLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Custom product toggle */}
          <button
            onClick={() => { setCustomMode(m => !m); setCustomProduct(''); reset() }}
            className="w-full rounded-xl py-3 text-sm font-semibold border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400"
          >
            {customMode ? '← Back to product list' : '+ Product not in the list?'}
          </button>

          {/* Custom product input */}
          {customMode && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Product name</label>
              <input
                type="text"
                value={customProduct}
                onChange={e => setCustomProduct(e.target.value)}
                placeholder="e.g. Garmin Fenix 9, Whoop 5.0 Pro…"
                autoFocus
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
              />
              <p className="text-xs text-gray-400 mt-1.5">This will be tracked as a new demand signal.</p>
            </div>
          )}

          {/* Cascading dropdowns */}
          {!customMode && <div className="flex flex-col gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Brand</label>
              <select value={brand} onChange={e => { setBrand(e.target.value); setModel(''); setVariantText(''); setColor(''); setSize('') }} className={sel}>
                <option value="">Select brand…</option>
                {brands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {brand && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Model</label>
                <select value={model} onChange={e => { setModel(e.target.value); setVariantText(''); setColor(''); setSize('') }} className={sel}>
                  <option value="">Select model…</option>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}

            {model && variantTexts.length > 0 && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Variant</label>
                <select value={variantText} onChange={e => { setVariantText(e.target.value); setColor(''); setSize('') }} className={sel}>
                  <option value="">Select variant…</option>
                  {variantTexts.map(vt => <option key={vt} value={vt}>{vt}</option>)}
                </select>
              </div>
            )}

            {model && (variantTexts.length === 0 || variantText) && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Color <span className="normal-case font-normal">(optional)</span></label>
                {!addingVariant && (
                  <>
                    {colors.length > 0 && (
                      <select value={color} onChange={e => { setColor(e.target.value); setSize('') }} className={sel}>
                        <option value="">Select color…</option>
                        {colors.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => { setAddingVariant(true); setColor(''); setSize('') }}
                      className="mt-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      + Color not listed? Add it
                    </button>
                  </>
                )}
                {addingVariant && (
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={newColor}
                      onChange={e => setNewColor(e.target.value)}
                      placeholder="Color (e.g. Black, Rose Gold…)"
                      autoFocus
                      className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newSize}
                      onChange={e => setNewSize(e.target.value)}
                      placeholder="Size (optional, e.g. 42mm)"
                      className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => { setAddingVariant(false); setNewColor(''); setNewSize('') }}
                      className="text-xs text-gray-400 self-start"
                    >
                      ← Back to color list
                    </button>
                  </div>
                )}
              </div>
            )}

            {!addingVariant && needsSize && color && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Size</label>
                <select value={size} onChange={e => setSize(e.target.value)} className={sel}>
                  <option value="">Select size…</option>
                  {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>}

          {/* Selected product summary */}
          {!customMode && (addingVariant ? (newColor.trim() && productId) : (matched || partialMatch)) && (
            <div className="rounded-xl border-2 p-3 flex items-start justify-between gap-3" style={{ borderColor: BB_BLUE }}>
              <div>
                <p className="text-xs font-bold text-gray-900 dark:text-white">
                  {addingVariant
                    ? `${brand} ${model}${variantText ? ` · ${variantText}` : ''}`
                    : matched
                      ? `${matched.product.brand} ${matched.product.model}${matched.variant ? ` · ${matched.variant}` : ''}`
                      : `${partialMatch.brand} ${partialMatch.model}${partialMatch.variant ? ` · ${partialMatch.variant}` : ''}`}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {addingVariant
                    ? [newColor.trim(), newSize.trim()].filter(Boolean).join(' · ') + ' (new variant)'
                    : matched
                      ? [matched.color, matched.size].filter(Boolean).join(' · ')
                      : 'Any color'}
                </p>
              </div>
              <button onClick={reset} className="text-xs text-gray-400 shrink-0">Reset</button>
            </div>
          )}

          {/* Notes */}
          {(matched || partialMatch || customMode || (addingVariant && newColor.trim())) && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. customer wanted rose gold specifically"
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
              />
            </div>
          )}

          {submitError && (
            <p className="text-xs text-red-500 -mb-1">{submitError}</p>
          )}

          {/* Submit */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl py-4 text-sm font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || (customMode ? !customProduct.trim() : addingVariant ? (!newColor.trim() || !productId) : (!matched && !partialMatch))}
              className="flex-1 rounded-xl py-4 text-sm font-bold text-white transition-opacity disabled:opacity-40"
              style={{ background: BB_BLUE }}
            >
              {submitting
                ? (mode === 'restock' ? 'Adding…' : 'Logging…')
                : (mode === 'restock' ? 'Add to Restock' : 'Log Demand')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── DemandGraph ──────────────────────────────────────────────────────────────

function CompactTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  // Recharts stacks emit zero-valued entries for every series; filter to actual hits.
  const items = payload.filter(p => p.value > 0)
  if (!items.length) return null
  return (
    <div
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg text-xs"
      style={{ width: 200, maxWidth: 200 }}
    >
      <div className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-700 font-bold text-gray-900 dark:text-white">
        {label}
      </div>
      <div
        className="px-2.5 py-1.5"
        style={{
          maxHeight: 140,
          overflowX: 'auto',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x pan-y',
        }}
      >
        <div className="flex flex-col gap-1" style={{ width: 'max-content', minWidth: '100%' }}>
          {items.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: entry.color }} />
              <span className="text-gray-700 dark:text-gray-300 flex-1 pr-3">{entry.name}</span>
              <span className="font-semibold text-gray-900 dark:text-white shrink-0">{entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function DemandGraph({ logs, variantMap, variants }) {
  const [range, setRange] = useState('daily')
  const [drilldown, setDrilldown] = useState('brand')
  const [focusGroup, setFocusGroup] = useState(null)

  const { data, groups } = useMemo(
    () => buildChartData(logs, variantMap, variants, range, drilldown),
    [logs, variantMap, variants, range, drilldown]
  )

  const displayGroups = focusGroup ? groups.filter(g => g === focusGroup) : groups

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-sm">No demand data yet.</p>
        <p className="text-xs mt-1">Log some demand to see trends here.</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-2 pb-4">
      {/* Controls */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {[['daily', 'Day'], ['weekly', 'Wk'], ['monthly', 'Mo'], ['yearly', 'Yr']].map(([r, label]) => (
            <button
              key={r}
              onClick={() => { setRange(r); setFocusGroup(null) }}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${range === r ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          {[['brand', 'Brand'], ['product', 'Product'], ['variant', 'Color'], ['size', 'Size']].map(([d, label]) => (
            <button
              key={d}
              onClick={() => { setDrilldown(d); setFocusGroup(null) }}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${drilldown === d ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {focusGroup && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-600 dark:text-gray-300">Showing: <strong>{focusGroup}</strong></span>
          <button onClick={() => setFocusGroup(null)} className="text-xs underline text-gray-400">Show all</button>
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            content={<CompactTooltip />}
            wrapperStyle={{ pointerEvents: 'auto' }}
            isAnimationActive={false}
          />
          {displayGroups.map((g, i) => {
            const color = CHART_COLORS[groups.indexOf(g) % CHART_COLORS.length]
            return (
              <Area
                key={g}
                type="monotone"
                dataKey={g}
                stackId="1"
                stroke={color}
                fill={color}
                fillOpacity={0.65}
                strokeWidth={1.5}
                dot={{ r: 3, fill: color, stroke: color }}
                activeDot={{ r: 5, fill: color, stroke: '#fff', strokeWidth: 2 }}
                onClick={() => setFocusGroup(focusGroup === g ? null : g)}
                style={{ cursor: 'pointer' }}
              />
            )
          })}
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 max-h-20 overflow-y-auto">
        {groups.map((g, i) => (
          <button
            key={g}
            onClick={() => setFocusGroup(focusGroup === g ? null : g)}
            className={`flex items-center gap-1.5 text-xs transition-opacity ${focusGroup && focusGroup !== g ? 'opacity-30' : ''}`}
          >
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="text-gray-700 dark:text-gray-300">{g}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── TrackerView ──────────────────────────────────────────────────────────────

const DELETE_PIN = (import.meta.env.VITE_API_PIN ?? '').trim()

function RecentLogs({ logs, variantMap, variants, onDelete }) {
  const productByName = useMemo(() => buildProductNameMap(variants), [variants])
  const [confirmId, setConfirmId] = useState(null)
  const [pinEntry, setPinEntry] = useState('')
  const [pinError, setPinError] = useState(false)

  const recent = useMemo(() => {
    const now = new Date()
    return logs.filter(log => {
      const d = new Date(log.logged_at)
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      )
    })
  }, [logs])

  function logLabel(log) {
    const v = resolveVariant(log, variantMap, productByName)
    if (v) {
      const color = log.variant_id ? v.color : null
      const size = log.variant_id ? v.size : null
      return [v.product.brand, v.product.model, color, size].filter(Boolean).join(' · ')
    }
    return log.custom_product || 'Unknown'
  }

  function formatTime(ts) {
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now - d
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHr / 24)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    return `${diffDay}d ago`
  }

  function startConfirm(id) {
    setConfirmId(id)
    setPinEntry('')
    setPinError(false)
  }

  function cancelConfirm() {
    setConfirmId(null)
    setPinEntry('')
    setPinError(false)
  }

  function handleDelete(logId) {
    if (!DELETE_PIN || pinEntry.trim() !== DELETE_PIN) {
      setPinError(true)
      setPinEntry('')
      return
    }
    onDelete(logId)
    cancelConfirm()
  }

  return (
    <div className="px-4 pb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Today's Logs</h2>
        <span className="text-xs text-gray-400">{recent.length} entr{recent.length === 1 ? 'y' : 'ies'}</span>
      </div>
      {recent.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">No logs yet today.</p>
      ) : (
      <div className="flex flex-col gap-2">
        {recent.map(log => (
          <div key={log.id} className="rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{logLabel(log)}</p>
                {log.notes && <p className="text-[10px] text-gray-400 truncate mt-0.5">{log.notes}</p>}
                <p className="text-[10px] text-gray-400 mt-0.5">{formatTime(log.logged_at)}</p>
              </div>
              {confirmId === log.id ? (
                <button onClick={cancelConfirm} className="text-xs text-gray-400 shrink-0 px-2 py-1">Cancel</button>
              ) : (
                <button onClick={() => startConfirm(log.id)} className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm shrink-0">✕</button>
              )}
            </div>
            {confirmId === log.id && (
              <div className="px-3 pb-3 flex gap-2 items-center border-t border-gray-100 dark:border-gray-800 pt-2.5">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoFocus
                  placeholder="Enter PIN to delete"
                  value={pinEntry}
                  onChange={e => { setPinEntry(e.target.value); setPinError(false) }}
                  onKeyDown={e => e.key === 'Enter' && handleDelete(log.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 dark:text-white border outline-none ${pinError ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}`}
                />
                <button
                  onClick={() => handleDelete(log.id)}
                  className="text-xs font-semibold text-white px-3 py-2 rounded-lg bg-red-500 shrink-0"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  )
}

// ─── RestockList ─────────────────────────────────────────────────────────────

function RestockList({ items, variantMap, variants, onDelete, onAdd }) {
  const productByName = useMemo(() => buildProductNameMap(variants), [variants])

  function itemLabel(item) {
    const fakeLog = { variant_id: item.variant_id, custom_product: item.custom_product }
    const v = resolveVariant(fakeLog, variantMap, productByName)
    if (v) {
      const color = item.variant_id ? v.color : null
      const size = item.variant_id ? v.size : null
      return [v.product.brand, v.product.model, color, size].filter(Boolean).join(' · ')
    }
    return item.custom_product || 'Unknown'
  }

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Restock List</h2>
        <button
          onClick={onAdd}
          className="text-xs font-semibold px-3 py-1 rounded-full text-white"
          style={{ background: BB_BLUE }}
        >
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">
          No items queued. Tap + Add (or use the floating + and switch to Restock).
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1 -mr-1">
          {items.map(item => (
            <div
              key={item.id}
              className="rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-3 py-2.5 flex items-center justify-between gap-3 shrink-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{itemLabel(item)}</p>
                {item.notes && <p className="text-[10px] text-gray-400 truncate mt-0.5">{item.notes}</p>}
              </div>
              <button
                onClick={() => onDelete(item.id)}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm shrink-0"
                title="Remove from restock list"
                aria-label="Remove from restock list"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── UnknownProducts ─────────────────────────────────────────────────────────

function UnknownProducts({ products, apiAllowed, onSetupVariants }) {
  const [states, setStates] = useState({})

  async function handleSetup(name) {
    setStates(s => ({ ...s, [name]: 'loading' }))
    try {
      await onSetupVariants(name)
    } catch (err) {
      setStates(s => ({ ...s, [name]: err.message || 'Error' }))
    }
  }

  return (
    <div className="px-4 pb-4">
      <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1">Unrecognized Products</h2>
      <p className="text-xs text-gray-400 mb-3">
        {apiAllowed
          ? 'Tap "Set up" to fetch variants via API.'
          : 'Enable API in ⚙ settings to set up variants.'}
      </p>
      <div className="flex flex-col gap-2">
        {products.map(name => {
          const state = states[name]
          return (
            <div
              key={name}
              className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-3 py-2.5"
            >
              <p className="text-xs font-medium text-gray-900 dark:text-white flex-1 min-w-0 truncate">{name}</p>
              {state === 'loading' ? (
                <span className="text-xs text-gray-400 animate-pulse shrink-0">Fetching…</span>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  {state && state !== 'loading' && (
                    <span className="text-[10px] text-red-500 max-w-[120px] truncate" title={state}>{state}</span>
                  )}
                  <button
                    onClick={() => handleSetup(name)}
                    disabled={!apiAllowed || state === 'loading'}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity ${!apiAllowed ? 'opacity-40 cursor-not-allowed' : 'active:opacity-80'}`}
                    style={{ background: BB_BLUE }}
                    title={!apiAllowed ? 'Enable API in settings first' : 'Fetch variants via API'}
                  >
                    Set up
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ReportSheet ─────────────────────────────────────────────────────────────

const REPORT_PERIODS = [
  { label: 'This Week', days: 7 },
  { label: 'Last 2 Weeks', days: 14 },
  { label: 'This Month', days: 30 },
  { label: 'Last 3 Months', days: 90 },
  { label: 'All Time', days: null },
]

// ── Chart aggregations for the report (days falsy = all time) ──
function filterLogsSinceDays(logs, days) {
  if (!days) return logs
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  cutoff.setHours(0, 0, 0, 0)
  return logs.filter(l => new Date(l.logged_at) >= cutoff)
}

function logBrandOf(log, v) {
  if (v) return v.product.brand
  if (log.custom_product) return log.custom_product.split(' ')[0]
  return 'Unknown'
}

function logProductOf(log, v) {
  if (v) return `${v.product.brand} ${v.product.model}`
  return log.custom_product || 'Unknown'
}

function reportDailyData(logs, days) {
  const map = {}
  for (const log of filterLogsSinceDays(logs, days)) {
    if (isOffDay(log.logged_at)) continue
    const bk = formatLocalDate(new Date(log.logged_at))
    map[bk] = (map[bk] || 0) + 1
  }
  return Object.keys(map).sort().map(bk => ({
    date: new Date(bk + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    count: map[bk],
  }))
}

function reportBrandShare(logs, variantMap, variants, days) {
  const productByName = buildProductNameMap(variants)
  const counts = {}
  for (const log of filterLogsSinceDays(logs, days)) {
    const v = resolveVariant(log, variantMap, productByName)
    const brand = logBrandOf(log, v)
    counts[brand] = (counts[brand] || 0) + 1
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return Object.entries(counts)
    .map(([name, value]) => ({ name, value, pct: total ? Math.round((value / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value)
}

function reportTopProducts(logs, variantMap, variants, days, n) {
  const productByName = buildProductNameMap(variants)
  const counts = {}
  for (const log of filterLogsSinceDays(logs, days)) {
    const v = resolveVariant(log, variantMap, productByName)
    const name = logProductOf(log, v)
    counts[name] = (counts[name] || 0) + 1
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count).slice(0, n)
}

function reportRestockPriority(restockItems, logs, variantMap, variants, days, n) {
  const productByName = buildProductNameMap(variants)
  const demand = {}
  for (const log of filterLogsSinceDays(logs, days)) {
    const v = resolveVariant(log, variantMap, productByName)
    demand[logProductOf(log, v)] = (demand[logProductOf(log, v)] || 0) + 1
  }
  const names = new Set()
  for (const item of restockItems) {
    const v = resolveVariant({ variant_id: item.variant_id, custom_product: item.custom_product }, variantMap, productByName)
    names.add(v ? `${v.product.brand} ${v.product.model}` : (item.custom_product || 'Unknown'))
  }
  return [...names].map(name => ({ name, count: demand[name] || 0 }))
    .sort((a, b) => b.count - a.count).slice(0, n)
}

function ReportBlock({ title, children }) {
  return (
    <div>
      <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 6 }}>{title}</h3>
      {children}
    </div>
  )
}

function ReportLegend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
      {items.map(it => (
        <span key={it.name} className="flex items-center gap-1.5" style={{ fontSize: 11, color: '#374151' }}>
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
          {it.name}{it.detail ? ` ${it.detail}` : ''}
        </span>
      ))}
    </div>
  )
}

const REPORT_CHART_OPTS = [
  ['daily', 'Demand by Day'],
  ['brandShare', 'Brand Share'],
  ['topProducts', 'Top Products'],
  ['restock', 'Restock Priority'],
]

function ReportSheet({ logs, variants, restockItems, onClose, savedReports = [], onSaveReport, onDeleteSavedReport }) {
  const variantMap = useMemo(() => Object.fromEntries(variants.map(v => [v.id, v])), [variants])
  const [period, setPeriod] = useState(REPORT_PERIODS[0])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [genError, setGenError] = useState('')
  const [copied, setCopied] = useState(false)
  const [chartCopied, setChartCopied] = useState(false)
  const chartRef = useRef(null)
  const [selectedCharts, setSelectedCharts] = useState({ daily: true, brandShare: true, topProducts: true, restock: true })
  const [chartsCopied, setChartsCopied] = useState(false)
  const chartsRef = useRef(null)
  const [savedIndicator, setSavedIndicator] = useState(false)

  const reportDays = period.days ?? 0
  const dailyData = useMemo(() => reportDailyData(logs, reportDays), [logs, reportDays])
  const brandShareData = useMemo(() => reportBrandShare(logs, variantMap, variants, reportDays), [logs, variantMap, variants, reportDays])
  const topProductsData = useMemo(() => reportTopProducts(logs, variantMap, variants, reportDays, 8), [logs, variantMap, variants, reportDays])
  const restockData = useMemo(() => reportRestockPriority(restockItems ?? [], logs, variantMap, variants, reportDays, 8), [restockItems, logs, variantMap, variants, reportDays])

  async function copyCharts() {
    if (!chartsRef.current) return
    try {
      const blob = await toBlob(chartsRef.current, { backgroundColor: '#ffffff', pixelRatio: 2 })
      if (!blob) throw new Error('render failed')
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setChartsCopied(true)
      setTimeout(() => setChartsCopied(false), 2000)
    } catch (err) {
      console.error('charts copy failed:', err)
    }
  }

  const chartData = useMemo(() => {
    if (!email) return null
    const days = period.days
    const cutoff = days != null ? new Date(Date.now() - days * 86400000) : null
    const filtered = cutoff ? logs.filter(l => new Date(l.logged_at) >= cutoff) : logs
    const range = days == null ? 'monthly' : days <= 30 ? 'daily' : 'weekly'
    const bucketMap = {}
    const brandSet = new Set()
    for (const log of filtered) {
      if (!log.variant_id) continue
      if (range === 'daily' && isOffDay(log.logged_at)) continue
      const v = variantMap[log.variant_id]
      if (!v?.product) continue
      const bk = getBucketKey(log.logged_at, range)
      const brand = v.product.brand
      brandSet.add(brand)
      if (!bucketMap[bk]) bucketMap[bk] = { date: formatBucketLabel(bk, range) }
      bucketMap[bk][brand] = (bucketMap[bk][brand] || 0) + 1
    }
    const data = Object.keys(bucketMap).sort().map(bk => bucketMap[bk])
    const brands = [...brandSet].sort()
    return data.length > 0 ? { data, brands } : null
  }, [email, period, logs, variantMap])

  async function copyChart() {
    const container = chartRef.current
    if (!container) return
    const svgEl = container.querySelector('svg')
    if (!svgEl) return

    const scale = 2
    const svgW = svgEl.clientWidth || 500
    const svgH = svgEl.clientHeight || 200
    const brands = chartData?.brands ?? []
    const legendH = brands.length > 0 ? 28 : 0
    const pad = 16

    const clone = svgEl.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', svgW)
    clone.setAttribute('height', svgH)
    const svgStr = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    return new Promise(resolve => {
      const img = new Image()
      img.onload = async () => {
        const cW = svgW + pad * 2
        const cH = svgH + pad * 2 + legendH
        const canvas = document.createElement('canvas')
        canvas.width = cW * scale
        canvas.height = cH * scale
        const ctx = canvas.getContext('2d')
        ctx.scale(scale, scale)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, cW, cH)
        ctx.drawImage(img, pad, pad, svgW, svgH)
        URL.revokeObjectURL(url)

        if (brands.length > 0) {
          let lx = pad + 8
          const ly = svgH + pad + 16
          ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          ctx.textBaseline = 'middle'
          for (let i = 0; i < brands.length; i++) {
            const color = CHART_COLORS[i % CHART_COLORS.length]
            ctx.fillStyle = color
            ctx.fillRect(lx, ly - 5, 10, 10)
            ctx.fillStyle = '#374151'
            ctx.fillText(brands[i], lx + 14, ly)
            lx += ctx.measureText(brands[i]).width + 28
          }
        }

        canvas.toBlob(async pngBlob => {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
            setChartCopied(true)
            setTimeout(() => setChartCopied(false), 2000)
          } catch (err) {
            console.error('Chart copy failed:', err)
          }
          resolve()
        }, 'image/png')
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve() }
      img.src = url
    })
  }

  function computeReportData(days) {
    const cutoff = days != null ? new Date(Date.now() - days * 86400000) : null
    const filtered = days != null ? logs.filter(l => new Date(l.logged_at) >= cutoff) : logs
    const groups = {}

    for (const log of filtered) {
      if (!log.variant_id) continue
      const v = variantMap[log.variant_id]
      if (!v?.product || v.product.category !== 'Wearables') continue

      const key = [v.product.brand, v.product.model, v.variant || '', v.color || '', v.size || ''].join('|')
      if (!groups[key]) {
        groups[key] = {
          brand: v.product.brand,
          product_name: v.product.model,
          variant: v.variant || null,
          color: v.color || null,
          size: v.size || null,
          demand_count: 0,
          first_ts: log.logged_at,
          last_ts: log.logged_at,
          notes_seen: new Set(),
        }
      }
      const g = groups[key]
      g.demand_count++
      if (new Date(log.logged_at) < new Date(g.first_ts)) g.first_ts = log.logged_at
      if (new Date(log.logged_at) > new Date(g.last_ts)) g.last_ts = log.logged_at
      if (log.notes?.trim()) g.notes_seen.add(log.notes.trim())
    }

    const fmtDate = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const minTs = filtered.reduce((min, l) => {
      const t = new Date(l.logged_at).getTime()
      return t < min ? t : min
    }, Infinity)

    return {
      demandData: Object.values(groups)
        .map(g => ({
          brand: g.brand,
          product_name: g.product_name,
          variant: g.variant,
          color: g.color,
          size: g.size,
          demand_count: g.demand_count,
          first_requested: fmtDate(new Date(g.first_ts)),
          last_requested: fmtDate(new Date(g.last_ts)),
          notes: g.notes_seen.size ? [...g.notes_seen].join(' | ') : null,
        }))
        .sort((a, b) => b.demand_count - a.demand_count),
      totalLogs: filtered.length,
      periodStart: minTs === Infinity ? (cutoff ? fmtDate(cutoff) : 'Start of data') : fmtDate(new Date(minTs)),
      periodEnd: fmtDate(new Date()),
    }
  }

  async function generate() {
    setLoading(true)
    setGenError('')
    try {
      const { demandData, totalLogs, periodStart, periodEnd } = computeReportData(period.days)
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timePeriodLabel: period.label, periodStart, periodEnd, totalLogs, demandData }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`)
      setEmail(payload.email)
      setSavedIndicator(true)
      setTimeout(() => setSavedIndicator(false), 2500)
      onSaveReport?.(period.label, periodStart, periodEnd, payload.email)
        .catch(err => console.error('Save report failed:', err))
    } catch (err) {
      setGenError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function loadSavedReport(report) {
    const matched = REPORT_PERIODS.find(p => p.label === report.period_label)
    if (matched) setPeriod(matched)
    setEmail(report.email_content)
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl flex flex-col max-h-[88dvh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Generate Report</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none w-8 h-8 flex items-center justify-center">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">
          {!email && (
            <>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Time Period</p>
                <div className="grid grid-cols-2 gap-2">
                  {REPORT_PERIODS.slice(0, 4).map(p => (
                    <button
                      key={p.label}
                      onClick={() => setPeriod(p)}
                      className={`py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                        period.label === p.label
                          ? 'text-white border-transparent'
                          : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900'
                      }`}
                      style={period.label === p.label ? { background: BB_BLUE, borderColor: BB_BLUE } : {}}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setPeriod(REPORT_PERIODS[4])}
                  className={`mt-2 w-full py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    period.label === 'All Time'
                      ? 'text-white border-transparent'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900'
                  }`}
                  style={period.label === 'All Time' ? { background: BB_BLUE, borderColor: BB_BLUE } : {}}
                >
                  All Time — Use All Available Data
                </button>
              </div>

              {savedReports.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Saved Reports</p>
                  <div className="flex flex-col gap-2">
                    {savedReports.map(r => (
                      <div key={r.id} className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2.5 bg-white dark:bg-gray-900">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-900 dark:text-white">{r.period_label}</p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {r.period_start} to {r.period_end} · {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                        <button
                          onClick={() => loadSavedReport(r)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-full text-white shrink-0"
                          style={{ background: BB_BLUE }}
                        >
                          Load
                        </button>
                        <button
                          onClick={() => onDeleteSavedReport?.(r.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 text-sm shrink-0"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {genError && <p className="text-xs text-red-500">{genError}</p>}

              <button
                onClick={generate}
                disabled={loading}
                className="w-full rounded-xl py-4 text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: BB_BLUE }}
              >
                {loading && (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {loading ? 'Generating…' : 'Generate Report'}
              </button>
            </>
          )}

          {email && !loading && (
            <>
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Report Preview</p>
                  {savedIndicator && <span className="text-[10px] font-semibold text-green-500">Saved ✓</span>}
                </div>
                <button
                  onClick={() => { setEmail(''); setGenError('') }}
                  className="text-xs text-gray-400 underline"
                >
                  ← Change period
                </button>
              </div>

              <div
                className="rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 overflow-y-auto flex-1"
                style={{ minHeight: 320, maxHeight: 480 }}
              >
                <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">{email}</pre>
              </div>

              {genError && <p className="text-xs text-red-500 shrink-0">{genError}</p>}

              {/* Demand chart for email */}
              {chartData && (
                <div className="shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Demand Chart</p>
                    <button
                      onClick={copyChart}
                      className="text-xs font-semibold px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                    >
                      {chartCopied ? 'Copied!' : 'Copy Chart'}
                    </button>
                  </div>
                  <div
                    ref={chartRef}
                    style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '12px 4px 4px' }}
                  >
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={chartData.data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        {chartData.brands.map((brand, i) => {
                          const color = CHART_COLORS[i % CHART_COLORS.length]
                          return (
                            <Area
                              key={brand}
                              type="monotone"
                              dataKey={brand}
                              stackId="1"
                              stroke={color}
                              fill={color}
                              fillOpacity={0.75}
                              strokeWidth={2}
                              dot={{ r: 3, fill: color, stroke: color }}
                              activeDot={{ r: 5, fill: color, stroke: '#fff', strokeWidth: 2 }}
                            />
                          )
                        })}
                      </AreaChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 mt-1">
                      {chartData.brands.map((brand, i) => (
                        <div key={brand} className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                          <span style={{ fontSize: 11, color: '#374151' }}>{brand}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Selectable charts */}
              <div className="shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Charts</p>
                  <button
                    onClick={copyCharts}
                    className="text-xs font-semibold px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                  >
                    {chartsCopied ? 'Copied!' : 'Copy Charts'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {REPORT_CHART_OPTS.map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setSelectedCharts(s => ({ ...s, [k]: !s[k] }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${selectedCharts[k] ? 'text-white border-transparent' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
                      style={selectedCharts[k] ? { background: BB_BLUE } : {}}
                    >
                      {selectedCharts[k] ? '✓ ' : ''}{label}
                    </button>
                  ))}
                </div>
                <div
                  ref={chartsRef}
                  style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}
                >
                  {selectedCharts.daily && dailyData.length > 0 && (
                    <ReportBlock title="Demand by Day">
                      <ResponsiveContainer width="100%" height={170}>
                        <BarChart data={dailyData} margin={{ top: 14, right: 8, left: -18, bottom: 0 }}>
                          <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 9, fill: '#6b7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                          <Bar dataKey="count" fill={BB_BLUE} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                            <LabelList dataKey="count" position="top" fontSize={9} fill="#374151" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ReportBlock>
                  )}
                  {selectedCharts.brandShare && brandShareData.length > 0 && (
                    <ReportBlock title="Brand Share">
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={brandShareData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} isAnimationActive={false}>
                            {brandShareData.map((e, i) => <Cell key={e.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <ReportLegend items={brandShareData.map((b, i) => ({ name: b.name, color: CHART_COLORS[i % CHART_COLORS.length], detail: `${b.pct}% (${b.value})` }))} />
                    </ReportBlock>
                  )}
                  {selectedCharts.topProducts && topProductsData.length > 0 && (
                    <ReportBlock title="Top Products">
                      <ResponsiveContainer width="100%" height={Math.max(110, topProductsData.length * 30)}>
                        <BarChart data={topProductsData} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                          <XAxis type="number" hide allowDecimals={false} />
                          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 9, fill: '#374151' }} tickLine={false} axisLine={false} />
                          <Bar dataKey="count" fill={BB_BLUE} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                            <LabelList dataKey="count" position="right" fontSize={9} fill="#374151" />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </ReportBlock>
                  )}
                  {selectedCharts.restock && (
                    <ReportBlock title="Restock Priority">
                      {restockData.length === 0 ? (
                        <p style={{ fontSize: 11, color: '#9ca3af' }}>Nothing on the restock list yet.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={Math.max(110, restockData.length * 30)}>
                          <BarChart data={restockData} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
                            <XAxis type="number" hide allowDecimals={false} />
                            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 9, fill: '#374151' }} tickLine={false} axisLine={false} />
                            <Bar dataKey="count" fill="#e63946" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                              <LabelList dataKey="count" position="right" fontSize={9} fill="#374151" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ReportBlock>
                  )}
                </div>
              </div>

              <div className="flex gap-3 shrink-0">
                <button
                  onClick={generate}
                  disabled={loading}
                  className="flex-1 rounded-xl py-4 text-sm font-bold border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50"
                >
                  Regenerate
                </button>
                <button
                  onClick={copyEmail}
                  className="flex-1 rounded-xl py-4 text-sm font-bold text-white"
                  style={{ background: BB_BLUE }}
                >
                  {copied ? 'Copied!' : 'Copy Email'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DraggableFAB ─────────────────────────────────────────────────────────────

function DraggableFAB({ onClick }) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('fab-pos')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { x: window.innerWidth - 72, y: window.innerHeight - 140 }
  })

  const posRef = useRef(pos)
  const startPointer = useRef({ x: 0, y: 0 })
  const startPos = useRef({ x: 0, y: 0 })
  const moved = useRef(false)
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  const moveHandler = useRef((e) => {
    const dx = e.clientX - startPointer.current.x
    const dy = e.clientY - startPointer.current.y
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved.current = true
    const newX = Math.max(0, Math.min(window.innerWidth - 56, startPos.current.x + dx))
    const newY = Math.max(0, Math.min(window.innerHeight - 56, startPos.current.y + dy))
    posRef.current = { x: newX, y: newY }
    setPos({ x: newX, y: newY })
  })

  const upHandler = useRef(() => {
    window.removeEventListener('pointermove', moveHandler.current)
    window.removeEventListener('pointerup', upHandler.current)
    if (!moved.current) {
      onClickRef.current()
    } else {
      localStorage.setItem('fab-pos', JSON.stringify(posRef.current))
    }
  })

  function onPointerDown(e) {
    e.preventDefault()
    moved.current = false
    startPointer.current = { x: e.clientX, y: e.clientY }
    startPos.current = { ...posRef.current }
    window.addEventListener('pointermove', moveHandler.current)
    window.addEventListener('pointerup', upHandler.current)
  }

  return (
    <button
      onPointerDown={onPointerDown}
      style={{ position: 'fixed', left: pos.x, top: pos.y, background: BB_BLUE, touchAction: 'none' }}
      className="w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white text-3xl font-light z-10 select-none"
      aria-label="Log demand"
    >
      +
    </button>
  )
}

export default function TrackerView({
  variants, products, logs, restockItems,
  onSubmitLog, onDeleteLog, onAddRestockItem, onDeleteRestockItem,
  apiAllowed, onSetupVariants, onAddVariant,
  showReport, onCloseReport,
  savedReports, onSaveReport, onDeleteSavedReport,
}) {
  const [showSheet, setShowSheet] = useState(false)
  const [preselect, setPreselect] = useState(null)

  const variantMap = useMemo(() => Object.fromEntries(variants.map(v => [v.id, v])), [variants])
  const topThisWeek = useMemo(() => getTopThisWeek(logs, variantMap, variants, 6), [logs, variantMap, variants])

  const unknownProducts = useMemo(() => {
    // A custom_product is "known" if it matches any brand+model that already
    // exists either in tracker_variants OR in the products table. Strip any
    // trailing material suffix (Titanium, Ceramic) so e.g. "Oura Ring 4
    // Titanium" resolves to "Oura Ring 4" — materials are treated as part of
    // the color rather than a separate product.
    const MATERIAL_RE = /\s+(titanium|ceramic)\s*$/i
    const normalize = (s) => s.replace(MATERIAL_RE, '').trim().toLowerCase()

    const knownNames = new Set()
    for (const v of variants) knownNames.add(`${v.product.brand} ${v.product.model}`.toLowerCase())
    for (const p of products ?? []) {
      if (p.brand && p.model) knownNames.add(`${p.brand} ${p.model}`.toLowerCase())
    }

    const seen = new Set()
    const result = []
    for (const log of logs) {
      if (!log.custom_product) continue
      const norm = normalize(log.custom_product)
      if (seen.has(norm)) continue
      seen.add(norm)
      if (!knownNames.has(norm)) result.push(log.custom_product)
    }
    return result
  }, [variants, products, logs])

  function openSheet(preselectData = null) {
    setPreselect(preselectData)
    setShowSheet(true)
  }

  function closeSheet() {
    setShowSheet(false)
    setPreselect(null)
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-y-auto pb-40">

        {/* Quick Log */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Quick Log</h2>
            <span className="text-xs text-gray-400">This week's top</span>
          </div>
          {topThisWeek.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nothing logged this week yet. Tap + to start.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {topThisWeek.map(({ variant: v, count, customProduct: cp }) => (
                <button
                  key={cp || `${v.product.brand}|${v.product.model}|${v.variant}`}
                  onClick={() => cp
                    ? openSheet({ customMode: true, customProduct: cp })
                    : openSheet({ brand: v.product.brand, model: v.product.model, variant: v.variant || '' })}
                  className="text-left p-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 active:scale-95 transition-transform"
                >
                  {cp ? (
                    <>
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <span className="text-xs font-bold text-gray-900 dark:text-white leading-tight">Unknown</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ background: BB_BLUE }}>×{count}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-tight">{cp}</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-1 mb-0.5">
                        <span className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{v.product.brand}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ background: BB_BLUE }}>×{count}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 leading-tight">{v.product.model}</p>
                      {v.variant && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{v.variant}</p>}
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 mx-4 my-3" />

        {/* Restock list */}
        <RestockList
          items={restockItems}
          variantMap={variantMap}
          variants={variants}
          onDelete={onDeleteRestockItem}
          onAdd={() => openSheet({ mode: 'restock' })}
        />

        <div className="border-t border-gray-100 dark:border-gray-800 mx-4 my-3" />

        {/* Demand graph */}
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white px-4 mb-1">Demand Trends</h2>
          <DemandGraph logs={logs} variantMap={variantMap} variants={variants} />
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 mx-4 my-3" />

        {/* Unknown products — need variant setup */}
        {unknownProducts.length > 0 && (
          <>
            <UnknownProducts
              products={unknownProducts}
              apiAllowed={apiAllowed}
              onSetupVariants={onSetupVariants}
            />
            <div className="border-t border-gray-100 dark:border-gray-800 mx-4 my-3" />
          </>
        )}

        {/* Recent logs with delete */}
        <RecentLogs logs={logs} variantMap={variantMap} variants={variants} onDelete={onDeleteLog} />
      </div>

      {/* FAB */}
      <DraggableFAB onClick={() => openSheet(null)} />

      {showSheet && (
        <TrackerLogSheet
          variants={variants}
          products={products}
          logs={logs}
          preselect={preselect}
          onClose={closeSheet}
          onSubmit={onSubmitLog}
          onAddRestockItem={onAddRestockItem}
          onAddVariant={onAddVariant}
        />
      )}

      {showReport && (
        <ReportSheet
          logs={logs}
          variants={variants}
          restockItems={restockItems}
          onClose={onCloseReport}
          savedReports={savedReports}
          onSaveReport={onSaveReport}
          onDeleteSavedReport={onDeleteSavedReport}
        />
      )}
    </>
  )
}
