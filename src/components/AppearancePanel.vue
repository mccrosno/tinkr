<script setup lang="ts">
// The Appearance panel: pick a theme (from Tinkr and from plugins), and turn effects
// (blur) down. Each card previews the theme's colors and picture without applying it.
import { computed } from 'vue'
import { useAppearance } from '../stores/appearance'
import { useSettings } from '../stores/settings'
import type { ResolvedTheme } from '../theme/apply'

const appearance = useAppearance()
const settings = useSettings()

/** Preview colors when a theme doesn't set them: Tinkr's own (keep in step with tokens.css). */
const BASE = {
  dark: { bg: '#15161a', surface: '#1c1d22', text: '#e6e7eb', accent: '#d97757' },
  light: { bg: '#f6f5f2', surface: '#ffffff', text: '#1f1e1c', accent: '#c2613f' },
}
const systemKind = () => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')

function preview(t: ResolvedTheme) {
  const base = BASE[t.kind ?? systemKind()]
  const tok = (k: keyof typeof base) => t.tokens[k] ?? t.tokens[`--tk-${k}`] ?? base[k]
  return {
    card: {
      background: tok('bg'),
      color: tok('text'),
      ...(t.background ? { backgroundImage: `url(${JSON.stringify(t.background.url)})`, backgroundSize: t.background.size === 'tile' ? 'auto' : 'cover', backgroundPosition: t.background.position } : {}),
    },
    panel: { background: tok('surface'), opacity: t.background ? String(1 - t.translucency * 0.6) : '1' },
    accent: { background: tok('accent') },
  }
}

const probe = computed(() => settings.appValue<{ p95: number } | null>('appearance.blurProbe', null))
const usesBlur = computed(() => appearance.theme.blur > 0 && !!appearance.theme.background && appearance.theme.translucency > 0)
</script>

<template>
  <section class="appearance" data-testid="appearance">
    <div class="scroll">
      <h2>Theme</h2>
      <ul class="themes" role="radiogroup" aria-label="Theme">
        <li v-for="t in appearance.themes" :key="t.id">
          <button
            class="card"
            role="radio"
            :aria-checked="t.id === appearance.theme.id"
            :data-theme="t.id"
            :title="t.plugin === 'themes' ? t.name : `${t.name} (from the ${t.plugin} plugin)`"
            @click="appearance.select(t.id)"
          >
            <span class="swatch" :style="preview(t).card">
              <span class="mini-panel" :style="preview(t).panel"><span class="mini-accent" :style="preview(t).accent" /></span>
            </span>
            <span class="name">{{ t.name }}</span>
            <span class="kind">{{ t.kind ? (t.kind === 'dark' ? 'Dark' : 'Light') : 'Follows your OS' }}{{ t.background ? ' · picture' : '' }}</span>
          </button>
        </li>
      </ul>

      <h2>Effects</h2>
      <label class="option">
        <input
          type="checkbox"
          data-testid="reduce-effects"
          :checked="appearance.reduceEffects === true"
          @change="appearance.setReduceEffects(($event.target as HTMLInputElement).checked)"
        />
        <span>
          Reduce effects
          <small>Turns off blur behind see-through panels. Blur can be slow where the system draws without a graphics card.</small>
          <small v-if="probe">Measured here: {{ probe.p95 }} ms a frame with blur (over 25 ms turns it off by default).</small>
          <small v-else-if="usesBlur && appearance.probing">Measuring how fast blur draws here…</small>
        </span>
      </label>

      <p class="hint">Plugins can add themes: a JSON file with colors and a picture is enough. See the README.</p>
    </div>
  </section>
</template>

<style scoped>
.appearance { flex: 1; min-height: 0; display: flex; flex-direction: column; font-size: 13px; }
.scroll { flex: 1; min-height: 0; overflow: auto; padding: 4px 12px 16px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--tk-text-muted); margin: 14px 0 8px; }
.themes { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.card { width: 100%; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 6px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius); background: var(--tk-surface); text-align: left; }
.card[aria-checked='true'] { border-color: var(--tk-accent); box-shadow: 0 0 0 1px var(--tk-accent); }
.swatch { position: relative; height: 70px; border-radius: var(--tk-radius-sm); overflow: hidden; border: 1px solid var(--tk-border); }
.mini-panel { position: absolute; left: 10px; right: 30px; top: 12px; bottom: 12px; border-radius: 4px; }
.mini-accent { position: absolute; right: 8px; bottom: 8px; width: 28px; height: 8px; border-radius: 3px; }
.name { font-weight: 600; }
.kind { color: var(--tk-text-muted); font-size: 12px; }
.option { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.option input { margin-top: 3px; accent-color: var(--tk-accent); }
.option small { display: block; color: var(--tk-text-muted); font-size: 12px; }
.hint { margin-top: 18px; color: var(--tk-text-muted); font-size: 12px; }
</style>
