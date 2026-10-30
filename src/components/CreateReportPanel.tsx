import React, { useCallback, useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Building2,
  Camera,
  CheckCircle2,
  Crosshair,
  ImagePlus,
  Loader2,
  MapPin,
  Send,
  ShieldCheck,
  ThumbsUp,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AGENCY_LABELS,
  CATEGORY_CATALOG,
  RT_UNITS,
  URGENCY_LABELS,
  VALIDATION_LIMITS,
  type ReportCategory,
  type ReportUrgency,
  type RtUnit,
  type UserPublicProfile,
} from '../types';
import {
  compressImageToDataUrl,
  DEFAULT_RW013_CENTER,
  generateSafeId,
  reverseGeocodeCoordinates,
} from '../utils/geoAndImage';
import { InteractiveMap } from './InteractiveMap';

export interface PrefillReportDraft {
  title?: string;
  description?: string;
  category?: ReportCategory;
  urgency?: ReportUrgency;
  rt?: RtUnit;
  latitude?: number;
  longitude?: number;
}

interface SubmittedSummary {
  id: string;
  title: string;
  rt: RtUnit;
  categoryLabel: string;
  agencyLabel: string;
  slaHours: number;
  address: string;
  coordsLabel: string;
  hasPhoto: boolean;
}

interface CreateReportPanelProps {
  userProfile: UserPublicProfile;
  prefill?: PrefillReportDraft | null;
  onSuccess: () => void;
  onCancel?: () => void;
}

