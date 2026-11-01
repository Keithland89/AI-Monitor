export const COLOR = {
  licensed: '#4b47c2',
  unlicensed: '#a8682b',
  agent: '#2f7a72',
  neutral: '#4b4f6b',
}

/** Categorical palette for series without a fixed meaning. */
export const PALETTE = ['#4b47c2', '#2f7a72', '#a8682b', '#6b93b3', '#9c5a7c', '#7a68ad', '#7b8794', '#6f7d48']

export const RISK_COLOR: Record<string, string> = {
  High: '#b0382c',
  Medium: '#a8682b',
  Low: '#a3a6dd',
}

export const ACTIVITY_COLOR: Record<string, string> = {
  'Active (7d)': '#2c2a6e',
  'Active (30d)': '#4b47c2',
  'Idle (90d)': '#a8682b',
  'Dormant (90d+)': '#7b8794',
  'No usage signal': '#b8c1cc',
}

export const LIFECYCLE_COLOR: Record<string, string> = {
  New: '#6b93b3',
  Active: '#4b47c2',
  Idle: '#a8682b',
  Dormant: '#7b8794',
  'Never used': '#b8c1cc',
  'No usage signal': '#dde2e8',
}

export const VERDICT_COLOR: Record<string, string> = {
  Keep: '#4b47c2',
  Watch: '#6b93b3',
  Review: '#b0382c',
  Retire: '#7b8794',
}

/** The pale bar colours are too light to read as text, so text uses these darker tones of the same hues (4.5:1 or better on white). */
export const RISK_TEXT: Record<string, string> = { ...RISK_COLOR, Low: '#5f63b8' }
export const LIFECYCLE_TEXT: Record<string, string> = { ...LIFECYCLE_COLOR, New: '#3f6a8c', Dormant: '#5a6573', 'Never used': '#5a6573', 'No usage signal': '#5a6573' }
export const VERDICT_TEXT: Record<string, string> = { ...VERDICT_COLOR, Watch: '#3f6a8c', Retire: '#5a6573' }

export const colorAt = (i: number) => PALETTE[i % PALETTE.length]
