import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  Crop,
  Download,
  Film,
  Layers,
  Mail,
  Menu,
  MessageSquare,
  Play,
  Scissors,
  Send,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { ThemeToggle } from '../../components/common/ThemeToggle';
import type { AspectRatioOption, CaptionPresetId } from '../../types/clipora';

interface LandingPageProps {
  onNavigateAuth: (mode: 'signin' | 'register') => void;
  onNavigateAdminAccess?: () => void;
}

type ShowcaseScene = 'podcast' | 'keynote' | 'walkthrough';

const HERO_PRESETS: Array<{
  id: CaptionPresetId;
  label: string;
  sampleLine: string;
  boxClass: string;
  textClass: string;
}> = [
  {
    id: 'modern-bold',
    label: 'Modern Bold',
    sampleLine: 'Focus on the opening hook in the first three seconds.',
    boxClass: 'bg-black/85 text-white border border-white/10',
    textClass: 'font-bold tracking-tight',
  },
  {
    id: 'creator-style',
    label: 'Creator Style',
    sampleLine: 'ONE CLEAR STORY BEATS TEN RUSHED TAKES.',
    boxClass: 'bg-[#161926]/90 text-white border border-purple-500/45',
    textClass: 'font-bold uppercase tracking-wide',
  },
  {
    id: 'karaoke-highlight',
    label: 'Karaoke Highlight',
    sampleLine: 'Edit frame-by-frame right inside your browser.',
    boxClass: 'bg-[#0D0F17]/90 text-amber-300 border border-amber-400/35',
    textClass: 'font-semibold',
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    sampleLine: 'Export crisp 1080p vertical clips in MP4.',
    boxClass: 'bg-white text-slate-950 border border-slate-300 shadow-md',
    textClass: 'font-bold',
  },
];

const SHOWCASE_WORKFLOWS: Array<{
  id: string;
  title: string;
  formatTag: string;
  description: string;
  image: string;
  alt: string;
  scene: ShowcaseScene;
  ratio: AspectRatioOption;
  preset: CaptionPresetId;
}> = [
  {
    id: 'podcast-clips',
    title: 'Studio Podcast Highlights',
    formatTag: '9:16 Vertical · Multi-Speaker Reframe',
    description:
      'Isolate sharp Q&A exchanges from long podcast episodes, keep speaker faces centered in vertical 9:16 framing, and export burned-in captions.',
    image: '/src/assets/images/feature_creator_podcast_1795653050205.jpg',
    alt: 'Two podcast hosts recording with studio microphones in a dark-lit suite',
    scene: 'podcast',
    ratio: '9:16',
    preset: 'creator-style',
  },
  {
    id: 'keynote-talks',
    title: 'Keynote & Stage Presentations',
    formatTag: '1:1 Square · Event & Conference Cuts',
    description:
      'Turn full conference talks and panels into focused, standalone topic clips with clean sentence-boundary trims and downloadable SRT/VTT files.',
    image: '/src/assets/images/feature_stage_keynote_1795653050943.jpg',
    alt: 'Speaker presenting on a stage during a conference keynote',
    scene: 'keynote',
    ratio: '1:1',
    preset: 'modern-bold',
  },
  {
    id: 'product-walkthroughs',
    title: 'Founder & Product Walkthroughs',
    formatTag: '16:9 Widescreen · Branded Demos',
    description:
      'Package feature announcements and instructional walkthroughs with custom Brand Kit colors, watermark placement, and crisp 1080p H.264 output.',
    image: '/src/assets/images/showcase_founder_walkthrough_1795724713489.jpg',
    alt: 'Founder recording a camera-and-laptop product walkthrough in a dark charcoal studio',
    scene: 'walkthrough',
    ratio: '16:9',
    preset: 'high-contrast',
  },
  {
    id: 'caption-mastering',
    title: 'Browser-Local Timeline Mastering',
    formatTag: 'FFmpeg.wasm · Non-Destructive Edits',
    description:
      'Inspect audio waveforms, split clips at the exact playhead, adjust subject X/Y offset, and batch-package multiple clips into a single ZIP archive.',
    image: '/src/assets/images/showcase_editing_timeline_1795724712758.jpg',
    alt: 'Calibrated video editing monitor showing multi-track audio and framing guides',
    scene: 'walkthrough',
    ratio: '9:16',
    preset: 'karaoke-highlight',
  },
];

