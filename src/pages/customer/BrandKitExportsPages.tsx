import React, { useState } from 'react';
import { Download, KeyRound, Palette, PlusCircle, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { CAPTION_PRESETS } from '../../services/captions/captionPresets';
import {
  deleteBrandKit,
  makeId,
  saveBrandKit,
  updateOwnProfile,
} from '../../services/data/workspaceService';
import { resolveMediaBlob } from '../../services/storage/localMediaStore';
import { triggerBlobDownload } from '../../services/video/ffmpegEngine';
import {
  DEFAULT_CAPTION_STYLE,
  type BrandKitRecord,
  type CaptionPresetId,
  type ExportRecord,
  type WatermarkConfig,
} from '../../types/clipora';

export function BrandKitPage({
  brandKits,
  onReload,
}: {
  brandKits: BrandKitRecord[];
  onReload: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const { notify } = useToast();

  const [name, setName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7C3AED');
  const [secondaryColor, setSecondaryColor] = useState('#A855F7');
  const [preset, setPreset] = useState<CaptionPresetId>('modern-bold');
  const [watermarkText, setWatermarkText] = useState('NEXORATECH Clipora AI');
  const [watermarkPos, setWatermarkPos] = useState<WatermarkConfig['position']>('bottom-right');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BrandKitRecord | null>(null);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      notify('error', 'Logo file too large', 'Use a PNG/JPG/SVG under 300 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setLogoDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !name.trim()) return;
    setSaving(true);
    try {
      const presetObj = CAPTION_PRESETS.find((p) => p.id === preset)?.config || DEFAULT_CAPTION_STYLE;
      await saveBrandKit(
        {
          brandKitId: makeId('kit'),
          ownerId: profile.uid,
          name: name.trim(),
          logoPath: logoDataUrl.slice(0, 900) ? 'local://logo' : '',
          primaryColor,
          secondaryColor,
          captionSettings: { ...presetObj, highlightColor: primaryColor },
          watermarkSettings: {
            enabled: true,
            text: watermarkText.trim(),
            logoDataUrl: logoDataUrl.length < 900 ? logoDataUrl : undefined,
            position: watermarkPos,
            opacity: 0.8,
          },
        },
        true
      );
      setName('');
      await onReload();
      notify('success', 'Brand Kit saved');
    } catch (err) {
      notify('error', 'Failed to save Brand Kit', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteBrandKit(deleteTarget.brandKitId);
    setDeleteTarget(null);
    await onReload();
    notify('success', 'Brand Kit deleted');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
          Brand Kit
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Create reusable brand colors, caption presets, and watermark placements for your clips.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4"
      >
        <h2 className="font-bold text-base text-slate-900 dark:text-white">New Brand Preset</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5">Brand Kit Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Creator Studio Dark"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Default Caption Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as CaptionPresetId)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {CAPTION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Watermark Position</label>
            <select
              value={watermarkPos}
              onChange={(e) => setWatermarkPos(e.target.value as WatermarkConfig['position'])}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Primary Color</label>
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Secondary Color</label>
            <input
              type="color"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="w-full h-10 rounded-xl border border-slate-300 dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Watermark Text</label>
            <input
              type="text"
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <label className="text-xs font-semibold text-purple-600 dark:text-purple-400 cursor-pointer hover:underline">
            Optional: Upload Brand Logo (PNG/SVG under 300 KB)
            <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
          >
            <PlusCircle className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Brand Kit'}
          </button>
        </div>
      </form>

      {brandKits.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-10 text-center">
          <Palette className="w-7 h-7 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No saved Brand Kits yet.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {brandKits.map((kit) => (
            <div
              key={kit.brandKitId}
              className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-5 flex items-start justify-between gap-3"
            >
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">{kit.name}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Preset: {kit.captionSettings.preset} · Watermark: {kit.watermarkSettings.position}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className="w-5 h-5 rounded-md border border-slate-300 dark:border-slate-700"
                    style={{ backgroundColor: kit.primaryColor }}
                  />
                  <span
                    className="w-5 h-5 rounded-md border border-slate-300 dark:border-slate-700"
                    style={{ backgroundColor: kit.secondaryColor }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(kit)}
                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Brand Kit"
        description={`Remove "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export function ExportHistoryPage({ exportsList }: { exportsList: ExportRecord[] }) {
  const { notify } = useToast();

  const handleDownload = async (exp: ExportRecord) => {
    const blob = await resolveMediaBlob(exp.storagePath, `export_${exp.exportId}`);
    if (!blob) {
      notify('error', 'Export file not found in local cache or remote R2 storage.');
      return;
    }
    triggerBlobDownload(blob, `clipora_${exp.exportId}.mp4`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
          Export History
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Verified MP4 renders with file size, resolution, and direct download access.
        </p>
      </div>

      {exportsList.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-12 text-center">
          <Download className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <p className="text-sm font-semibold">No exports completed yet</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-[#24283B] text-xs text-slate-500">
              <tr>
                <th className="py-3 px-4 font-semibold">Export ID</th>
                <th className="py-3 px-4 font-semibold">Format</th>
                <th className="py-3 px-4 font-semibold">Resolution</th>
                <th className="py-3 px-4 font-semibold">Size</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {exportsList.map((exp) => (
                <tr key={exp.exportId}>
                  <td className="py-3 px-4 font-mono text-xs">{exp.exportId}</td>
                  <td className="py-3 px-4 text-xs">
                    {exp.format} ({exp.aspectRatio})
                  </td>
                  <td className="py-3 px-4 text-xs font-mono">{exp.resolution}</td>
                  <td className="py-3 px-4 text-xs font-mono tabular-nums">
                    {(exp.fileSize / (1024 * 1024)).toFixed(2)} MB
                  </td>
                  <td className="py-3 px-4 text-xs font-mono">{exp.status}</td>
                  <td className="py-3 px-4 text-right">
                    {exp.status === 'COMPLETED' ? (
                      <button
                        type="button"
                        onClick={() => handleDownload(exp)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                    ) : (
                      <span className="text-xs text-red-500">{exp.errorMessage || 'Unavailable'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AccountSettingsPage() {
  const { profile, limits, changePassword, refreshProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const { notify } = useToast();
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      await updateOwnProfile(profile.uid, {
        displayName,
        themePreference: theme,
      });
      await refreshProfile();
      notify('success', 'Account settings updated');
    } catch (err) {
      notify('error', 'Update failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Manage your profile, theme preference, and workspace allowances.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4"
      >
        <div>
          <label className="block text-xs font-semibold mb-1.5">Display Name</label>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5">Email Address</label>
          <input
            type="text"
            disabled
            value={profile?.email || ''}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-[#24283B] bg-slate-100 dark:bg-slate-900/50 text-sm opacity-75"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5">Theme</label>
          <div className="flex gap-2">
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`px-4 py-2 rounded-xl border text-xs font-semibold capitalize ${
                  theme === t
                    ? 'border-purple-600 bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setChangingPw(true);
          try {
            await changePassword(currentPassword, newPassword);
            setCurrentPassword('');
            setNewPassword('');
            notify('success', 'Password updated');
          } catch (err) {
            notify('error', 'Password update failed', err instanceof Error ? err.message : String(err));
          } finally {
            setChangingPw(false);
          }
        }}
        className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="w-4 h-4 text-purple-600" />
          Change Password
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 chars)"
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={changingPw}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
        >
          {changingPw ? 'Updating...' : 'Update Password'}
        </button>
      </form>

      <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6">
        <h2 className="font-bold text-sm mb-3">Platform Allowances</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 flex justify-between">
            <span className="text-slate-500">Max Video File Size</span>
            <span className="font-mono font-semibold">{limits.maxFileSizeMb} MB</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 flex justify-between">
            <span className="text-slate-500">Max Projects</span>
            <span className="font-mono font-semibold">{limits.maxProjectsPerUser}</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 flex justify-between">
            <span className="text-slate-500">Daily AI Requests</span>
            <span className="font-mono font-semibold">{limits.dailyAiRequestAllowance}</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 flex justify-between">
            <span className="text-slate-500">1080p Export</span>
            <span className="font-mono font-semibold">
              {limits.allow1080pExport ? 'Enabled' : '720p max'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HelpSupportPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white">
          Help &amp; Support
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Architecture notes and troubleshooting for browser-based video clipping.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-[#24283B] bg-white dark:bg-[#161926] p-6 space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">Browser FFmpeg Rendering</h2>
          <p className="mt-1 text-xs">
            Video trimming, reframing, and caption overlays run locally inside your browser using FFmpeg.wasm. Keep the browser tab open until the job reaches COMPLETED. Very large 4K files may exceed mobile browser memory limits; 720p/1080p MP4 H.264 sources work fastest.
          </p>
        </div>
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">Direct URL Imports</h2>
          <p className="mt-1 text-xs">
            Direct URL import supports publicly readable or presigned MP4/WebM/MOV streams with CORS access. Third-party platforms that prohibit downloading (YouTube, TikTok, Instagram) are blocked by policy—upload your own legally obtained video file instead.
          </p>
        </div>
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">Transcription &amp; AI Quota</h2>
          <p className="mt-1 text-xs">
            If automatic speech transcription encounters a free-tier rate limit or silent footage, upload an .srt/.vtt file or enter a manual transcript on the Create New Clips screen.
          </p>
        </div>
      </div>
    </div>
  );
}
