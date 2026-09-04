import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        xs: '480px',
      },
      colors: {
        discord: {
          bg: '#111214',
          surface: '#18191C',
          elevated: '#202225',
          hover: '#2B2D31',
          input: '#111214',
          'border-subtle': '#2B2D31',
          border: '#3A3D42',
          'border-strong': '#4A4D52',
          text: '#F2F3F5',
          secondary: '#B5BAC1',
          muted: '#949BA4',
        },
        spotify: {
          green: '#1ED760',
          hover: '#1DB954',
          dark: '#0F291B',
          border: '#1A7F3C',
          light: '#F0FDF4',
          'light-border': '#86EFAC',
          'light-text': '#15803D',
          action: '#16A34A',
        },
        light: {
          bg: '#F3F4F6',
          surface: '#FFFFFF',
          elevated: '#FFFFFF',
          sub: '#F8F9FA',
          input: '#FFFFFF',
          'border-subtle': '#E5E7EB',
          border: '#D1D5DB',
          'border-strong': '#9CA3AF',
          text: '#111827',
          secondary: '#374151',
          muted: '#6B7280',
        },
        industrial: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#949BA4',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        steel: {
          50: '#f4f6f8',
          100: '#e8ecf0',
          500: '#4a6b82',
          700: '#2c4253',
          900: '#182530',
        },
        safety: {
          amber: '#d97706',
          orange: '#ea580c',
          blue: '#2563eb',
          green: '#16a34a',
          red: '#dc2626',
        }
      },
      boxShadow: {
        'green-glow': '0 0 0 1px rgba(30, 215, 96, 0.20), 0 0 18px rgba(30, 215, 96, 0.08)',
        'green-focus': '0 0 0 2px rgba(30, 215, 96, 0.40)',
      }
    },
  },
  plugins: [],
};
export default config;