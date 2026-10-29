import React, { useCallback, useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Camera,
  CheckCircle2,
  Crosshair,
  ImagePlus,
  Loader2,
  MapPin,
  Send,
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
          `GPS otomatis tidak diizinkan (${err.message}). Anda tetap dapat mengklik peta untuk menentukan titik presisi.`
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
        'Kamera langsung tidak dapat diakses. Gunakan tombol Unggah / Kamera Perangkat di sebelahnya.'
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
      onSuccess();
    } catch (error) {
      setSubmitting(false);
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const activeCategoryMeta = CATEGORY_CATALOG[category];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Kirim Laporan Kejadian Warga</h2>
          <p className="text-sm text-slate-600 mt-1">
            Lampirkan bukti foto real-time dan pastikan titik koordinat GPS sesuai lokasi kejadian di lingkungan RW 013.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        )}
      </div>

      {formError && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Photo Capture & Details */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. Real-Time Photo Evidence */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-900">
                1. Bukti Foto Kejadian Real-Time
              </label>
              <span className="text-xs text-slate-500">
                Kompresi otomatis · Maks 750 KB
              </span>
            </div>

            {cameraOpen ? (
              <div className="border border-slate-300 rounded-lg overflow-hidden bg-slate-950 space-y-3 p-3">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-64 object-cover rounded bg-black"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={stopCameraStream}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 hover:text-white border border-slate-700 rounded-lg cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Batal</span>
                  </button>
                  <button
                    type="button"
                    onClick={captureFromVideo}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-white rounded-lg hover:bg-slate-100 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Ambil Foto Sekarang</span>
                  </button>
                </div>
              </div>
            ) : photoDataUrl ? (
              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50">
                <img
                  src={photoDataUrl}
                  alt="Pratinjau foto kejadian"
                  referrerPolicy="no-referrer"
                  className="w-full h-60 object-cover rounded border border-slate-200"
                />
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Foto siap dikirim ({Math.round((photoDataUrl.length * 0.75) / 1024)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => setPhotoDataUrl('')}
                    className="inline-flex items-center gap-1 text-red-700 hover:underline font-medium cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus / Ulangi</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 rounded-lg p-5 bg-slate-50/70 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="space-y-1 text-center sm:text-left">
                  <p className="text-sm font-medium text-slate-800">
                    Ambil foto langsung dari lokasi kejadian
                  </p>
                  <p className="text-xs text-slate-500">
                    Gunakan kamera langsung atau pilih foto dari perangkat Anda.
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={startLiveCamera}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Buka Kamera</span>
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer">
                    <ImagePlus className="w-3.5 h-3.5" />
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

            {cameraError && <p className="text-xs text-amber-700">{cameraError}</p>}
          </div>

          {/* 2. Structured Categorization & Urgency */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="report-cat" className="block text-xs font-semibold text-slate-700">
                Kategori Laporan
              </label>
              <select
                id="report-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {Object.values(CATEGORY_CATALOG).map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="report-rt" className="block text-xs font-semibold text-slate-700">
                Wilayah RT (Lingkungan RW 013)
              </label>
              <select
                id="report-rt"
                value={rt}
                onChange={(e) => setRt(e.target.value as RtUnit)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {RT_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit} · RW 013
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span>
              Rujukan Instansi Otomatis:{' '}
              <strong className="text-slate-900">
                {AGENCY_LABELS[activeCategoryMeta.defaultAgency]}
              </strong>
            </span>
            <span className="font-mono text-slate-500">
              Target SLA: {activeCategoryMeta.slaHours} jam
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-slate-700">Tingkat Urgensi</span>
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
                {(['rendah', 'sedang', 'tinggi', 'darurat'] as ReportUrgency[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setUrgency(lvl)}
                    className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      urgency === lvl
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {URGENCY_LABELS[lvl]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-slate-700">Visibilitas Laporan</span>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setVisibility('public')}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    visibility === 'public'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Publik Warga
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('private')}
                  className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    visibility === 'private'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Khusus Admin
                </button>
              </div>
            </div>
          </div>

          {/* 3. Title & Description */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="report-title" className="text-xs font-semibold text-slate-700">
                Judul Kejadian
              </label>
              <span className="text-[11px] font-mono text-slate-400">
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
              placeholder="Contoh: Genangan air & jentik di saluran depan Gang 3"
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="report-desc" className="text-xs font-semibold text-slate-700">
                Kronologi & Detail Lokasi
              </label>
              <span className="text-[11px] font-mono text-slate-400">
                {description.length}/{VALIDATION_LIMITS.DESC_MAX}
              </span>
            </div>
            <textarea
              id="report-desc"
              rows={4}
              required
              minLength={VALIDATION_LIMITS.DESC_MIN}
              maxLength={VALIDATION_LIMITS.DESC_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Jelaskan kondisi di lapangan, patokan rumah/jalan, dan dampak bagi warga sekitar..."
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>

        {/* Right Column: Automatic Exact GPS & Map Pin */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                2. Lokasi Geografis Otomatis
              </h3>
              <p className="text-xs text-slate-500">
                Klik pada peta bila ingin menggeser titik presisi kejadian.
              </p>
            </div>
            <button
              type="button"
              onClick={detectCurrentGps}
              disabled={locating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {locating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Crosshair className="w-3.5 h-3.5" />
              )}
              <span>{locating ? 'Mencari GPS...' : 'Akurasi GPS'}</span>
            </button>
          </div>

          <InteractiveMap
            center={coords}
            zoom={16}
            heightClass="h-72"
            mode="picker"
            selectedPin={coords}
            onSelectLocation={handleMapSelect}
          />

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                <MapPin className="w-3.5 h-3.5 text-slate-600" />
                Koordinat Presisi
              </span>
              <span className="font-mono text-slate-900">
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                {gpsAccuracy !== null ? ` (±${gpsAccuracy}m)` : ''}
              </span>
            </div>

            <div className="space-y-1">
              <label htmlFor="report-address" className="block text-[11px] font-medium text-slate-500">
                Alamat Hasil Deteksi Otomatis (Dapat Disempurnakan)
              </label>
              <input
                id="report-address"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.ADDRESS_MAX}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            {locationNotice && (
              <p className="text-[11px] text-amber-700 leading-relaxed">{locationNotice}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
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
        </div>
      </form>
    </div>
  );
};
