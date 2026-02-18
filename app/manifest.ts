import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Synthszr',
    short_name: 'Synthszr',
    description: 'AI is about Synthesis not Efficiency. The morning news synthesis to start your day.',
    start_url: '/de',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
