import { useState, useEffect, useCallback, memo, Fragment } from 'react'
import { createClient } from '@supabase/supabase-js'
import TrackerView from './TrackerView.jsx'

// ─── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

// ─── Constants ───────────────────────────────────────────────────────────────
const BB_BLUE = '#0046BE'
const MAX_COMPARE = 5

const SPEC_CATEGORIES = [
  { key: 'display', label: 'Display', specs: [
    { name: 'Display Type', type: 'text' },
    { name: 'Screen Size', type: 'text' },
    { name: 'Screen Material', type: 'text' },
  ]},
  { key: 'hardware', label: 'Hardware', specs: [
    { name: 'Case Size', type: 'text' },
    { name: 'Case Material', type: 'text' },
    { name: 'Built-in Storage', type: 'text' },
  ]},
  { key: 'performance', label: 'Performance', specs: [
    { name: 'Built-in GPS', type: 'text' },
    { name: 'Max Water Resistance', type: 'text' },
    { name: 'Usage Time (Battery)', type: 'text' },
  ]},
  { key: 'connectivity', label: 'Connectivity', specs: [
    { name: 'Wireless Connectivity', type: 'text' },
    { name: 'Voice Assistant', type: 'text' },
  ]},
  { key: 'health', label: 'Health', specs: [
    { name: 'Sensors', type: 'text' },
    { name: 'Metrics Measured', type: 'text' },
  ]},
  { key: 'misc', label: 'Misc', specs: [
    { name: 'US Release Date', type: 'text' },
  ]},
]

