import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_PINS, useRail } from '../src/stores/rail'
import { useSettings } from '../src/stores/settings'

describe('rail', () => {
  let rail: ReturnType<typeof useRail>
  let settings: ReturnType<typeof useSettings>
  beforeEach(() => {
    setActivePinia(createPinia())
    rail = useRail()
    settings = useSettings()
  })

  test('starts expanded with the default pins', () => {
    expect(rail.pins).toEqual(DEFAULT_PINS)
    expect(rail.collapsed).toBe(false)
  })

  test('pinning adds to the end once; unpinning removes; both are saved', () => {
    rail.pin('notes.panel')
    rail.pin('notes.panel')
    rail.togglePin('files')
    expect(rail.pins).toEqual(['chat', 'chats', 'editor', 'terminal', 'console', 'notes.panel'])
    expect(settings.data.app?.['rail.pins']).toEqual(rail.pins)
    rail.togglePin('files')
    expect(rail.isPinned('files')).toBe(true)
  })

  test('unpinning everything stays empty', () => {
    for (const id of DEFAULT_PINS) rail.unpin(id)
    expect(rail.pins).toEqual([])
  })

  test('collapsing is remembered', () => {
    rail.toggleCollapsed()
    expect([rail.collapsed, settings.data.app?.['rail.collapsed']]).toEqual([true, true])
    rail.toggleCollapsed()
    expect(rail.collapsed).toBe(false)
  })

  test('hand-edited nonsense in settings.json is ignored', () => {
    settings.data = { app: { 'rail.pins': 'chat', 'rail.collapsed': 'yes' } }
    expect(rail.pins).toEqual(DEFAULT_PINS)
    expect(rail.collapsed).toBe(false)
    settings.data = { app: { 'rail.pins': ['chat', 7, null] } }
    expect(rail.pins).toEqual(['chat'])
  })
})
