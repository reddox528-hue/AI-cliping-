import { useState } from 'react';
import {
  ArrowRight,
  Captions,
  Check,
  ChevronDown,
  Crop,
  Download,
  Film,
  Layers,
  Menu,
  Play,
  Scissors,
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
    sampleLine: 'Focus on the hook in the first three seconds.',
    boxClass: 'bg-slate-950/85 text-white border border-white/10',
    textClass: 'font-bold tracking-tight',
  },
  {
    id: 'creator-style',
    label: 'Creator Style',
    sampleLine: 'ONE CLEAR STORY BEATS TEN RUSHED TAKES.',
    boxClass: 'bg-slate-900/75 text-white border border-purple-500/40',
    textClass: 'font-bold uppercase tracking-wide',
  },
  {
    id: 'karaoke-highlight',
    label: 'Karaoke Highlight',
    sampleLine: 'Edit frame-by-frame right inside your browser.',
    boxClass: 'bg-[#090D16]/90 text-amber-300 border border-amber-400/30',
    textClass: 'font-semibold',
  },
  {
    id: 'high-contrast',
    label: 'High Contrast',
    sampleLine: 'Export clean 1080p vertical clips in MP4.',
    boxClass: 'bg-white text-slate-950 border border-slate-300 shadow-md',
    textClass: 'font-bold',
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
    a: 'Every registration creates a customer profile in PENDING status until an administrator approves access, protecting free-tier AI and storage allowances from abuse.',
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

export function LandingPage({ onNavigateAuth, onNavigateAdminAccess }: LandingPageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [demoRatio, setDemoRatio] = useState<AspectRatioOption>('9:16');
  const [demoPreset, setDemoPreset] = useState<CaptionPresetId>('modern-bold');
  const [demoScene, setDemoScene] = useState<'podcast' | 'keynote'>('podcast');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const activePreset = HERO_PRESETS.find((p) => p.id === demoPreset) || HERO_PRESETS[0];
  const sceneImage =
    demoScene === 'podcast'
      ? '/src/assets/images/feature_creator_podcast_1795653050205.jpg'
      : '/src/assets/images/feature_stage_keynote_1795653050943.jpg';

  return (
    <div className="min-h-screen bg-white dark:bg-[#070B14] text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-[#070B14]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          <a
            href="#home"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 font-display"
          >
            REDDOX Clipora AI
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#home" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0">
              Home
            </a>
            <a href="#features" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#about" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0">
              About
            </a>
            <button
              type="button"
              onClick={() => onNavigateAuth('signin')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => onNavigateAuth('register')}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Get Started
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B101D] px-4 py-4 space-y-3">
            <a href="#home" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium py-1.5">
              Home
            </a>
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium py-1.5">
              Features
            </a>
            <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium py-1.5">
              How It Works
            </a>
            <a href="#about" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium py-1.5">
              About
            </a>
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigateAuth('signin')}
                className="flex-1 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-semibold"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => onNavigateAuth('register')}
                className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold"
              >
                Get Started
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 1. Hero Section */}
      <section id="home" className="relative overflow-hidden border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 grid lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-semibold tracking-wider text-blue-600 dark:text-blue-400 uppercase mb-4">
              Create Smarter · Clip Faster · Stand Out
            </p>
            <h1
              className="font-display font-bold tracking-tight text-slate-950 dark:text-white leading-[1.06]"
              style={{ fontSize: 'clamp(2.2rem, 3.8vw, 3.55rem)', textWrap: 'balance' }}
            >
              TURN LONG VIDEOS INTO CONTENT THAT GETS NOTICED.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              Discover powerful moments, create engaging short videos and transform your content with AI-powered clipping and professional editing tools.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigateAuth('register')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                Start Creating
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#features"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                Explore Features
              </a>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Gemini AI Moment Detection</span>
              <span aria-hidden="true">·</span>
              <span>Browser FFmpeg.wasm Rendering</span>
              <span aria-hidden="true">·</span>
              <span>9:16, 16:9 &amp; 1:1 Reframing</span>
            </div>
          </div>

          {/* Interactive Video Clipping Showcase */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D1322] p-4 sm:p-5 flex flex-col justify-between">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-200/70 dark:bg-slate-900">
                {(['9:16', '16:9', '1:1'] as AspectRatioOption[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setDemoRatio(ratio)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold tabular-nums transition-colors whitespace-nowrap ${
                      demoRatio === ratio
                        ? 'bg-white dark:bg-blue-600 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDemoScene('podcast')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    demoScene === 'podcast'
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Studio Podcast
                </button>
                <button
                  type="button"
                  onClick={() => setDemoScene('keynote')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    demoScene === 'keynote'
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-500/10'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Keynote Stage
                </button>
              </div>
            </div>

            <div className="my-5 flex items-center justify-center min-h-[290px] bg-slate-950 rounded-xl overflow-hidden relative p-4">
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
                  alt="Interactive clip preview frame"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25" />
                <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-mono text-white/90">
                  <span>00:42 — 01:14</span>
                  <span>Score 88/100</span>
                </div>
                <div className="absolute bottom-3 left-2.5 right-2.5 flex justify-center">
                  <div className={`px-3 py-1.5 rounded-lg text-center text-xs leading-snug ${activePreset.boxClass} ${activePreset.textClass}`}>
                    {activePreset.sampleLine}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">Caption style preview:</span>
              <div className="flex flex-wrap gap-1.5">
                {HERO_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setDemoPreset(preset.id)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      demoPreset === preset.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300/70 dark:hover:bg-slate-700'
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

      {/* 2. Platform Introduction */}
      <section id="about" className="py-16 lg:py-20 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6">
            <img
              src="/src/assets/images/hero_clipora_studio_1795653051239.jpg"
              alt="REDDOX Clipora AI post-production suite"
              referrerPolicy="no-referrer"
              className="w-full aspect-video object-cover rounded-2xl border border-slate-200 dark:border-slate-800"
            />
          </div>
          <div className="lg:col-span-6 space-y-5">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              Built for creators who want full editorial control—not black-box guesswork.
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              REDDOX Clipora AI pairs Gemini multimodal transcript and frame analysis with local FFmpeg.wasm video rendering right in your browser. Identify complete stories, customize typography and framing, and export verified MP4 clips without expensive server render queues.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0D1322]">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">Genuine Timestamp Accuracy</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Every clip trims directly to real source timecodes with clean sentence boundaries.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0D1322]">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">Browser-First Efficiency</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Local IndexedDB caching and optional Cloudflare R2 storage keep media workflows fast.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3, 4, 5, 6, 7. Capabilities Grid (AI Clipping, Captions, Reframing, Manual Editing, Export Formats) */}
      <section id="features" className="py-16 lg:py-20 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-[#0A0F1C]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              End-to-end clipping, captioning, reframing, and export.
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">
              Every stage of short-form production lives inside one cohesive workspace.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* AI Clipping */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 sm:p-7">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">01. AI Moment Detection &amp; Quality Scoring</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Gemini analyzes your timestamped transcript alongside sampled video frames to detect strong opening hooks, complete explanations, emotional reactions, and clear topic shifts—ranked from 0 to 100 by estimated engagement quality.
              </p>
              <div className="mt-5 grid sm:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-300">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800">
                  Editable min &amp; max clip durations
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800">
                  Hook, topic &amp; selection rationale
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800">
                  Duplicate moment filtering
                </div>
              </div>
            </div>

            {/* Automatic Caption Generation */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 sm:p-7">
              <div className="w-10 h-10 rounded-xl bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4">
                <Captions className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">02. Automatic Caption Engine</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Transcribe speech, edit subtitle lines and timecodes manually, choose from six presets, customize colors and placement, and export SRT/VTT or burned-in MP4 captions.
              </p>
            </div>

            {/* Smart Video Reframing */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 sm:p-7">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
                <Crop className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">03. Smart Video Reframing</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Convert landscape footage into 9:16 portrait, 1:1 square, or 16:9 widescreen with fill-to-frame, fit-to-frame with background blur, zoom, and manual X/Y subject positioning.
              </p>
            </div>

            {/* Manual Video Editing */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 sm:p-7">
              <div className="w-10 h-10 rounded-xl bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-4">
                <Sliders className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">04. Multi-Track Video Editor</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Fine-tune trim boundaries, split clips at the playhead, adjust volume, apply your Brand Kit watermark, and step backward or forward with full undo/redo history.
              </p>
            </div>

            {/* Supported Export Formats */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6 sm:p-7">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
                <Download className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">05. Verified Export Formats</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Export H.264 MP4 clips at 720p or 1080p across 9:16, 16:9, and 1:1 with original audio, muted audio, burned-in captions, or bundled ZIP downloads.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 8. How It Works */}
      <section id="how-it-works" className="py-16 lg:py-20 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-12">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              How REDDOX Clipora AI works
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">
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
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424] p-6"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                      Step {item.step}
                    </span>
                    <Icon className="w-4 h-4 text-slate-400" />
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

      {/* 9. Benefits for Content Creators */}
      <section className="py-16 lg:py-20 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-[#0A0F1C]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
              Designed for podcasters, educators, founders, and editing teams.
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300 leading-relaxed">
              Repurpose interviews, webinars, product walkthroughs, and talks without losing context or sacrificing editorial polish.
            </p>
          </div>
          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-4">
            {[
              'Keep complete thoughts intact with AI-guided hook and boundary selection.',
              'Save reusable Brand Kits with custom logos, colors, fonts, and watermark positions.',
              'Switch seamlessly between 9:16 portrait, 1:1 square, and 16:9 widescreen crops.',
              'Track projects, processing jobs, and export history inside one organized dashboard.',
            ].map((benefit) => (
              <div
                key={benefit}
                className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0E1424]"
              >
                <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {benefit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10. FAQ */}
      <section className="py-16 lg:py-20 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-white text-center mb-10">
            Frequently asked questions
          </h2>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div key={item.q} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left font-semibold text-slate-900 dark:text-white py-1"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-2.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 11. Final CTA */}
      <section className="py-16 lg:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-slate-950 dark:text-white">
            Ready to turn long-form footage into focused short clips?
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
            Create your account to request workspace access or sign in to continue editing your projects.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <button
              type="button"
              onClick={() => onNavigateAuth('register')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
            >
              Start Creating
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateAuth('signin')}
              className="px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition-colors"
            >
              Sign In
            </button>
          </div>
        </div>
      </section>

      {/* 12. Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 bg-slate-50 dark:bg-[#060911]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-slate-900 dark:text-white text-sm">
              REDDOX Clipora AI
            </span>
            <span aria-hidden="true">·</span>
            <span>Create Smarter. Clip Faster. Stand Out.</span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-5 w-full sm:w-auto">
            <a href="#features" className="hover:text-slate-900 dark:hover:text-white">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-slate-900 dark:hover:text-white">
              How It Works
            </a>
            <button
              type="button"
              onClick={() => onNavigateAuth('signin')}
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Sign In
            </button>
            <a
              href="/secure-control-panel"
              onClick={(e) => {
                if (onNavigateAdminAccess) {
                  e.preventDefault();
                  onNavigateAdminAccess();
                }
              }}
              aria-label="Admin Access"
              className="ml-auto sm:ml-2 pl-3 border-l border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Admin Access
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