const FAQ_ITEMS = [
  {
    q: 'How does browser-based video rendering work?',
    a: 'REDDOX Clipora AI runs FFmpeg.wasm directly inside your browser so your source footage is trimmed, reframed, and encoded locally without waiting on remote render queues.',
  },
  {
    q: 'Which video formats and URLs are supported?',
    a: 'You can upload MP4, MOV, WebM, AVI, and MKV files supported by your browser, or import direct downloadable video URLs. Third-party social platforms that block direct downloads are not scraped.',
  },
  {
    q: 'Why do new accounts require administrator approval?',
    a: 'Every registration creates a customer profile in PENDING status until an administrator approves access, protecting AI and storage allowances from abuse.',
  },
  {
    q: 'Can I edit captions and aspect ratios manually after AI selection?',
    a: 'Yes. Every AI-selected moment opens in the multi-track editor where you can adjust trim handles, split clips, edit subtitle text and timestamps, reframe 9:16, 16:9, or 1:1 crops, and apply your Brand Kit.',
  },
  {
    q: 'Do you store my video files permanently?',
    a: 'By default, media stays in local browser IndexedDB storage for immediate editing. When Cloudflare R2 is configured by the platform administrator, uploads and exports can be persisted via short-lived presigned URLs.',
  },
];

const SCENE_IMAGE_MAP: Record<ShowcaseScene, string> = {
  podcast: '/src/assets/images/feature_creator_podcast_1795653050205.jpg',
  keynote: '/src/assets/images/feature_stage_keynote_1795653050943.jpg',
  walkthrough: '/src/assets/images/showcase_founder_walkthrough_1795724713489.jpg',
};

const CONTACT_EMAIL = 'reddox528@gmail.com';