const ALL_SPECS_FLAT = SPEC_CATEGORIES.flatMap(c => c.specs.map(s => ({ ...s, category: c.key })))
const EMPTY_SPECS = Object.fromEntries(ALL_SPECS_FLAT.map(s => [s.name, '']))
const EMPTY_FORM = {
  brand: '', model: '', variant: '', size: '', colors: '', category: 'Wearables',
  notes: '', ...EMPTY_SPECS,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function productName(p) {
  return [p.brand, p.model, p.variant, p.size].filter(Boolean).join(' ')
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function apiFetchSpecs(product) {
  const payload = {
    name: productName(product),
    brand: product.brand,
    model: product.model,
    variant: product.variant,
    size: product.size,
  }
  const call = async (noSearch) => {
    const res = await fetch('/api/fetch-specs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, noSearch }),
    })
    if (!res.ok) throw new Error(`fetch-specs failed: ${res.status}`)
    return res.json()
  }
  try {
    return await call(false)
  } catch (err) {
    console.warn(`Web-search fetch failed for ${payload.name}, retrying without search:`, err.message)
    return await call(true)
  }
}

// ─── Module-level components (stable references) ────────────────────────────

const SpecCell = memo(function SpecCell({ productId, category, specName, specType, isBenchmark, specs, fetchingIds }) {
  const s = specs.find(r => r.product_id === productId && r.category === category && r.spec_name === specName)

  if (!s || !s.verified || s.spec_value === null || s.spec_value === '') {
    return (
      <td className="px-3 py-2 text-center text-sm">
        {fetchingIds.has(productId)
          ? <span className="text-gray-400 animate-pulse">…</span>
          : <span className="text-gray-400">?</span>}
      </td>
    )
  }

  const val = s.spec_value
  const isMissing = !isBenchmark && specType === 'boolean' && val === 'false'

  if (specType === 'boolean') {
    return (
      <td className={`px-3 py-2 text-center text-sm ${isMissing ? 'opacity-40' : ''}`}>
        {val === 'true'
          ? <span className="text-green-600 font-bold text-base">✓</span>
          : <span className="text-red-500 font-bold text-base">✗</span>}
      </td>
    )
  }

  const items = val.includes(',') ? val.split(',').map(s => s.trim()).filter(Boolean) : null
  if (items && items.length > 3) {
    const lines = []
    for (let i = 0; i < items.length; i += 3) {
      lines.push(items.slice(i, i + 3).join(', '))
    }
    return (
      <td className={`px-3 py-2 text-center text-xs text-gray-900 dark:text-gray-100 max-w-[180px] ${isMissing ? 'opacity-40' : ''}`}>
        {lines.map((line, idx) => <div key={idx}>{line}{idx < lines.length - 1 ? ',' : ''}</div>)}
      </td>
    )
  }

  return (
    <td className={`px-3 py-2 text-center text-xs text-gray-900 dark:text-gray-100 max-w-[180px] whitespace-normal ${isMissing ? 'opacity-40' : ''}`}>
      {val}
    </td>
  )
})

const API_PIN = (import.meta.env.VITE_API_PIN ?? '').trim()

function SettingsModal({ apiAllowed, toggleApiAllowed, onClose }) {
  const [pinEntry, setPinEntry] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [pinError, setPinError] = useState(false)

  function handleToggle() {
    if (apiAllowed) {
      toggleApiAllowed()
    } else {
      setShowPin(true)
      setPinEntry('')
      setPinError(false)
    }
  }

  function handlePinSubmit(e) {
    e.preventDefault()
    if (API_PIN && pinEntry.trim() === API_PIN) {
      setShowPin(false)
      toggleApiAllowed()
    } else {
      setPinError(true)
      setPinEntry('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">×</button>
        </div>

        <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex-1 mr-4">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Allow API calls</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Enables Claude AI auto-fill on the product form and ↻ refresh in Compare. May incur Anthropic API costs.
            </p>
          </div>
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              apiAllowed ? '' : 'bg-gray-300 dark:bg-gray-700'
            }`}
            style={apiAllowed ? { background: BB_BLUE } : {}}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              apiAllowed ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        {showPin && (
          <form onSubmit={handlePinSubmit} className="mt-4">
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">Enter PIN to enable API calls</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinEntry}
              onChange={e => { setPinEntry(e.target.value); setPinError(false) }}
              autoFocus
              className={`w-full border rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white outline-none ${
                pinError ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'
              }`}
              placeholder="PIN"
            />
            {pinError && <p className="text-xs text-red-500 mt-1">Incorrect PIN</p>}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setShowPin(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg text-sm text-white font-medium"
                style={{ background: BB_BLUE }}
              >
                Confirm
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const SelectView = memo(function SelectView({
  search, setSearch, categoryFilter, setCategoryFilter,
  selected, setSelected, toggleSelect, openEdit,
  filteredProducts, brands, specs, fetchingIds,
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2">
        <input
          type="search"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 dark:text-white"
          style={{ '--tw-ring-color': BB_BLUE }}
        />
      </div>

      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {['Wearables', 'Health & Wellness', 'Smarthome'].map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              categoryFilter === cat
                ? 'text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
            }`}
            style={categoryFilter === cat ? { background: BB_BLUE } : {}}
          >
            {cat}
          </button>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="mx-4 mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between text-white text-sm font-medium" style={{ background: BB_BLUE }}>
          <span>{selected.length} selected</span>
          <button onClick={() => setSelected([])} className="text-white/70 text-xs ml-2">Clear</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {brands.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">No products match</p>
        )}
        {brands.map(brand => (
          <div key={brand} className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">{brand}</h3>
            <div className="flex flex-col gap-2">
              {filteredProducts.filter(p => p.brand === brand).map(product => {
                const isSelected = selected.includes(product.id)
                const isFetching = fetchingIds.has(product.id)
                const hasSpecs = specs.some(s => s.product_id === product.id && s.verified)
                return (
                  <div
                    key={product.id}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 border transition-all ${
                      isSelected
                        ? 'border-transparent text-white'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white'
                    }`}
                    style={isSelected ? { background: BB_BLUE, borderColor: BB_BLUE } : {}}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelect(product.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-sm font-medium truncate">{product.model}{product.variant ? ` — ${product.variant}` : ''}</p>
                      {product.size && <p className={`text-xs mt-0.5 ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>{product.size}</p>}
                    </button>
                    <div className="flex items-center gap-3 ml-2 shrink-0">
                      {isFetching && <span className={`text-xs animate-pulse ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>syncing…</span>}
                      {!hasSpecs && !isFetching && <span className={`text-xs ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>?</span>}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEdit(product.id) }}
                        className={`text-base px-1 ${isSelected ? 'text-white/80 hover:text-white' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                        title="Edit product"
                        aria-label="Edit product"
                      >
                        ✎
                      </button>
                      {isSelected && <span className="text-white text-lg leading-none">✓</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

function CompareView({
  selectedProducts, benchmarkId, toggleBenchmark, specs,
  collapsedSections, setCollapsedSections, fetchingIds,
  refreshProduct, setView, apiAllowed,
}) {
  const ordered = [
    ...selectedProducts.filter(p => p.id === benchmarkId),
    ...selectedProducts.filter(p => p.id !== benchmarkId),
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700">
        <button onClick={() => setView('select')} className="text-sm font-medium" style={{ color: BB_BLUE }}>
          ← Back
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 text-center">
          {ordered.length === 1 ? 'Details' : `Compare (${ordered.length})`}
        </span>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-auto spec-table-scroll">
        <table className="min-w-max w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="freeze-corner bg-white dark:bg-gray-950 px-3 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 w-36">
                Spec
              </th>
              {ordered.map(p => (
                <th
                  key={p.id}
                  onClick={() => toggleBenchmark(p.id)}
                  className="freeze-row bg-white dark:bg-gray-950 px-3 py-3 text-center text-xs font-semibold border-b border-gray-200 dark:border-gray-700 min-w-[120px] cursor-pointer select-none"
                  title={p.id === benchmarkId ? 'Tap to clear reference' : 'Tap to set as reference'}
                >
                  <div className="flex flex-col items-center gap-1">
                    {p.id === benchmarkId
                      ? <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-white" style={{ background: BB_BLUE }}>Reference</span>
                      : <span className="text-[10px] uppercase tracking-wider text-gray-300 dark:text-gray-600">Tap to set</span>}
                    <span className="dark:text-white text-gray-800" style={p.id === benchmarkId ? { color: BB_BLUE } : {}}>{p.brand}</span>
                    <span className="font-normal text-[11px] text-gray-500 dark:text-gray-400">
                      {p.model}{p.variant ? ` ${p.variant}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (apiAllowed) refreshProduct(p) }}
                      disabled={!apiAllowed}
                      className={`text-[10px] mt-0.5 ${apiAllowed ? 'text-gray-400 hover:text-gray-600' : 'text-gray-300 dark:text-gray-700 cursor-not-allowed'}`}
                      title={apiAllowed ? 'Re-fetch via API' : 'Enable API in settings to use'}
                    >
                      {fetchingIds.has(p.id) ? '⟳ syncing…' : '↻ refresh'}
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPEC_CATEGORIES.map(cat => {
              const isCollapsed = collapsedSections[cat.key]
              return (
                <Fragment key={cat.key}>
                  <tr>
                    <td
                      colSpan={ordered.length + 1}
                      className="bg-gray-50 dark:bg-gray-900 px-3 py-2 cursor-pointer select-none"
                      onClick={() => setCollapsedSections(prev => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                    >
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {isCollapsed ? '▶' : '▼'} {cat.label}
                      </span>
                    </td>
                  </tr>
                  {!isCollapsed && cat.specs.map(spec => (
                    <tr
                      key={`${cat.key}-${spec.name}`}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                    >
                      <td className="freeze-col bg-white dark:bg-gray-950 px-3 py-2 text-xs text-gray-600 dark:text-gray-300 font-medium w-36 max-w-[144px]">
                        {spec.name}
                      </td>
                      {ordered.map(p => (
                        <SpecCell
                          key={p.id}
                          productId={p.id}
                          category={cat.key}
                          specName={spec.name}
                          specType={spec.type}
                          isBenchmark={p.id === benchmarkId}
                          specs={specs}
                          fetchingIds={fetchingIds}
                        />
                      ))}
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProductForm({ setView, editProductId, products, specs, apiAllowed, saveProduct }) {
  const isEdit = !!editProductId

  const [formData, setFormData] = useState(() => {
    if (editProductId) {
      const p = products.find(x => x.id === editProductId)
      if (p) {
        const productSpecs = specs.filter(s => s.product_id === editProductId && s.verified)
        const specMap = Object.fromEntries(productSpecs.map(s => [s.spec_name, s.spec_value ?? '']))
        return {
          brand: p.brand ?? '',
          model: p.model ?? '',
          variant: p.variant ?? '',
          size: p.size ?? '',
          colors: p.colors ?? '',
          category: p.category ?? 'Wearables',
          notes: '',
          ...EMPTY_SPECS,
          ...specMap,
        }
      }
    }
    return EMPTY_FORM
  })

  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  const [collapsed, setCollapsed] = useState({})

  const isWearable = formData.category === 'Wearables'
  const canAutoFill = apiAllowed && !autoFilling && formData.brand.trim() && formData.model.trim()

  const handleAutoFill = useCallback(async () => {
    if (!canAutoFill) return
    setAutoFilling(true)
    setError('')
    try {
      const { specs: fetched } = await apiFetchSpecs({
        brand: formData.brand,
        model: formData.model,
        variant: formData.variant,
        size: formData.size,
      })
      setFormData(prev => {
        const updated = { ...prev }
        for (const spec of ALL_SPECS_FLAT) {
          const existing = prev[spec.name]
          const newVal = fetched[spec.name]
          if ((existing === '' || existing == null) && newVal !== undefined && newVal !== null) {
            updated[spec.name] = String(newVal)
          }
        }
        return updated
      })
    } catch (err) {
      setError(`Auto-fill failed: ${err.message}`)
    } finally {
      setAutoFilling(false)
    }
  }, [canAutoFill, formData.brand, formData.model, formData.variant, formData.size])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    if (!formData.brand.trim() || !formData.model.trim()) {
      setError('Brand and Model are required.')
      return
    }
    setSaving(true)
    try {
      await saveProduct(formData, editProductId)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const existingBrands = [...new Set(products.map(p => p.brand))].sort()

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700">
        <button onClick={() => setView('select')} className="text-sm font-medium" style={{ color: BB_BLUE }}>
          ← Cancel
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1 text-center">
          {isEdit ? 'Edit Product' : 'Add Product'}
        </span>
        <div className="w-16" />
      </div>

      <form onSubmit={onSubmit} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-32">
        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Category</label>
          <select
            value={formData.category}
            onChange={e => setFormData(f => ({ ...f, category: e.target.value }))}
            className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
          >
            <option>Wearables</option>
            <option>Health &amp; Wellness</option>
            <option>Smarthome</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Brand</label>
          <input
            list="brand-options"
            value={formData.brand}
            onChange={e => setFormData(f => ({ ...f, brand: e.target.value }))}
            placeholder="e.g. Garmin"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
            required
          />
          <datalist id="brand-options">
            {existingBrands.map(b => <option key={b} value={b} />)}
          </datalist>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Model</label>
          <input
            value={formData.model}
            onChange={e => setFormData(f => ({ ...f, model: e.target.value }))}
            placeholder="e.g. Fenix 9"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Variant</label>
            <input
              value={formData.variant}
              onChange={e => setFormData(f => ({ ...f, variant: e.target.value }))}
              placeholder="Solar, Titanium…"
              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Size</label>
            <input
              value={formData.size}
              onChange={e => setFormData(f => ({ ...f, size: e.target.value }))}
              placeholder="47mm"
              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Colors <span className="font-normal text-gray-400">(optional)</span></label>
          <input
            value={formData.colors}
            onChange={e => setFormData(f => ({ ...f, colors: e.target.value }))}
            placeholder="Black, Silver"
            className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
          />
        </div>

        {isWearable ? (
          <>
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 -mx-4 px-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Specifications</h3>
                <button
                  type="button"
                  onClick={handleAutoFill}
                  disabled={!canAutoFill}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    canAutoFill ? 'text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                  }`}
                  style={canAutoFill ? { background: BB_BLUE } : {}}
                  title={
                    !apiAllowed ? 'Enable API in settings to use'
                    : !formData.brand.trim() || !formData.model.trim() ? 'Enter brand and model first'
                    : 'Fill empty fields via Claude AI'
                  }
                >
                  {autoFilling ? 'Fetching…' : 'Auto-fill via API'}
                </button>
              </div>
              {!apiAllowed && (
                <p className="text-xs text-gray-400 mb-2">Enable API in ⚙ settings to use auto-fill.</p>
              )}
            </div>

            {SPEC_CATEGORIES.map(cat => {
              const isOpen = !collapsed[cat.key]
              return (
                <div key={cat.key} className="border border-gray-200 dark:border-gray-700 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setCollapsed(prev => ({ ...prev, [cat.key]: !prev[cat.key] }))}
                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{cat.label}</span>
                    <span className="text-gray-400 text-xs">{isOpen ? '▼' : '▶'}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 flex flex-col gap-3">
                      {cat.specs.map(spec => (
                        <div key={spec.name}>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{spec.name}</label>
                          {spec.type === 'boolean' ? (
                            <select
                              value={formData[spec.name] ?? ''}
                              onChange={e => setFormData(f => ({ ...f, [spec.name]: e.target.value }))}
                              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
                            >
                              <option value="">—</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input
                              value={formData[spec.name] ?? ''}
                              onChange={e => setFormData(f => ({ ...f, [spec.name]: e.target.value }))}
                              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
              placeholder="Spec fields are not yet defined for this category."
              rows={4}
              className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white focus:outline-none"
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ background: BB_BLUE }}
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
        </button>
      </form>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('tracker')
  const [view, setView] = useState('select')
  const [editProductId, setEditProductId] = useState(null)
  const [products, setProducts] = useState([])
  const [specs, setSpecs] = useState([])
  const [selected, setSelected] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('Wearables')
  const [collapsedSections, setCollapsedSections] = useState({})
  const [fetchingIds, setFetchingIds] = useState(new Set())
  const [benchmarkId, setBenchmarkId] = useState(null)
  const [apiAllowed, setApiAllowed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('dark-mode')
    const isDark = saved !== null ? saved === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', isDark)
    return isDark
  })
  const [trackerVariants, setTrackerVariants] = useState([])
  const [trackerLogs, setTrackerLogs] = useState([])
  const [restockItems, setRestockItems] = useState([])
  const [savedReports, setSavedReports] = useState([])
  const [showTrackerReport, setShowTrackerReport] = useState(false)

  const loadAll = useCallback(async () => {
    const [
      { data: prods },
      { data: sp },
      { data: state },
      { data: tvars, error: tvarErr },
      { data: tlogs, error: tlogErr },
      { data: restock, error: restockErr },
      { data: savedReps },
    ] = await Promise.all([
      supabase.from('products').select('*').order('brand').order('model'),
      supabase.from('specs').select('*').range(0, 49999),
      supabase.from('app_state').select('*'),
      supabase.from('tracker_variants').select('*'),
      supabase.from('tracker_logs').select('*').order('logged_at', { ascending: false }).limit(5000),
      supabase.from('restock_items').select('*').order('created_at', { ascending: false }),
      supabase.from('saved_reports').select('*').order('created_at', { ascending: false }),
    ])

    if (tvarErr) console.error('tracker_variants error:', tvarErr)
    if (tlogErr) console.error('tracker_logs error:', tlogErr)
    if (restockErr) console.error('restock_items error:', restockErr)

    const prodMap = Object.fromEntries((prods ?? []).map(p => [p.id, p]))
    const enrichedVariants = (tvars ?? [])
      .map(tv => ({ ...tv, product: prodMap[tv.product_id] ?? null }))
      .filter(tv => tv.product)

    setProducts(prods ?? [])
    setSpecs(sp ?? [])
    setTrackerVariants(enrichedVariants)
    setTrackerLogs(tlogs ?? [])
    setRestockItems(restock ?? [])
    setSavedReports(savedReps ?? [])
    const apiState = (state ?? []).find(s => s.key === 'allow_api_calls')
    setApiAllowed(apiState?.value === 'true')
  }, [])

  useEffect(() => {
    loadAll()
    const ch = supabase
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'specs' }, () => {
        supabase.from('specs').select('*').range(0, 49999).then(({ data }) => setSpecs(data ?? []))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        supabase.from('products').select('*').order('brand').order('model').then(({ data }) => setProducts(data ?? []))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, payload => {
        if (payload.new?.key === 'allow_api_calls') {
          setApiAllowed(payload.new.value === 'true')
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tracker_logs' }, () => {
        supabase.from('tracker_logs').select('*').order('logged_at', { ascending: false }).limit(5000)
          .then(({ data }) => setTrackerLogs(data ?? []))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restock_items' }, () => {
        supabase.from('restock_items').select('*').order('created_at', { ascending: false })
          .then(({ data }) => setRestockItems(data ?? []))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadAll])

  const refreshProduct = useCallback(async (product) => {
    if (!apiAllowed) return
    setFetchingIds(prev => new Set([...prev, product.id]))
    try {
      const { specs: fetched } = await apiFetchSpecs(product)
      const rows = []
      for (const spec of ALL_SPECS_FLAT) {
        if (fetched[spec.name] === undefined) continue
        const val = fetched[spec.name]
        rows.push({
          product_id: product.id,
          category: spec.category,
          spec_name: spec.name,
          spec_value: val === null ? null : String(val),
          verified: val !== null,
        })
      }
      if (rows.length) {
        await supabase.from('specs').upsert(rows, { onConflict: 'product_id,category,spec_name', ignoreDuplicates: false })
      }
    } catch (err) {
      console.error('refresh error:', err)
    } finally {
      setFetchingIds(prev => { const s = new Set(prev); s.delete(product.id); return s })
    }
  }, [apiAllowed])

  const deleteLog = useCallback(async (logId) => {
    await supabase.from('tracker_logs').delete().eq('id', logId)
    setTrackerLogs(prev => prev.filter(l => l.id !== logId))
  }, [])

  const addRestockItem = useCallback(async (variantId, notes, customProduct) => {
    const { error } = await supabase.from('restock_items').insert({
      variant_id: variantId ?? null,
      notes: notes ?? null,
      custom_product: customProduct ?? null,
    })
    if (error) throw new Error(`Restock insert failed: ${error.message}`)
    const { data, error: selectErr } = await supabase
      .from('restock_items').select('*').order('created_at', { ascending: false })
    if (selectErr) throw new Error(`Restock read failed: ${selectErr.message}`)
    setRestockItems(data ?? [])
  }, [])

  const deleteRestockItem = useCallback(async (itemId) => {
    await supabase.from('restock_items').delete().eq('id', itemId)
    setRestockItems(prev => prev.filter(r => r.id !== itemId))
  }, [])

  const setupVariants = useCallback(async (customProductName) => {
    if (!apiAllowed) throw new Error('API not enabled')

    const KNOWN_BRANDS = [
      'Apple', 'Google', 'Samsung', 'Garmin', 'Fitbit', 'Whoop', 'Oura',
      'Polar', 'Suunto', 'Fossil', 'Amazfit', 'Huawei', 'Xiaomi', 'OnePlus',
      'Withings', 'Coros', 'Sony', 'Casio',
    ]
    const name = customProductName.trim()
    const knownBrand = KNOWN_BRANDS.find(b => name.toLowerCase().startsWith(b.toLowerCase() + ' '))
    const brand = knownBrand ?? name.split(' ')[0]
    const model = name.slice(brand.length).trim()

    if (!brand || !model) throw new Error('Could not parse brand/model from product name')

    let { data: product } = await supabase
      .from('products').select('id').ilike('brand', brand).ilike('model', model).maybeSingle()

    if (!product) {
      const { data: inserted, error: insertErr } = await supabase.from('products').insert({
        brand, model, name: `${brand} ${model}`, category: 'Wearables',
        variant: null, size: null, colors: null,
      }).select().single()
      if (insertErr) throw new Error(`Product insert failed: ${insertErr.message}`)
      product = inserted
    }

    const res = await fetch('/api/fetch-variants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, model }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok || payload.error) throw new Error(payload.error || `HTTP ${res.status}`)
    const fetched = payload.variants
    if (!fetched?.length) throw new Error('No variants returned by API')

    await supabase.from('tracker_variants').delete().eq('product_id', product.id)

    const rows = fetched.map(v => ({
      product_id: product.id,
      color: v.color ?? null,
      variant: v.variant ?? null,
      size: v.size ?? null,
    }))

    const { error: varInsertErr } = await supabase.from('tracker_variants').insert(rows)
    if (varInsertErr) throw new Error(`Variants insert failed: ${varInsertErr.message}`)

    await loadAll()
  }, [apiAllowed, loadAll])

  const addVariant = useCallback(async ({ productId, color, variantText, size }) => {
    const { data, error } = await supabase.from('tracker_variants').insert({
      product_id: productId,
      color: color ?? null,
      variant: variantText ?? null,
      size: size ?? null,
    }).select().single()
    if (error) throw new Error(`Variant insert failed: ${error.message}`)
    await loadAll()
    return data
  }, [loadAll])

  const saveReport = useCallback(async (periodLabel, periodStart, periodEnd, emailContent) => {
    const { data, error } = await supabase.from('saved_reports').insert({
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      email_content: emailContent,
    }).select().single()
    if (error) throw new Error(`Save report failed: ${error.message}`)
    setSavedReports(prev => [data, ...prev])
  }, [])

  const deleteSavedReport = useCallback(async (reportId) => {
    await supabase.from('saved_reports').delete().eq('id', reportId)
    setSavedReports(prev => prev.filter(r => r.id !== reportId))
  }, [])

  const submitLog = useCallback(async (variantId, notes, customProduct) => {
    const { error } = await supabase.from('tracker_logs').insert({
      variant_id: variantId ?? null,
      notes: notes ?? null,
      custom_product: customProduct ?? null,
    })
    if (error) throw error

    // Auto-add unknown products to the compare table
    if (customProduct) {
      const KNOWN_BRANDS = [
        'Apple', 'Google', 'Samsung', 'Garmin', 'Fitbit', 'Whoop', 'Oura',
        'Polar', 'Suunto', 'Fossil', 'Amazfit', 'Huawei', 'Xiaomi', 'OnePlus',
        'Withings', 'Coros', 'Sony', 'Casio',
      ]
      const name = customProduct.trim()
      const knownBrand = KNOWN_BRANDS.find(b => name.toLowerCase().startsWith(b.toLowerCase() + ' '))
      const brand = knownBrand ?? name.split(' ')[0]
      const model = name.slice(brand.length).trim()

      if (brand && model) {
        const { data: existing } = await supabase
          .from('products').select('id').ilike('brand', brand).ilike('model', model).maybeSingle()
        if (!existing) {
          const { error: insertErr } = await supabase.from('products').insert({
            brand, model,
            name: `${brand} ${model}`,
            category: 'Wearables',
            variant: null, size: null, colors: null,
          })
          if (insertErr) console.error('Auto-add product failed:', insertErr.message)
        }
      }
    }

    const { data } = await supabase.from('tracker_logs').select('*').order('logged_at', { ascending: false }).limit(5000)
    setTrackerLogs(data ?? [])
  }, [])

  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, id]
    })
  }, [])

  const toggleBenchmark = useCallback((id) => {
    setBenchmarkId(prev => prev === id ? null : id)
  }, [])

  const openEdit = useCallback((id) => {
    setEditProductId(id)
    setView('edit')
  }, [])

  const toggleApiAllowed = useCallback(async () => {
    const newVal = !apiAllowed
    setApiAllowed(newVal)
    await supabase.from('app_state').upsert({ key: 'allow_api_calls', value: String(newVal) })
  }, [apiAllowed])

  const saveProduct = useCallback(async (formData, productId) => {
    const productData = {
      name: [formData.brand, formData.model, formData.variant].filter(Boolean).join(' '),
      brand: formData.brand.trim(),
      model: formData.model.trim(),
      variant: formData.variant.trim() || null,
      size: formData.size.trim() || null,
      colors: formData.colors.trim() || null,
      category: formData.category,
    }

    let id = productId
    if (productId) {
      const { error } = await supabase.from('products').update(productData).eq('id', productId)
      if (error) throw error
    } else {
      const { data, error } = await supabase.from('products').insert(productData).select().single()
      if (error) throw error
      id = data.id
    }

    if (formData.category === 'Wearables') {
      const upserts = []
      const deletes = []
      for (const spec of ALL_SPECS_FLAT) {
        const val = formData[spec.name]
        if (val === '' || val === null || val === undefined) {
          deletes.push({ category: spec.category, spec_name: spec.name })
        } else {
          upserts.push({
            product_id: id,
            category: spec.category,
            spec_name: spec.name,
            spec_value: String(val),
            verified: true,
          })
        }
      }
      if (upserts.length) {
        await supabase.from('specs').upsert(upserts, { onConflict: 'product_id,category,spec_name', ignoreDuplicates: false })
      }
      if (productId && deletes.length) {
        await Promise.all(deletes.map(d =>
          supabase.from('specs').delete()
            .eq('product_id', id).eq('category', d.category).eq('spec_name', d.spec_name)
        ))
      }
    }

    setEditProductId(null)
    setView('select')
  }, [])

  const filteredProducts = products.filter(p => {
    const matchCat = !categoryFilter || p.category === categoryFilter
    const q = search.toLowerCase()
    const matchSearch = !q || productName(p).toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)
    return matchCat && matchSearch
  })
  const brands = [...new Set(filteredProducts.map(p => p.brand))].sort()
  const selectedProducts = products.filter(p => selected.includes(p.id))
  const effectiveBenchmarkId = benchmarkId && selected.includes(benchmarkId) ? benchmarkId : null

  return (
    <div className="flex flex-col h-dvh max-w-lg mx-auto bg-white dark:bg-gray-950 relative">
      <header className="px-4 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: BB_BLUE }}>
            BB
          </span>
          <span className="text-sm font-bold text-gray-900 dark:text-white">VPL Tool</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const next = !darkMode
              setDarkMode(next)
              document.documentElement.classList.toggle('dark', next)
              localStorage.setItem('dark-mode', next)
            }}
            className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {darkMode ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="text-lg leading-none text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
          {tab === 'tracker' && (
            <button
              onClick={() => setShowTrackerReport(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full text-white"
              style={{ background: BB_BLUE }}
            >
              Report
            </button>
          )}
          {tab === 'compare' && view === 'select' && (
            <button onClick={() => { setEditProductId(null); setView('add') }} className="text-sm font-medium" style={{ color: BB_BLUE }}>
              + Add
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {tab === 'tracker' ? (
          <TrackerView
            variants={trackerVariants}
            products={products}
            logs={trackerLogs}
            restockItems={restockItems}
            onSubmitLog={submitLog}
            onDeleteLog={deleteLog}
            onAddRestockItem={addRestockItem}
            onDeleteRestockItem={deleteRestockItem}
            apiAllowed={apiAllowed}
            onSetupVariants={setupVariants}
            onAddVariant={addVariant}
            showReport={showTrackerReport}
            onCloseReport={() => setShowTrackerReport(false)}
            savedReports={savedReports}
            onSaveReport={saveReport}
            onDeleteSavedReport={deleteSavedReport}
          />
        ) : (
          <>
            {view === 'select' && (
              <SelectView
                search={search}
                setSearch={setSearch}
                categoryFilter={categoryFilter}
                setCategoryFilter={setCategoryFilter}
                selected={selected}
                setSelected={setSelected}
                toggleSelect={toggleSelect}
                openEdit={openEdit}
                filteredProducts={filteredProducts}
                brands={brands}
                specs={specs}
                fetchingIds={fetchingIds}
              />
            )}
            {view === 'compare' && (
              <CompareView
                selectedProducts={selectedProducts}
                benchmarkId={effectiveBenchmarkId}
                toggleBenchmark={toggleBenchmark}
                specs={specs}
                collapsedSections={collapsedSections}
                setCollapsedSections={setCollapsedSections}
                fetchingIds={fetchingIds}
                refreshProduct={refreshProduct}
                setView={setView}
                apiAllowed={apiAllowed}
              />
            )}
            {(view === 'add' || view === 'edit') && (
              <ProductForm
                key={editProductId ?? 'new'}
                setView={setView}
                editProductId={editProductId}
                products={products}
                specs={specs}
                apiAllowed={apiAllowed}
                saveProduct={saveProduct}
              />
            )}
          </>
        )}
      </main>

      {tab === 'compare' && view === 'select' && selected.length >= 1 && (
        <div className="absolute bottom-16 left-0 right-0 px-4 pb-2 z-20 max-w-lg mx-auto">
          <button
            onClick={() => setView('compare')}
            className="w-full rounded-2xl py-4 text-white font-bold text-base shadow-xl active:scale-95 transition-transform"
            style={{ background: BB_BLUE }}
          >
            {selected.length === 1 ? 'See Details →' : `Compare ${selected.length} Products →`}
          </button>
        </div>
      )}

      <nav className="shrink-0 flex border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
        <button
          className="flex-1 flex flex-col items-center py-2 gap-0.5"
          onClick={() => setTab('compare')}
        >
          <span className="text-lg" style={{ color: tab === 'compare' ? BB_BLUE : '#9ca3af' }}>⊞</span>
          <span className="text-[10px] font-semibold" style={{ color: tab === 'compare' ? BB_BLUE : '#9ca3af' }}>Compare</span>
        </button>
        <button
          className="flex-1 flex flex-col items-center py-2 gap-0.5"
          onClick={() => setTab('tracker')}
        >
          <span className="text-lg" style={{ color: tab === 'tracker' ? BB_BLUE : '#9ca3af' }}>▦</span>
          <span className="text-[10px] font-semibold" style={{ color: tab === 'tracker' ? BB_BLUE : '#9ca3af' }}>Tracker</span>
        </button>
      </nav>

      {showSettings && (
        <SettingsModal
          apiAllowed={apiAllowed}
          toggleApiAllowed={toggleApiAllowed}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
