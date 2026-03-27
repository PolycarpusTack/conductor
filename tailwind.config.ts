import type { Config } from "tailwindcss"
import tailwindcssAnimate from "tailwindcss-animate"

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        'xs': '480px',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'IBM Plex Sans', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        heading: ['var(--font-head)', 'Space Grotesk', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--primary-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        chart: {
          '1': 'var(--chart-1)',
          '2': 'var(--chart-2)',
          '3': 'var(--chart-3)',
          '4': 'var(--chart-4)',
          '5': 'var(--chart-5)',
        },
        /* Mediagenix AIR extended palette */
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        cobalt: {
          DEFAULT: 'var(--cobalt, #3805E3)',
          mid: 'var(--cobalt-mid, #5B33F0)',
        },
        neon: 'var(--neon-green, #B3FC4F)',
        mauve: 'var(--mauve, #B8AFDA)',
        op: {
          amber: 'var(--op-amber, #F59E0B)',
          teal: 'var(--op-teal, #2DD4BF)',
          red: 'var(--op-red, #F87171)',
          blue: 'var(--op-blue, #60A5FA)',
          purple: 'var(--op-purple, #A78BFA)',
          green: 'var(--op-green, #4ADE80)',
        },
        live: 'var(--live-red, #E63946)',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '10px',
        xl: '14px',
      },
      boxShadow: {
        'dark-sm': '0 2px 8px rgba(0,0,0,0.3)',
        'dark-md': '0 4px 20px rgba(0,0,0,0.4)',
        'dark-lg': '0 8px 40px rgba(0,0,0,0.5)',
        'dark-xl': '0 24px 64px rgba(0,0,0,0.6)',
        'glow-cobalt': '0 0 20px rgba(56, 5, 227, 0.3), 0 0 40px rgba(56, 5, 227, 0.1)',
        'glow-teal': '0 0 20px rgba(45, 212, 191, 0.3), 0 0 40px rgba(45, 212, 191, 0.1)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.3), 0 0 40px rgba(245, 158, 11, 0.1)',
        'glow-neon': '0 0 20px rgba(179, 252, 79, 0.3), 0 0 40px rgba(179, 252, 79, 0.1)',
        'glow-live': '0 0 20px rgba(230, 57, 70, 0.4), 0 0 40px rgba(230, 57, 70, 0.2)',
      },
      fontSize: {
        'xs': '0.694rem',    /* ~11px */
        'sm': '0.833rem',    /* ~13px */
        'base': '1rem',      /* 16px  */
        'lg': '1.2rem',      /* ~19px */
        'xl': '1.44rem',     /* ~23px */
        '2xl': '1.728rem',   /* ~28px */
        '3xl': '2.074rem',   /* ~33px */
        '4xl': '2.488rem',   /* ~40px */
        '5xl': '2.986rem',   /* ~48px */
      },
      transitionTimingFunction: {
        'air': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'air-out': 'cubic-bezier(0, 0, 0.2, 1)',
        'air-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      transitionDuration: {
        'fast': '150ms',
        'normal': '200ms',
        'slow': '300ms',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
export default config
