// Window-level UI state that isn't any store's business: whether the command palette is open.
import { reactive } from 'vue'

export const ui = reactive({ paletteOpen: false })
