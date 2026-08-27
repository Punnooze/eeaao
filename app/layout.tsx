import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Everything Everywhere All at Once',
  description:
    'A log-scale descent from the heliosphere to the ground — solar wind, close approaches, '
    + 'satellites and surface events, each at the scale where it lives.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#05060a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@1,6..96,900&family=Barlow+Condensed:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        {children}
        <div id="scan" aria-hidden="true" />
        <div id="vig" aria-hidden="true" />
      </body>
    </html>
  );
}
