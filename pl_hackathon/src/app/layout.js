export const metadata = {
  title: 'PromiseLedger — AI-Powered Political Accountability',
  description: 'Record political promises, verify they were actually said, and track whether they were ever kept. Powered by Anthropic Claude AI.',
  keywords: 'political accountability, promise tracker, AI fact-check, Claude AI',
  openGraph: {
    title: 'PromiseLedger — Track Political Promises with AI',
    description: 'Record promises. Verify them. Track if they were kept.',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,400&family=Nunito:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
