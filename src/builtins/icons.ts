// SVG path data (24x24, drawn as lines) for Tinkr's own panels and window buttons.
// Plugins write their icons the same way (see `icon` in src/plugins/api.ts).

export const PANEL_ICONS = {
  chat: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  chats: 'M21 12a8 8 0 0 1-11.5 7.2L4 20.5l1.4-4.8A8 8 0 1 1 21 12z',
  files: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z',
  editor: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  console: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  plugins: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  appearance: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM12 3.5v17',
} as const

export const UI_ICONS = {
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  collapseLeft: 'M13 6l-6 6 6 6M19 6l-6 6 6 6',
  rail: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16',
  layout: 'M3 3h8v18H3zM14 3h7v8h-7zM14 14h7v7h-7z',
  attach: 'M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M8 8h8v8H8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const
