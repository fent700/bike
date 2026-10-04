import { useState } from 'react'
import { Bike, ClipboardPaste, KeyRound } from 'lucide-react'
import { Spinner } from './ui'

/**
 * First-run (or rejected-token) screen. The token can be baked in at build
 * time through VITE_MAPBOX_ACCESS_TOKEN; when it isn't, it's pasted here once
 * and kept in this device's storage.
 */
export default function TokenGate({ initialError, onSave, onCancel, currentToken }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(initialError || null)
  const [checking, setChecking] = useState(false)

  const save = async (raw) => {
    const token = (raw ?? value).trim()
    if (!/^pk\.[\w-]+\.[\w-]+$/.test(token)) {
      setError('That isn’t a public token. It starts with “pk.”')
      return
    }
    setChecking(true)
    setError(null)
    try {
      const res = await fetch(`https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${encodeURIComponent(token)}`)
      if (res.status === 401 || res.status === 403) throw new Error('Mapbox rejected that token.')
      if (!res.ok) throw new Error(`Mapbox answered ${res.status}. Try again.`)
      onSave(token)
    } catch (err) {
      setError(err instanceof TypeError ? 'No connection to Mapbox. Check your network.' : err.message)
    } finally {
      setChecking(false)
    }
  }

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      setValue(text)
      if (text.startsWith('pk.')) save(text)
    } catch {
      setError('Clipboard not available — long-press the field and paste.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-oled px-5 pt-[calc(var(--sat)+24px)] pb-[calc(var(--sab)+24px)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_55%_at_50%_0%,rgba(16,185,129,0.18),transparent_70%)]" />
      <div className="glass animate-rise-in relative w-full max-w-[440px] rounded-[34px] p-6">
        <div className="glass-green mx-auto flex h-16 w-16 items-center justify-center rounded-[22px]">
          <Bike className="h-8 w-8 text-white" strokeWidth={2.3} />
        </div>
        <h1 className="mt-5 text-center text-[28px] font-bold tracking-tight">Connect Mapbox</h1>
        <p className="mt-2 text-center text-[15px] leading-relaxed text-white/60">
          Bike draws its map with Mapbox. Paste a public token from{' '}
          <span className="font-semibold text-white/85">account.mapbox.com → Tokens</span>. It stays on this phone.
        </p>

        <label className="glass-well mt-6 flex h-14 items-center gap-3 rounded-2xl px-4">
          <KeyRound className="h-5 w-5 shrink-0 text-white/40" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="pk.eyJ1Ijoi…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-[15px] text-white placeholder:text-white/25 focus:outline-none"
          />
        </label>

        {error && <p className="mt-3 text-center text-[14px] text-[#ff6961]">{error}</p>}

        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <button
            type="button"
            onClick={paste}
            aria-label="Paste token"
            className="glass-well press flex h-14 w-14 items-center justify-center rounded-2xl"
          >
            <ClipboardPaste className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => save()}
            disabled={checking}
            className="glass-green press flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-bold disabled:opacity-60"
          >
            {checking ? <Spinner /> : 'Save Token'}
          </button>
        </div>

        {currentToken && onCancel && (
          <button type="button" onClick={onCancel} className="mt-3 h-12 w-full text-[15px] font-medium text-white/55">
            Keep current token
          </button>
        )}
      </div>
    </div>
  )
}