export function LandingPage({ onNavigateAuth, onNavigateAdminAccess }: LandingPageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [demoRatio, setDemoRatio] = useState<AspectRatioOption>('9:16');
  const [demoPreset, setDemoPreset] = useState<CaptionPresetId>('modern-bold');
  const [demoScene, setDemoScene] = useState<ShowcaseScene>('podcast');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Contact form state
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactTopic, setContactTopic] = useState('Workspace Access & Onboarding');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSuccessId, setContactSuccessId] = useState<string | null>(null);

  const activePreset = HERO_PRESETS.find((p) => p.id === demoPreset) || HERO_PRESETS[0];
  const sceneImage = SCENE_IMAGE_MAP[demoScene];

  const handleLoadShowcaseIntoPreview = (workflow: (typeof SHOWCASE_WORKFLOWS)[number]) => {
    setDemoScene(workflow.scene);
    setDemoRatio(workflow.ratio);
    setDemoPreset(workflow.preset);
    const heroEl = document.getElementById('studio-preview');
    heroEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    setContactSuccessId(null);

    const trimmedName = contactName.trim();
    const trimmedEmail = contactEmail.trim();
    const trimmedMessage = contactMessage.trim();

    if (trimmedName.length < 2) {
      setContactError('Please enter your name (at least 2 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      setContactError('Please enter a valid email address.');
      return;
    }
    if (trimmedMessage.length < 10) {
      setContactError('Please share a short message (at least 10 characters).');
      return;
    }

    setContactSubmitting(true);
    try {
      const resp = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          topic: contactTopic,
          message: trimmedMessage,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        inquiryId?: string;
        error?: string;
      };
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Unable to send your message right now.');
      }
      setContactSuccessId(data.inquiryId || 'received');
      setContactName('');
      setContactEmail('');
      setContactMessage('');
    } catch (err) {
      setContactError(
        err instanceof Error ? err.message : 'Unable to submit contact inquiry.'
      );
    } finally {
      setContactSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0D0F17] text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-[#24283B] bg-white/90 dark:bg-[#0D0F17]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          <a
            href="#home"
            className="text-base sm:text-lg font-bold tracking-tight text-slate-950 dark:text-white whitespace-nowrap shrink-0 font-display flex items-center gap-2.5"
          >
            <span className="w-7 h-7 rounded-lg bg-purple-600 text-white inline-flex items-center justify-center text-xs font-bold shrink-0">
              R
            </span>
            <span>REDDOX Clipora AI</span>
          </a>

          <nav className="hidden lg:flex items-center gap-8 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a
              href="#home"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors whitespace-nowrap shrink-0"
            >
              Home
            </a>
            <a
              href="#services"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors whitespace-nowrap shrink-0"
            >
              Services
            </a>
            <a
              href="#showcase"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors whitespace-nowrap shrink-0"
            >
              Showcase
            </a>
            <a
              href="#how-it-works"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors whitespace-nowrap shrink-0"
            >
              Process
            </a>
            <a
              href="#contact"
              className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors whitespace-nowrap shrink-0"
            >
              Contact
            </a>
          </nav>

          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => onNavigateAuth('signin')}
              className="hidden sm:inline-flex items-center px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2233] transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onNavigateAuth('register')}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Start Creating
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] text-slate-700 dark:text-slate-200"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#121521] px-4 py-4 space-y-1.5">
            {[
              { href: '#home', label: 'Home' },
              { href: '#services', label: 'Services' },
              { href: '#showcase', label: 'Showcase' },
              { href: '#how-it-works', label: 'Process' },
              { href: '#contact', label: 'Contact' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center min-h-[44px] px-3 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E2233]"
              >
                {item.label}
              </a>
            ))}
            <div className="pt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigateAuth('signin');
                }}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] text-sm font-semibold"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigateAuth('register');
                }}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
              >
                Start Creating
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 1. Hero Section */}
      <section
        id="home"
        className="relative overflow-hidden border-b border-slate-200/80 dark:border-[#24283B] bg-white dark:bg-[#0D0F17] dark:bg-[radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.12),transparent_55%)]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-24 grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-semibold tracking-widest text-purple-600 dark:text-purple-400 uppercase mb-4">
              Create Smarter · Clip Faster · Stand Out
            </p>
            <h1
              className="font-display font-bold tracking-tight text-slate-950 dark:text-white leading-[1.07]"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)', textWrap: 'balance' }}
            >
              Turn long videos into focused clips that hold attention.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              REDDOX Clipora AI combines Gemini moment detection, automatic speech captioning, and browser-based FFmpeg.wasm editing so your team can cut, reframe, and export ready-to-publish MP4s with full editorial control.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3.5">
              <button
                type="button"
                onClick={() => onNavigateAuth('register')}
                className="inline-flex items-center justify-center gap-2 min-h-[46px] px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                Start Creating
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#contact"
                className="inline-flex items-center justify-center gap-2 min-h-[46px] px-6 py-3 rounded-xl border border-slate-300 dark:border-[#2D324A] bg-white dark:bg-[#161926] hover:bg-slate-100 dark:hover:bg-[#1E2233] text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                Contact Studio
              </a>
            </div>

            <div className="mt-9 pt-6 border-t border-slate-200 dark:border-[#24283B] flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Gemini AI Moment Detection</span>
              <span aria-hidden="true">·</span>
              <span>Browser FFmpeg.wasm Rendering</span>
              <span aria-hidden="true">·</span>
              <span>9:16, 16:9 &amp; 1:1 Reframing</span>
            </div>
          </div>

          {/* Interactive Video Clipping Showcase */}
          <div
            id="studio-preview"
            className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-[#24283B] bg-slate-100/70 dark:bg-[#121521] p-4 sm:p-5 flex flex-col justify-between"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-[#24283B]">
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/80 dark:bg-[#1A1E2E]">
                {(['9:16', '16:9', '1:1'] as AspectRatioOption[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setDemoRatio(ratio)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-colors whitespace-nowrap ${
                      demoRatio === ratio
                        ? 'bg-white dark:bg-purple-600 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'podcast', label: 'Podcast' },
                    { id: 'keynote', label: 'Keynote' },
                    { id: 'walkthrough', label: 'Walkthrough' },
                  ] as const
                ).map((scene) => (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => setDemoScene(scene.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                      demoScene === scene.id
                        ? 'border-purple-500/60 text-purple-700 dark:text-purple-300 bg-purple-500/10'
                        : 'border-slate-200 dark:border-[#2A2F45] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {scene.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="my-5 flex items-center justify-center min-h-[300px] bg-[#090B10] rounded-xl overflow-hidden relative p-4 border border-slate-200/50 dark:border-[#1E2233]">
              <div
                className={`relative overflow-hidden rounded-xl border border-white/15 bg-slate-900 transition-all duration-200 ${
                  demoRatio === '9:16'
                    ? 'w-44 aspect-[9/16]'
                    : demoRatio === '1:1'
                    ? 'w-64 aspect-square'
                    : 'w-full max-w-md aspect-video'
                }`}
              >
                <img
                  src={sceneImage}
                  alt="Interactive clip framing and caption preview"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-mono text-white/90 tabular-nums">
                  <span>00:42 — 01:14</span>
                  <span>{demoRatio} MP4</span>
                </div>
                <div className="absolute bottom-3 left-2.5 right-2.5 flex justify-center">
                  <div
                    className={`px-3 py-1.5 rounded-lg text-center text-xs leading-snug ${activePreset.boxClass} ${activePreset.textClass}`}
                  >
                    {activePreset.sampleLine}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-200 dark:border-[#24283B]">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Caption style:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {HERO_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDemoPreset(preset.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      demoPreset === preset.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-200/80 dark:bg-[#1A1E2E] text-slate-700 dark:text-slate-300 hover:bg-slate-300/70 dark:hover:bg-[#23283D]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Platform Architecture & Editorial Control */}
      <section id="about" className="py-16 lg:py-22 border-b border-slate-200/80 dark:border-[#24283B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6">
            <img
              src="/src/assets/images/hero_clipora_studio_1795653051239.jpg"
              alt="REDDOX Clipora AI post-production suite"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full aspect-video object-cover rounded-2xl border border-slate-200 dark:border-[#24283B]"
            />
          </div>
          <div className="lg:col-span-6 space-y-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400">
              Precision Post-Production
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white leading-tight">
              Built for creators who want full editorial control—not black-box guesswork.
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              REDDOX Clipora AI pairs Gemini multimodal transcript and frame analysis with local FFmpeg.wasm video rendering right in your browser. Identify complete stories, customize typography and framing, and export verified MP4 clips without remote render queues.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926]">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">
                  Genuine Timestamp Accuracy
                </p>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Every clip trims directly to real source timecodes with clean sentence boundaries.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926]">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">
                  Browser-First Efficiency
                </p>
                <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Local IndexedDB caching and optional Cloudflare R2 storage keep media workflows fast.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Services / Capabilities Grid */}
      <section
        id="services"
        className="py-16 lg:py-22 border-b border-slate-200/80 dark:border-[#24283B] bg-slate-100/50 dark:bg-[#121521]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-3">
              Core Capabilities
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              End-to-end clipping, captioning, reframing, and export.
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
              Every stage of short-form production lives inside one cohesive workspace.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Marquee Service */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/40">
              <div className="w-11 h-11 rounded-xl bg-purple-600/12 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                01. AI Moment Detection &amp; Quality Scoring
              </h3>
              <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Gemini analyzes your timestamped transcript alongside sampled video frames to detect strong opening hooks, complete explanations, emotional reactions, and clear topic shifts—ranked from 0 to 100 by estimated engagement quality.
              </p>
              <div className="mt-6 grid sm:grid-cols-3 gap-3 text-xs text-slate-700 dark:text-slate-300">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#121521] border border-slate-200/80 dark:border-[#24283B]">
                  Editable min &amp; max clip durations
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#121521] border border-slate-200/80 dark:border-[#24283B]">
                  Hook, topic &amp; selection rationale
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#121521] border border-slate-200/80 dark:border-[#24283B]">
                  Duplicate moment filtering
                </div>
              </div>
            </div>

            {/* Automatic Caption Generation */}
            <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/40 flex flex-col justify-between">
              <div>
                <div className="w-11 h-11 rounded-xl bg-purple-600/12 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5">
                  <Captions className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  02. Automatic Caption Engine
                </h3>
                <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  Transcribe speech, edit subtitle lines and timecodes manually, choose from curated presets, customize colors and placement, and export SRT/VTT or burned-in MP4 captions.
                </p>
              </div>
            </div>

            {/* Smart Video Reframing */}
            <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/40">
              <div className="w-11 h-11 rounded-xl bg-purple-600/12 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5">
                <Crop className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                03. Smart Video Reframing
              </h3>
              <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Convert landscape footage into 9:16 portrait, 1:1 square, or 16:9 widescreen with fill-to-frame, fit-to-frame with background blur, zoom, and manual X/Y subject positioning.
              </p>
            </div>

            {/* Manual Video Editing */}
            <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/40">
              <div className="w-11 h-11 rounded-xl bg-purple-600/12 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5">
                <Sliders className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                04. Multi-Track Video Editor
              </h3>
              <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Fine-tune trim boundaries, split clips at the playhead, adjust volume, apply your Brand Kit watermark, and step backward or forward with full undo/redo history.
              </p>
            </div>

            {/* Supported Export Formats */}
            <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/40">
              <div className="w-11 h-11 rounded-xl bg-purple-600/12 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5">
                <Download className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                05. Verified Export Formats
              </h3>
              <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Export H.264 MP4 clips at 720p or 1080p across 9:16, 16:9, and 1:1 with original audio, muted audio, burned-in captions, or bundled ZIP downloads.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Showcase / Production Workflows */}
      <section id="showcase" className="py-16 lg:py-22 border-b border-slate-200/80 dark:border-[#24283B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-3">
                Production Workflows
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                Built for real video formats across every channel.
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                Preview how REDDOX Clipora AI structures framing, captions, and exports for podcasts, stages, and founder walkthroughs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateAuth('register')}
              className="inline-flex items-center justify-center gap-2 self-start md:self-auto px-4 py-2.5 rounded-xl border border-slate-300 dark:border-[#2D324A] hover:bg-slate-100 dark:hover:bg-[#1E2233] text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Launch Workspace
              <ArrowRight className="w-4 h-4 text-purple-500" />
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
            {SHOWCASE_WORKFLOWS.map((item) => (
              <article
                key={item.id}
                className="group rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] overflow-hidden flex flex-col justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-500/40"
              >
                <div className="aspect-video w-full overflow-hidden bg-[#090B10] border-b border-slate-200 dark:border-[#24283B]">
                  <img
                    src={item.image}
                    alt={item.alt}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </div>
                <div className="p-6 flex-1 flex flex-col justify-between gap-5">
                  <div>
                    <p className="text-xs font-mono font-medium text-purple-600 dark:text-purple-400">
                      {item.formatTag}
                    </p>
                    <h3 className="mt-2 font-display text-xl font-bold text-slate-950 dark:text-white">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-[#24283B] flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleLoadShowcaseIntoPreview(item)}
                      className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Preview Format
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateAuth('register')}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                    >
                      Try in Studio
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 5. How It Works */}
      <section
        id="how-it-works"
        className="py-16 lg:py-22 border-b border-slate-200/80 dark:border-[#24283B] bg-slate-100/50 dark:bg-[#121521]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-3">
              Workflow Pipeline
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              How REDDOX Clipora AI works
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
              From long-form upload to publish-ready vertical clips in four transparent stages.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: '01',
                icon: Film,
                title: 'Upload or Import URL',
                desc: 'Drop an MP4, MOV, WebM, AVI, or MKV file, or validate a direct downloadable video URL.',
              },
              {
                step: '02',
                icon: Layers,
                title: 'Transcribe & Analyze',
                desc: 'Extract audio and key frames locally, transcribe speech or upload SRT/VTT, and detect standout moments with Gemini.',
              },
              {
                step: '03',
                icon: Scissors,
                title: 'Refine in the Editor',
                desc: 'Adjust trim boundaries, reframe the subject, style captions, and apply your Brand Kit watermark.',
              },
              {
                step: '04',
                icon: Play,
                title: 'Render & Export MP4',
                desc: 'Encode verified MP4 clips in 720p or 1080p via FFmpeg.wasm and download individually or as a ZIP archive.',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6"
                >
                  <div className="flex items-center justify-between mb-5">
                    <span className="font-mono text-xs font-semibold text-purple-600 dark:text-purple-400">
                      Step {item.step}
                    </span>
                    <div className="w-8 h-8 rounded-lg bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white">{item.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 6. Benefits + FAQ */}
      <section className="py-16 lg:py-22 border-b border-slate-200/80 dark:border-[#24283B]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-5 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-3">
                Creator Benefits
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                Designed for podcasters, educators, founders, and editing teams.
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                Repurpose interviews, webinars, product walkthroughs, and talks without losing context or sacrificing editorial polish.
              </p>
            </div>

            <div className="space-y-3">
              {[
                'Keep complete thoughts intact with AI-guided hook and boundary selection.',
                'Save reusable Brand Kits with custom logos, colors, fonts, and watermark positions.',
                'Switch seamlessly between 9:16 portrait, 1:1 square, and 16:9 widescreen crops.',
                'Track projects, processing jobs, and export history inside one organized dashboard.',
              ].map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926]"
                >
                  <Check className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {benefit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white mb-6">
              Frequently asked questions
            </h2>
            <div className="divide-y divide-slate-200 dark:divide-[#24283B] border-y border-slate-200 dark:border-[#24283B]">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaq === idx;
                return (
                  <div key={item.q} className="py-4">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between gap-4 text-left font-semibold text-slate-900 dark:text-white py-2"
                    >
                      <span>{item.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 text-purple-500 transition-transform duration-200 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <p className="mt-2 pb-1 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {item.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 7. Contact & Workspace Inquiries */}
      <section
        id="contact"
        className="py-16 lg:py-22 bg-slate-100/50 dark:bg-[#121521]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          <div className="lg:col-span-5 space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-3">
                Direct Contact
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
                Questions about access, custom workflows, or team onboarding?
              </h2>
              <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                Send an inquiry directly through the form or reach the studio via email. You can also register immediately to request workspace approval.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-5">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-purple-600/12 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Studio Email
                  </p>
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('REDDOX Clipora AI Inquiry')}`}
                    className="mt-1 block text-sm font-semibold text-slate-950 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 break-all"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-[#24283B] flex flex-col sm:flex-row gap-3">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('REDDOX Clipora AI Inquiry')}`}
                  className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-[#2D324A] hover:bg-slate-100 dark:hover:bg-[#1E2233] text-xs font-semibold transition-colors"
                >
                  <Mail className="w-4 h-4 text-purple-500" />
                  Email Us Directly
                </a>
                <button
                  type="button"
                  onClick={() => onNavigateAuth('register')}
                  className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition-colors"
                >
                  Request Account
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <form
              onSubmit={handleContactSubmit}
              noValidate
              className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 sm:p-8 space-y-5"
            >
              <div>
                <h3 className="font-display text-xl font-bold text-slate-950 dark:text-white">
                  Send a message
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  All fields are validated before submission and stored securely.
                </p>
              </div>

              {contactError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{contactError}</span>
                </div>
              )}

              {contactSuccessId && (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Inquiry received (Ref:{' '}
                    <span className="font-mono font-semibold">{contactSuccessId}</span>). We will follow up via email at your address.
                  </span>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="contact-name"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Full Name
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="contact-email"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                  >
                    Email Address
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="you@studio.com"
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="contact-topic"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Inquiry Topic
                </label>
                <select
                  id="contact-topic"
                  value={contactTopic}
                  onChange={(e) => setContactTopic(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="Workspace Access & Onboarding">
                    Workspace Access &amp; Onboarding
                  </option>
                  <option value="Agency & Team Production Workflow">
                    Agency &amp; Team Production Workflow
                  </option>
                  <option value="Technical Support">Technical Support</option>
                  <option value="General Inquiry">General Inquiry</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="contact-message"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Message
                </label>
                <textarea
                  id="contact-message"
                  rows={4}
                  required
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="Tell us about your video workflow, volume, or question..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-[#2A2F45] bg-white dark:bg-[#0D0F17] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Direct email: {CONTACT_EMAIL}
                </span>
                <button
                  type="submit"
                  disabled={contactSubmitting}
                  className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  <Send className="w-4 h-4" />
                  {contactSubmitting ? 'Sending...' : 'Send Message'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="border-t border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#0A0C12] text-slate-600 dark:text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid sm:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-purple-600 text-white inline-flex items-center justify-center text-xs font-bold shrink-0">
                R
              </span>
              <span className="font-display font-bold text-slate-950 dark:text-white text-base">
                REDDOX Clipora AI
              </span>
            </div>
            <p className="text-xs leading-relaxed max-w-sm">
              AI-assisted video clipping, automatic speech captioning, smart aspect-ratio reframing, and local FFmpeg.wasm post-production inside one studio workspace.
            </p>
            <p className="text-xs pt-1">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-purple-600 dark:text-purple-400 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          <div className="lg:col-span-2 space-y-2.5 text-xs">
            <p className="font-semibold text-slate-900 dark:text-white uppercase tracking-wider text-[11px]">
              Navigation
            </p>
            <ul className="space-y-2">
              <li>
                <a href="#home" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Home
                </a>
              </li>
              <li>
                <a href="#services" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Services
                </a>
              </li>
              <li>
                <a href="#showcase" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Showcase
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Process
                </a>
              </li>
              <li>
                <a href="#contact" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-3 space-y-2.5 text-xs">
            <p className="font-semibold text-slate-900 dark:text-white uppercase tracking-wider text-[11px]">
              Capabilities
            </p>
            <ul className="space-y-2">
              <li>
                <a href="#services" className="hover:text-purple-600 dark:hover:text-purple-400">
                  AI Moment Detection
                </a>
              </li>
              <li>
                <a href="#services" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Automatic Caption Engine
                </a>
              </li>
              <li>
                <a href="#services" className="hover:text-purple-600 dark:hover:text-purple-400">
                  9:16, 1:1 &amp; 16:9 Reframing
                </a>
              </li>
              <li>
                <a href="#services" className="hover:text-purple-600 dark:hover:text-purple-400">
                  Multi-Track Browser Editor
                </a>
              </li>
              <li>
                <a href="#services" className="hover:text-purple-600 dark:hover:text-purple-400">
                  1080p MP4 &amp; ZIP Exports
                </a>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-2 space-y-2.5 text-xs">
            <p className="font-semibold text-slate-900 dark:text-white uppercase tracking-wider text-[11px]">
              Workspace
            </p>
            <ul className="space-y-2">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateAuth('signin')}
                  className="hover:text-purple-600 dark:hover:text-purple-400"
                >
                  Sign In
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateAuth('register')}
                  className="hover:text-purple-600 dark:hover:text-purple-400"
                >
                  Request Access
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-[#24283B] py-5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <p>© {new Date().getFullYear()} REDDOX Clipora AI. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <span>Create Smarter. Clip Faster. Stand Out.</span>
              <a
                href="/secure-control-panel"
                onClick={(e) => {
                  if (onNavigateAdminAccess) {
                    e.preventDefault();
                    onNavigateAdminAccess();
                  }
                }}
                aria-label="Admin Access"
                className="pl-3 border-l border-slate-200 dark:border-[#24283B] text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Admin Access
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