export const CreateReportPanel: React.FC<CreateReportPanelProps> = ({
  userProfile,
  prefill,
  onSuccess,
  onCancel,
}) => {
  const [title, setTitle] = useState(prefill?.title || '');
  const [description, setDescription] = useState(prefill?.description || '');
  const [category, setCategory] = useState<ReportCategory>(
    prefill?.category || 'kesehatan_jentik'
  );
  const [urgency, setUrgency] = useState<ReportUrgency>(prefill?.urgency || 'sedang');
  const [rt, setRt] = useState<RtUnit>(prefill?.rt || userProfile.rt || 'RT 001');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');

  const [coords, setCoords] = useState<{ lat: number; lng: number }>({
    lat: prefill?.latitude ?? DEFAULT_RW013_CENTER.lat,
    lng: prefill?.longitude ?? DEFAULT_RW013_CENTER.lng,
  });
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string>('');
  const [address, setAddress] = useState<string>('Mendeteksi alamat lokasi otomatis...');

  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submittedSummary, setSubmittedSummary] = useState<SubmittedSummary | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const updateAddressFromCoords = useCallback(async (lat: number, lng: number) => {
    const resolved = await reverseGeocodeCoordinates(lat, lng);
    setAddress(resolved);
  }, []);

  const detectCurrentGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocationNotice('Peramban tidak mendukung Geolocation API. Silakan pilih titik pada peta.');
      updateAddressFromCoords(coords.lat, coords.lng);
      return;
    }

    setLocating(true);
    setLocationNotice('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setCoords({ lat, lng });
        setGpsAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
        updateAddressFromCoords(lat, lng);
      },
      (err) => {
        setLocating(false);
        setLocationNotice(
          `GPS otomatis tidak diizinkan (${err.message}). Ketuk peta di bawah untuk mengunci titik presisi.`
        );
        updateAddressFromCoords(coords.lat, coords.lng);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, [coords.lat, coords.lng, updateAddressFromCoords]);

  useEffect(() => {
    if (prefill?.latitude && prefill?.longitude) {
      updateAddressFromCoords(prefill.latitude, prefill.longitude);
    } else {
      detectCurrentGps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMapSelect = (lat: number, lng: number) => {
    const roundedLat = Number(lat.toFixed(6));
    const roundedLng = Number(lng.toFixed(6));
    setCoords({ lat: roundedLat, lng: roundedLng });
    setGpsAccuracy(null);
    updateAddressFromCoords(roundedLat, roundedLng);
  };

  const startLiveCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setCameraError(
        'Kamera langsung tidak dapat diakses. Gunakan tombol Unggah Foto di sebelahnya.'
      );
    }
  };

  const captureFromVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth || 800;
    const height = video.videoHeight || 600;
    const maxSide = 880;
    let outW = width;
    let outH = height;
    if (outW > maxSide || outH > maxSide) {
      if (outW >= outH) {
        outH = Math.round((outH * maxSide) / outW);
        outW = maxSide;
      } else {
        outW = Math.round((outW * maxSide) / outH);
        outH = maxSide;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.74);
    setPhotoDataUrl(dataUrl);
    stopCameraStream();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError('');
    try {
      const compressed = await compressImageToDataUrl(file);
      setPhotoDataUrl(compressed);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal memproses foto kejadian.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanTitle = title.trim().slice(0, VALIDATION_LIMITS.TITLE_MAX);
    const cleanDesc = description.trim().slice(0, VALIDATION_LIMITS.DESC_MAX);
    const cleanAddr = (address.trim() || `Koordinat ${coords.lat}, ${coords.lng}`).slice(
      0,
      VALIDATION_LIMITS.ADDRESS_MAX
    );

    if (cleanTitle.length < VALIDATION_LIMITS.TITLE_MIN) {
      setFormError('Judul laporan minimal 3 karakter.');
      return;
    }
    if (cleanDesc.length < VALIDATION_LIMITS.DESC_MIN) {
      setFormError('Deskripsi kejadian minimal 5 karakter agar petugas dapat menindaklanjuti.');
      return;
    }
    if (photoDataUrl.length > VALIDATION_LIMITS.PHOTO_MAX_CHARS) {
      setFormError('Ukuran foto melebihi batas dokumen. Silakan ambil ulang foto.');
      return;
    }

    setSubmitting(true);
    const reportId = generateSafeId('rep');
    const path = `reports/${reportId}`;
    const catMeta = CATEGORY_CATALOG[category];

    try {
      await setDoc(doc(db, 'reports', reportId), {
        authorId: userProfile.uid,
        authorName: userProfile.displayName.slice(0, VALIDATION_LIMITS.DISPLAY_NAME_MAX),
        title: cleanTitle,
        description: cleanDesc,
        category,
        urgency,
        status: 'menunggu',
        rt,
        rwCode: 'RW013',
        visibility,
        latitude: coords.lat,
        longitude: coords.lng,
        address: cleanAddr,
        photoDataUrl,
        assignedAgency: '',
        adminNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmitting(false);
      setSubmittedSummary({
        id: reportId,
        title: cleanTitle,
        rt,
        categoryLabel: catMeta.shortLabel,
        agencyLabel: AGENCY_LABELS[catMeta.defaultAgency],
        slaHours: catMeta.slaHours,
        address: cleanAddr,
        coordsLabel: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
        hasPhoto: Boolean(photoDataUrl),
      });
    } catch (error) {
      setSubmitting(false);
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const resetForAnotherReport = () => {
    setSubmittedSummary(null);
    setTitle('');
    setDescription('');
    setPhotoDataUrl('');
    setFormError('');
  };

  const activeCategoryMeta = CATEGORY_CATALOG[category];

  // Reference Screen 12: Crisp Off-White Confirmation Screen with Circular Olive ThumbsUp Badge & 3 Square Milestones
  if (submittedSummary) {
    return (
      <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-3xl p-6 text-center space-y-6">
        <div className="pt-3 flex flex-col items-center space-y-4">
          <div className="w-24 h-24 rounded-full border-[3px] border-[#586826] bg-[#e6f2d3]/60 flex items-center justify-center text-[#586826]">
            <ThumbsUp className="w-10 h-10 stroke-[2.2]" />
          </div>

          <div className="space-y-1.5 max-w-sm">
            <h2 className="text-xl font-bold text-[#263015] [text-wrap:balance]">
              Laporan Berhasil Terkirim
            </h2>
            <p className="text-xs text-[#5b6649] leading-relaxed">
              {submittedSummary.categoryLabel} · {submittedSummary.rt} · RW 013
            </p>
          </div>
        </div>

        {/* Clean Olive & Matcha Progress Summary Strip */}
        <div className="bg-[#e6f2d3] border border-[#cbe0b0] rounded-2xl p-4 text-left space-y-2 text-xs">
          <p className="font-semibold text-[#263015] leading-snug">{submittedSummary.title}</p>
          <p className="text-[#5b6649] truncate">{submittedSummary.address}</p>
          <div className="pt-2 border-t border-[#cbe0b0] flex items-center justify-between gap-2 text-[11px] text-[#5b6649]">
            <span className="font-mono">{submittedSummary.coordsLabel}</span>
            <span>SLA {submittedSummary.slaHours} jam</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#cbe0b0] overflow-hidden">
            <div className="w-1/3 h-full rounded-full bg-[#a5cf4c]" />
          </div>
          <p className="text-[11px] text-[#586826] font-medium">
            Rujukan otomatis: {submittedSummary.agencyLabel}
          </p>
        </div>

        {/* 3 Square Olive Milestone Blocks (Reference Screen 12 Bottom Motif) */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-white border border-[#cbe0b0] rounded-2xl p-2.5 flex flex-col items-center space-y-1.5">
            <div className="w-10 h-10 rounded-xl bg-[#586826] text-[#dcecc3] flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-semibold text-[#263015]">01. Terkirim</span>
            <span className="text-[10px] text-[#5b6649]">
              {submittedSummary.hasPhoto ? 'Foto + GPS' : 'Titik GPS'}
            </span>
          </div>

          <div className="bg-white border border-[#cbe0b0] rounded-2xl p-2.5 flex flex-col items-center space-y-1.5">
            <div className="w-10 h-10 rounded-xl bg-[#586826]/85 text-[#dcecc3] flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-semibold text-[#263015]">02. Triase</span>
            <span className="text-[10px] text-[#5b6649]">Verifikasi RW</span>
          </div>

          <div className="bg-white border border-[#cbe0b0] rounded-2xl p-2.5 flex flex-col items-center space-y-1.5">
            <div className="w-10 h-10 rounded-xl bg-[#586826]/70 text-[#dcecc3] flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-semibold text-[#263015]">03. Instansi</span>
            <span className="text-[10px] text-[#5b6649]">Push Status</span>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            onClick={onSuccess}
            className="w-full min-h-[48px] px-5 py-3 text-sm font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer"
          >
            Kembali ke Beranda
          </button>

          <button
            type="button"
            onClick={resetForAnotherReport}
            className="w-full min-h-[44px] px-4 py-2.5 text-xs font-semibold text-[#586826] bg-white border border-[#cbe0b0] rounded-full hover:bg-[#e6f2d3] active:scale-[0.98] transition-all cursor-pointer"
          >
            Kirim Laporan Kejadian Lain
          </button>
        </div>
      </div>
    );
  }

  // Reference Screen 11: Soft Sage Screen with Author Strip + Central 1:1 Square Olive Media Frame
  return (
    <div className="space-y-5">
      {/* Author & Context Header Strip */}
      <div className="flex items-center justify-between gap-3 bg-[#e6f2d3] border border-[#cbe0b0] rounded-2xl p-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-[#586826] text-[#dcecc3] flex items-center justify-center shrink-0">
            <Camera className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#263015] truncate">
              {userProfile.displayName}
            </p>
            <p className="text-xs text-[#5b6649] truncate">
              Pelapor Warga · {rt} · RW 013
            </p>
          </div>
        </div>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Batal membuat laporan"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-[#586826]/10 text-[#586826] hover:bg-[#586826]/20 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {formError && (
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 1. Iconic 1:1 Square Deep Olive Camera / Photo Box (Reference Screen 11) */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-[#263015]">
              Bukti Foto Kejadian Real-Time
            </span>
            <span className="text-[11px] font-mono text-[#5b6649]">Maks 750 KB</span>
          </div>

          {cameraOpen ? (
            <div className="w-full aspect-square max-w-[340px] mx-auto rounded-3xl overflow-hidden bg-[#263015] border-2 border-[#586826] relative flex flex-col">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full flex-1 object-cover bg-black"
              />
              <div className="p-3 bg-[#263015] flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={stopCameraStream}
                  className="min-h-[44px] px-4 text-xs font-medium text-[#dcecc3] border border-[#586826] rounded-full hover:bg-[#586826]/30 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={captureFromVideo}
                  className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 px-4 text-xs font-semibold text-[#263015] bg-[#a5cf4c] rounded-full hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Jepret Foto</span>
                </button>
              </div>
            </div>
          ) : photoDataUrl ? (
            <div className="w-full aspect-square max-w-[340px] mx-auto rounded-3xl overflow-hidden bg-[#586826] border-2 border-[#586826] relative">
              <img
                src={photoDataUrl}
                alt="Pratinjau foto kejadian"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/45 to-transparent flex items-center justify-between gap-2 text-xs text-white">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-[#a5cf4c]" />
                  <span>Siap ({Math.round((photoDataUrl.length * 0.75) / 1024)} KB)</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPhotoDataUrl('')}
                  className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white font-medium cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Ulangi</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full aspect-square max-w-[340px] mx-auto rounded-3xl bg-[#586826] text-[#dcecc3] p-6 flex flex-col items-center justify-between text-center">
              <div className="text-[11px] font-medium text-[#dcecc3]/85">
                Kamera Langsung & Kompresi Cepat
              </div>

              <div className="flex flex-col items-center space-y-3">
                <div className="w-20 h-20 rounded-2xl border-[2.5px] border-[#dcecc3] flex items-center justify-center">
                  <ImagePlus className="w-9 h-9 text-[#dcecc3]" />
                </div>
                <p className="text-xs text-[#dcecc3]/90 max-w-[220px] leading-relaxed">
                  Ambil foto kondisi di sekitar Anda secara langsung atau unggah dari galeri ponsel
                </p>
              </div>

              <div className="w-full grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={startLiveCamera}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#263015] bg-[#dcecc3] rounded-full hover:bg-[#e6f2d3] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
                >
                  <Video className="w-4 h-4" />
                  <span>Buka Kamera</span>
                </button>

                <label className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#f7f9f4] bg-[#48561e] border border-[#dcecc3]/35 rounded-full hover:bg-[#3d4919] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap">
                  <ImagePlus className="w-4 h-4" />
                  <span>Unggah Foto</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {cameraError && (
            <p className="text-xs text-amber-900 bg-amber-100/80 rounded-xl px-3 py-2">
              {cameraError}
            </p>
          )}
        </div>

        {/* 2. Categorization, RT & Urgency Card */}
        <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-3xl p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="report-cat" className="block text-xs font-semibold text-[#263015]">
                Kategori Kejadian
              </label>
              <select
                id="report-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-medium bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              >
                {Object.values(CATEGORY_CATALOG).map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="report-rt" className="block text-xs font-semibold text-[#263015]">
                Wilayah RT (10 RT)
              </label>
              <select
                id="report-rt"
                value={rt}
                onChange={(e) => setRt(e.target.value as RtUnit)}
                className="w-full min-h-[44px] px-3.5 py-2 text-xs font-mono font-medium bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              >
                {RT_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit} · RW 013
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-[#263015] bg-[#e6f2d3] border border-[#cbe0b0] rounded-2xl px-3.5 py-2.5 flex items-center justify-between gap-2">
            <span className="truncate">
              Instansi: <strong>{AGENCY_LABELS[activeCategoryMeta.defaultAgency]}</strong>
            </span>
            <span className="font-mono text-[11px] text-[#586826] shrink-0">
              SLA {activeCategoryMeta.slaHours}j
            </span>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-[#263015]">Tingkat Urgensi</span>
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#e6f2d3] rounded-2xl">
              {(['rendah', 'sedang', 'tinggi', 'darurat'] as ReportUrgency[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setUrgency(lvl)}
                  className={`min-h-[38px] px-2 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                    urgency === lvl
                      ? 'bg-[#586826] text-[#f7f9f4] font-semibold'
                      : 'text-[#5b6649] hover:text-[#263015]'
                  }`}
                >
                  {URGENCY_LABELS[lvl]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-xs font-semibold text-[#263015]">Visibilitas Laporan</span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#e6f2d3] rounded-2xl">
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`min-h-[38px] px-3 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  visibility === 'public'
                    ? 'bg-[#586826] text-[#f7f9f4] font-semibold'
                    : 'text-[#5b6649] hover:text-[#263015]'
                }`}
              >
                Publik Warga RW 013
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`min-h-[38px] px-3 text-xs font-medium rounded-xl transition-colors whitespace-nowrap cursor-pointer ${
                  visibility === 'private'
                    ? 'bg-[#586826] text-[#f7f9f4] font-semibold'
                    : 'text-[#5b6649] hover:text-[#263015]'
                }`}
              >
                Khusus Admin RW
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="report-title" className="text-xs font-semibold text-[#263015]">
                Judul Kejadian
              </label>
              <span className="text-[11px] font-mono text-[#5b6649]">
                {title.length}/{VALIDATION_LIMITS.TITLE_MAX}
              </span>
            </div>
            <input
              id="report-title"
              type="text"
              required
              minLength={VALIDATION_LIMITS.TITLE_MIN}
              maxLength={VALIDATION_LIMITS.TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Genangan saluran & jentik depan Gang 3"
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-[#cbe0b0] rounded-xl text-[#263015] placeholder:text-[#5b6649]/60 focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="report-desc" className="text-xs font-semibold text-[#263015]">
                Kronologi & Patokan Lokasi
              </label>
              <span className="text-[11px] font-mono text-[#5b6649]">
                {description.length}/{VALIDATION_LIMITS.DESC_MAX}
              </span>
            </div>
            <textarea
              id="report-desc"
              rows={3}
              required
              minLength={VALIDATION_LIMITS.DESC_MIN}
              maxLength={VALIDATION_LIMITS.DESC_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Jelaskan kondisi lapangan, patokan nomor rumah/jalan, dan dampak bagi warga..."
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#cbe0b0] rounded-xl text-[#263015] placeholder:text-[#5b6649]/60 focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
          </div>
        </div>

        {/* 3. Automatic Exact GPS & Interactive Map Pin */}
        <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-3xl p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-[#263015]">
                Lokasi Geografis Otomatis (GPS)
              </h3>
              <p className="text-[11px] text-[#5b6649]">
                Ketuk peta untuk menggeser titik presisi kejadian
              </p>
            </div>
            <button
              type="button"
              onClick={detectCurrentGps}
              disabled={locating}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#586826] bg-[#e6f2d3] border border-[#cbe0b0] rounded-full hover:bg-[#dcecc3] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {locating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crosshair className="w-3.5 h-3.5" />
              )}
              <span>{locating ? 'Mencari...' : 'Akurasi GPS'}</span>
            </button>
          </div>

          <InteractiveMap
            center={coords}
            zoom={16}
            heightClass="h-52"
            mode="picker"
            selectedPin={coords}
            onSelectLocation={handleMapSelect}
          />

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-[#5b6649]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[#263015]">
                <MapPin className="w-3.5 h-3.5 text-[#586826]" />
                Titik Koordinat
              </span>
              <span className="font-mono text-[#263015]">
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                {gpsAccuracy !== null ? ` (±${gpsAccuracy}m)` : ''}
              </span>
            </div>

            <div className="space-y-1">
              <label htmlFor="report-address" className="block text-[11px] font-medium text-[#5b6649]">
                Alamat Hasil Deteksi GPS (Dapat Disempurnakan)
              </label>
              <input
                id="report-address"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.ADDRESS_MAX}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              />
            </div>

            {locationNotice && (
              <p className="text-[11px] text-amber-800 leading-relaxed">{locationNotice}</p>
            )}
          </div>
        </div>

        {/* Primary Full-Width Deep Olive Submit CTA */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[50px] inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Mengirim Laporan Real-Time...</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Kirim Laporan Sekarang</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
