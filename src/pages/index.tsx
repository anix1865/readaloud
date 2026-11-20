/**
 * Landing page: static and prerendered (no auth fetch, no WebSocket).
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const steps = [
  ['Record 10 seconds', 'Read a sentence or two aloud, or upload a clip. It stays private to your account.'],
  ['Paste a link', 'Readaloud pulls the article text and strips menus, ads and markup.'],
  ['Listen', 'The article comes back as an MP3 narrated in your voice, watermarked as AI-generated.'],
] as const

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <span className="font-serif text-lg">Readaloud</span>
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </header>

        <main className="mx-auto max-w-5xl px-6 pb-24 pt-16 sm:pt-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-[var(--color-ring)]" /> On air
          </p>
          <h1 className="mt-6 max-w-3xl font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
            Your reading list, read to you in your own voice.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Paste an article and record a short voice sample. Readaloud turns the article into audio you can play on a walk, on
            your commute, or while you cook.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link to="/home" className="inline-flex items-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Make your first episode
            </Link>
            <span className="text-sm text-muted-foreground">Free while in preview · 3 episodes a day</span>
          </div>

          <ol className="mt-24 grid gap-6 sm:grid-cols-3">
            {steps.map(([title, body], i) => (
              <li key={title} className="rounded-xl border border-border bg-card p-5">
                <span className="font-serif text-2xl text-[var(--color-ring)]">{i + 1}</span>
                <h2 className="mt-3 font-medium">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>

          <p className="mt-16 max-w-2xl text-sm text-muted-foreground">
            Clone only your own voice or a voice you have permission to use. Every episode is synthesized with Resemble AI’s
            Chatterbox, which embeds an inaudible watermark identifying the audio as AI-generated. You can delete your voice
            sample at any time.
          </p>
        </main>
      </div>
    </>
  )
}
